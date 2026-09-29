import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { IStarterRun, initialSteps, StarterRun } from '../models/StarterRun.js';
import { GitIntegration } from '../models/GitIntegration.js';
import { audit } from '../services/approvals.js';
import { defaultAiConnector, describeAiError } from '../services/openaiClient.js';
import { chatTurn, generate, LIMITS, publishRun, repoExists, safePath, setStep } from '../services/projectStarter.js';
import { describeGitError, listOwners } from '../services/gitPublisher.js';
import { ECOSYSTEMS, Ecosystem, resolveVersion } from '../services/versionResolver.js';
import { cleanString, isValidId } from '../utils/validation.js';

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const STALE_MS = 20 * 60_000;

const summary = (r: IStarterRun) => ({
  _id: String(r._id),
  title: r.title,
  owner: r.owner,
  ownerName: r.ownerName,
  model: r.aiModel,
  status: r.status,
  fileCount: r.files.length,
  repo: r.repo,
  error: r.error,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const full = (r: IStarterRun) => ({
  ...summary(r),
  connectorId: r.connectorId,
  messages: r.messages,
  plan: r.plan,
  files: r.files.map((f) => ({ path: f.path, content: f.content, size: Buffer.byteLength(f.content, 'utf8') })),
  steps: r.steps,
  usage: r.usage,
  limits: LIMITS,
});

// Background work does not survive a server restart: mark such runs as interrupted.
const unstick = async (r: IStarterRun) => {
  if ((r.status === 'generating' || r.status === 'publishing') && Date.now() - new Date(r.updatedAt).getTime() > STALE_MS) {
    r.status = 'failed';
    r.error = 'Interrupted (the server restarted or the AI stopped answering). Try again.';
    const cur = r.steps.find((s) => s.state === 'running');
    if (cur) setStep(r, cur.key, 'failed', r.error);
    await r.save();
  }
  return r;
};

// Managers only (route guard); each manager sees their own runs, ?all=1 shows everyone's.
const loadRun = async (req: AuthRequest, res: Response) => {
  const r = isValidId(req.params.id) ? await StarterRun.findById(req.params.id) : null;
  if (!r) {
    res.status(404).json({ message: 'Project not found' });
    return null;
  }
  return unstick(r);
};

export const listRuns = async (req: AuthRequest, res: Response): Promise<void> => {
  const filter = req.query.all === '1' ? {} : { owner: req.user!.email };
  const runs = await StarterRun.find(filter, { messages: 0, 'files.content': 0 }).sort({ updatedAt: -1 }).limit(200);
  res.json({ runs: runs.map(summary) });
};

export const getRun = async (req: AuthRequest, res: Response): Promise<void> => {
  const r = await loadRun(req, res);
  if (r) res.json({ run: full(r) });
};

// POST /starter/runs { message?, connectorId?, model? }
export const createRun = async (req: AuthRequest, res: Response): Promise<void> => {
  const ai = await defaultAiConnector(req.body?.connectorId ? String(req.body.connectorId) : undefined);
  if (!ai) {
    res.status(400).json({ message: 'No AI connector. Add ChatGPT (OpenAI) in Connectors → AI first.' });
    return;
  }
  const model = cleanString(req.body?.model, 100) || ai.defaultModel;
  if (!model) {
    res.status(400).json({ message: `${ai.name} has no default model. Edit the connector and pick one.` });
    return;
  }
  const run = await StarterRun.create({ owner: req.user!.email, ownerName: req.user!.name, connectorId: String(ai._id), aiModel: model, steps: initialSteps() });
  await audit(req.user, { action: 'STARTER', target: String(run._id), outcome: 'succeeded', message: `Project Starter conversation started (${ai.name} · ${model})` });
  const text = cleanString(req.body?.message, 8000);
  if (text) {
    try {
      await chatTurn(run, ai, text);
    } catch (err: any) {
      res.status(502).json({ message: err?.response ? describeAiError(err) : err?.message, run: full(run) });
      return;
    }
  }
  res.status(201).json({ run: full(run) });
};

// POST /starter/runs/:id/messages { content }
export const sendMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  const run = await loadRun(req, res);
  if (!run) return;
  if (run.status === 'generating' || run.status === 'publishing') {
    res.status(409).json({ message: 'Wait until generation/publishing has finished' });
    return;
  }
  const text = cleanString(req.body?.content, 8000);
  if (!text) {
    res.status(400).json({ message: 'Write a message' });
    return;
  }
  const ai = await defaultAiConnector(run.connectorId);
  if (!ai) {
    res.status(400).json({ message: 'The AI connector of this project is gone. Add one in Connectors → AI.' });
    return;
  }
  try {
    await chatTurn(run, ai, text);
    res.json({ run: full(run) });
  } catch (err: any) {
    res.status(502).json({ message: err?.response ? describeAiError(err) : err?.message || 'The AI did not answer' });
  }
};

// POST /starter/runs/:id/generate → 202; progress via GET (steps).
export const generateRun = async (req: AuthRequest, res: Response): Promise<void> => {
  const run = await loadRun(req, res);
  if (!run) return;
  if (run.status === 'generating' || run.status === 'publishing') {
    res.status(409).json({ message: 'Already running' });
    return;
  }
  if (run.status === 'published') {
    res.status(409).json({ message: 'This project was already pushed. Start a new one for another project.' });
    return;
  }
  if (!run.messages.some((m) => m.role === 'user')) {
    res.status(400).json({ message: 'Describe the project in the chat first' });
    return;
  }
  const ai = await defaultAiConnector(run.connectorId);
  if (!ai) {
    res.status(400).json({ message: 'No AI connector' });
    return;
  }
  run.status = 'generating';
  await run.save();
  void generate(String(run._id), ai);
  await audit(req.user, { action: 'STARTER', target: run.title, outcome: 'succeeded', message: 'Project files generation started' });
  res.status(202).json({ message: 'Generating: the plan first, then the files in batches', run: full(run) });
};

// PUT /starter/runs/:id/files { path, content } (add or edit one file during review)
export const saveFile = async (req: AuthRequest, res: Response): Promise<void> => {
  const run = await loadRun(req, res);
  if (!run) return;
  if (run.status !== 'ready') {
    res.status(409).json({ message: 'Files can be edited when generation is done and before pushing' });
    return;
  }
  const path = safePath(req.body?.path);
  if (!path) {
    res.status(400).json({ message: 'Invalid path (relative, forward slashes, no ..)' });
    return;
  }
  const content = String(req.body?.content ?? '');
  if (Buffer.byteLength(content, 'utf8') > LIMITS.maxFileBytes) {
    res.status(400).json({ message: 'File is larger than 200 KB' });
    return;
  }
  const exists = run.files.some((f) => f.path === path);
  if (!exists && run.files.length >= LIMITS.maxFiles) {
    res.status(400).json({ message: `At most ${LIMITS.maxFiles} files` });
    return;
  }
  run.files = exists ? run.files.map((f) => (f.path === path ? { path, content } : f)) : [...run.files, { path, content }];
  await run.save();
  res.json({ message: `${path} saved`, run: full(run) });
};

// DELETE /starter/runs/:id/files?path=
export const deleteFile = async (req: AuthRequest, res: Response): Promise<void> => {
  const run = await loadRun(req, res);
  if (!run) return;
  if (run.status !== 'ready') {
    res.status(409).json({ message: 'Files can be removed when generation is done and before pushing' });
    return;
  }
  const path = String(req.query.path || '');
  run.files = run.files.filter((f) => f.path !== path);
  await run.save();
  res.json({ message: `${path} removed`, run: full(run) });
};

// Git connectors that can receive a project (GitHub and GitLab).
export const listTargets = async (_req: AuthRequest, res: Response): Promise<void> => {
  const list = await GitIntegration.find({ isActive: true }).sort({ provider: 1, isDefault: -1, name: 1 });
  res.json({ connectors: list.map((g) => ({ id: String(g._id), name: g.name, provider: g.provider, username: g.username, baseUrl: g.baseUrl, isDefault: g.isDefault })) });
};

export const listTargetOwners = async (req: AuthRequest, res: Response): Promise<void> => {
  const g = isValidId(req.query.connectorId) ? await GitIntegration.findById(req.query.connectorId) : null;
  if (!g) {
    res.status(404).json({ message: 'Git connector not found' });
    return;
  }
  try {
    res.json({ owners: await listOwners(g) });
  } catch (err) {
    res.status(502).json({ message: describeGitError(err, g.provider === 'github' ? 'GitHub' : 'GitLab') });
  }
};

// POST /starter/runs/:id/publish { gitConnectorId, owner, ownerName, name, description, visibility, branch, message }
export const publishProject = async (req: AuthRequest, res: Response): Promise<void> => {
  const run = await loadRun(req, res);
  if (!run) return;
  if (run.status !== 'ready' && !(run.status === 'failed' && run.files.length && !run.repo)) {
    res.status(409).json({ message: run.status === 'published' ? 'Already pushed' : 'Generate the files first' });
    return;
  }
  if (!run.files.length) {
    res.status(400).json({ message: 'There are no files to push' });
    return;
  }
  const b = req.body || {};
  const git = isValidId(b.gitConnectorId) ? await GitIntegration.findById(b.gitConnectorId) : null;
  if (!git || !git.isActive) {
    res.status(400).json({ message: 'Pick an active GitHub or GitLab connector' });
    return;
  }
  const name = cleanString(b.name, 100);
  if (!REPO_NAME.test(name) || /^\.|\.git$/i.test(name)) {
    res.status(400).json({ message: 'Repository name: letters, digits, dot, dash and underscore' });
    return;
  }
  const visibility = ['public', 'private', 'internal'].includes(b.visibility) ? b.visibility : 'private';
  const owner = cleanString(b.owner, 100);
  const ownerName = cleanString(b.ownerName, 200).replace(/^@/, '') || git.username || '';
  try {
    const existing = await repoExists(git, ownerName, name);
    if (existing) {
      res.status(409).json({ message: `${ownerName}/${name} already exists (${existing}). Pick another name: DevOps Intelligence never writes into an existing repository.` });
      return;
    }
  } catch (err) {
    res.status(502).json({ message: describeGitError(err, git.provider === 'github' ? 'GitHub' : 'GitLab') });
    return;
  }
  const input = {
    gitConnectorId: String(git._id),
    owner,
    ownerName,
    name,
    description: cleanString(b.description, 350) || run.plan?.summary || '',
    visibility: visibility as 'public' | 'private' | 'internal',
    branch: cleanString(b.branch, 100) || 'main',
    message: cleanString(b.message, 200) || 'Initial project setup (DevOps Intelligence Project Starter)',
  };
  run.status = 'publishing';
  await run.save();
  void publishRun(String(run._id), input).then(async () => {
    const after = await StarterRun.findById(run._id);
    await audit(req.user, {
      action: 'STARTER',
      target: `${ownerName}/${name}`,
      outcome: after?.status === 'published' ? 'succeeded' : 'failed',
      message: after?.status === 'published' ? `Pushed ${after.files.length} files to ${after.repo?.url}` : `Push failed: ${after?.error}`,
    });
  });
  res.status(202).json({ message: `Creating ${ownerName}/${name} on ${git.provider === 'github' ? 'GitHub' : 'GitLab'}`, run: full(run) });
};

export const deleteRun = async (req: AuthRequest, res: Response): Promise<void> => {
  const run = await loadRun(req, res);
  if (!run) return;
  if (run.status === 'generating' || run.status === 'publishing') {
    res.status(409).json({ message: 'Wait until it has finished' });
    return;
  }
  await run.deleteOne();
  res.json({ message: `${run.title} deleted${run.repo ? ' (the repository is kept)' : ''}` });
};

// GET /starter/versions?ecosystem=npm&name=react (for the UI and for checking what the AI used)
export const lookupVersion = async (req: AuthRequest, res: Response): Promise<void> => {
  const ecosystem = String(req.query.ecosystem || '') as Ecosystem;
  const name = cleanString(req.query.name, 200);
  if (!ECOSYSTEMS.includes(ecosystem) || !name) {
    res.status(400).json({ message: `ecosystem (${ECOSYSTEMS.join(', ')}) and name are required` });
    return;
  }
  res.json(await resolveVersion(ecosystem, name));
};
