import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { GitIntegration, IGitIntegration, GitProvider } from '../models/GitIntegration.js';
import { Octokit } from '@octokit/rest';
import axios from 'axios';
import { maskSecret } from '../utils/secrets.js';
import { describeRequestError } from '../utils/httpError.js';
import { buildScope } from '../services/access.js';
import { cleanString, isHttpUrl, isValidId, nameMatch, normalizeUrl } from '../utils/validation.js';
import { listTemplates, readTemplateFiles } from '../services/workspaceTemplates.js';
import { readZip } from '../utils/zip.js';
import { describeGithubToken, githubTokenInfo, listGithubRepos, octokitFor } from '../services/githubClient.js';

const PROVIDERS: GitProvider[] = ['github', 'gitlab'];
const PROVIDER_LABEL: Record<GitProvider, string> = { github: 'GitHub', gitlab: 'GitLab' };
const DEFAULT_BASE_URL: Record<GitProvider, string> = { github: 'https://github.com', gitlab: 'https://gitlab.com' };

// Tokens are never returned; only a masked hint of the last 4 characters.
export const serializeGit = (g: IGitIntegration) => ({
  _id: g._id,
  name: g.name,
  provider: g.provider,
  baseUrl: g.baseUrl,
  username: g.username,
  organizations: g.organizations,
  isActive: g.isActive,
  isDefault: g.isDefault,
  status: g.status || 'Unknown',
  lastError: g.lastError || '',
  lastTestedAt: g.lastTestedAt,
  lastConnectedAt: g.lastConnectedAt,
  tokenHint: maskSecret(g.token),
  createdAt: g.createdAt,
  updatedAt: g.updatedAt,
});

// Calls the provider's "current user" endpoint to prove the token works. Returns the account username.
const verifyGitToken = async (provider: GitProvider, token: string, baseUrl: string): Promise<string> => {
  if (provider === 'github') {
    const userRes = await octokitFor(token, baseUrl).rest.users.getAuthenticated();
    return userRes.data.login;
  }
  const glRes = await axios.get(`${baseUrl}/api/v4/user`, {
    headers: { 'PRIVATE-TOKEN': token },
    timeout: 8000,
  });
  return glRes.data.username;
};

export const findIntegration = async (id: unknown) => (isValidId(id) ? GitIntegration.findById(id) : null);

const clearOtherDefaults = (doc: IGitIntegration) =>
  GitIntegration.updateMany({ _id: { $ne: doc._id }, provider: doc.provider }, { isDefault: false });

export const listGitIntegrations = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const integrations = await GitIntegration.find().sort({ createdAt: -1 });
    // Records saved before defaults existed: promote the oldest per provider so each has exactly one.
    for (const provider of PROVIDERS) {
      const ofProvider = integrations.filter((g) => g.provider === provider);
      if (ofProvider.length > 0 && !ofProvider.some((g) => g.isDefault)) {
        const oldest = ofProvider[ofProvider.length - 1];
        oldest.isDefault = true;
        await oldest.save();
      }
    }
    res.json({ integrations: integrations.map(serializeGit) });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to fetch git integrations', error: err.message });
  }
};

export const saveGitIntegration = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const name = cleanString(req.body.name, 80);
    const provider = req.body.provider as GitProvider;
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';

    if (!name || !PROVIDERS.includes(provider) || !token) {
      res.status(400).json({ message: 'Name, provider (github or gitlab), and token are required' });
      return;
    }
    const baseUrl = req.body.baseUrl ? normalizeUrl(req.body.baseUrl) : DEFAULT_BASE_URL[provider];
    if (!isHttpUrl(baseUrl)) {
      res.status(400).json({ message: 'Base URL must be a valid http(s) URL' });
      return;
    }
    if (await GitIntegration.exists({ name: nameMatch(name) })) {
      res.status(409).json({ message: `A connector named '${name}' already exists` });
      return;
    }

    let username: string;
    try {
      username = await verifyGitToken(provider, token, baseUrl);
    } catch (err) {
      res.status(400).json({ message: describeRequestError(err, PROVIDER_LABEL[provider]) });
      return;
    }

    const isFirstForProvider = !(await GitIntegration.exists({ provider }));
    const integration = new GitIntegration({
      name,
      provider,
      baseUrl,
      token,
      username,
      organizations: provider === 'github' ? await githubTokenInfo(token, baseUrl).then((i) => i.orgs).catch(() => []) : Array.isArray(req.body.organizations) ? req.body.organizations : [],
      isActive: req.body.isActive !== false,
      isDefault: typeof req.body.isDefault === 'boolean' ? req.body.isDefault : isFirstForProvider,
      status: 'Connected',
      lastError: '',
      lastTestedAt: new Date(),
      lastConnectedAt: new Date(),
    });

    await integration.save();
    if (integration.isDefault) await clearOtherDefaults(integration);

    res.status(201).json({
      message: `${PROVIDER_LABEL[provider]} connector '${name}' verified for @${username}`,
      connector: serializeGit(integration),
    });
  } catch (err: any) {
    res.status(500).json({ message: 'Error configuring Git integration', error: err.message });
  }
};

export const updateGitIntegration = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const integration = await findIntegration(req.params.id);
    if (!integration) {
      res.status(404).json({ message: 'Git integration not found' });
      return;
    }

    if (req.body.name !== undefined) {
      const name = cleanString(req.body.name, 80);
      if (!name) {
        res.status(400).json({ message: 'Name is required' });
        return;
      }
      if (await GitIntegration.exists({ _id: { $ne: integration._id }, name: nameMatch(name) })) {
        res.status(409).json({ message: `A connector named '${name}' already exists` });
        return;
      }
      integration.name = name;
    }

    const newToken = typeof req.body.token === 'string' ? req.body.token.trim() : '';
    const newBaseUrl = req.body.baseUrl ? normalizeUrl(req.body.baseUrl) : integration.baseUrl || DEFAULT_BASE_URL[integration.provider];
    if (!isHttpUrl(newBaseUrl)) {
      res.status(400).json({ message: 'Base URL must be a valid http(s) URL' });
      return;
    }

    // Re-verify whenever the credentials or the host they are used against change.
    if (newToken || newBaseUrl !== integration.baseUrl) {
      try {
        integration.username = await verifyGitToken(integration.provider, newToken || integration.token, newBaseUrl);
      } catch (err) {
        res.status(400).json({ message: describeRequestError(err, PROVIDER_LABEL[integration.provider]) });
        return;
      }
      if (newToken) integration.token = newToken;
      integration.baseUrl = newBaseUrl;
      integration.status = 'Connected';
      integration.lastError = '';
      integration.lastTestedAt = new Date();
      integration.lastConnectedAt = new Date();
    }

    if (typeof req.body.isActive === 'boolean') integration.isActive = req.body.isActive;
    if (typeof req.body.isDefault === 'boolean') integration.isDefault = req.body.isDefault;

    await integration.save();
    if (integration.isDefault) await clearOtherDefaults(integration);

    res.json({ message: `Connector '${integration.name}' updated`, connector: serializeGit(integration) });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to update Git integration', error: err.message });
  }
};

export const deleteGitIntegration = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const integration = await findIntegration(req.params.id);
    if (!integration) {
      res.status(404).json({ message: 'Git integration not found' });
      return;
    }
    await integration.deleteOne();

    if (integration.isDefault) {
      const next = await GitIntegration.findOne({ provider: integration.provider }).sort({ createdAt: 1 });
      if (next) {
        next.isDefault = true;
        await next.save();
      }
    }
    res.json({ message: `Connector '${integration.name}' deleted` });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to delete Git integration', error: err.message });
  }
};

// Tests credentials from the form without saving. Pass `id` to fall back to the stored token.
export const testGitConnection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await findIntegration(req.body.id);
    const provider = (existing?.provider || req.body.provider) as GitProvider;
    if (!PROVIDERS.includes(provider)) {
      res.status(400).json({ message: 'Provider must be github or gitlab' });
      return;
    }
    const baseUrl = req.body.baseUrl ? normalizeUrl(req.body.baseUrl) : existing?.baseUrl || DEFAULT_BASE_URL[provider];
    const token = (typeof req.body.token === 'string' && req.body.token.trim()) || existing?.token;
    if (!isHttpUrl(baseUrl)) {
      res.status(400).json({ message: 'Base URL must be a valid http(s) URL' });
      return;
    }
    if (!token) {
      res.status(400).json({ message: 'A personal access token is required' });
      return;
    }

    try {
      if (provider === 'github') {
        const info = await githubTokenInfo(token, baseUrl);
        res.json({ ok: true, message: describeGithubToken(info), details: { account: info.login, host: baseUrl, scopes: info.scopes?.join(', ') || info.tokenType, orgs: info.orgs.join(', ') } });
        return;
      }
      const username = await verifyGitToken(provider, token, baseUrl);
      res.json({ ok: true, message: `Authenticated as @${username}`, details: { account: username, host: baseUrl } });
    } catch (err) {
      res.json({ ok: false, message: describeRequestError(err, PROVIDER_LABEL[provider]) });
    }
  } catch (err: any) {
    res.status(500).json({ message: 'Connection test failed', error: err.message });
  }
};

export const testSavedGitIntegration = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const integration = await findIntegration(req.params.id);
    if (!integration) {
      res.status(404).json({ message: 'Git integration not found' });
      return;
    }

    let result: { ok: boolean; message: string; details?: Record<string, string> };
    try {
      if (integration.provider === 'github') {
        const info = await githubTokenInfo(integration.token, integration.baseUrl || DEFAULT_BASE_URL.github);
        integration.username = info.login;
        integration.organizations = info.orgs;
        result = { ok: true, message: describeGithubToken(info), details: { account: info.login, scopes: info.scopes?.join(', ') || info.tokenType } };
      } else {
        const username = await verifyGitToken(integration.provider, integration.token, integration.baseUrl || DEFAULT_BASE_URL[integration.provider]);
        integration.username = username;
        result = { ok: true, message: `Authenticated as @${username}`, details: { account: username } };
      }
      integration.status = 'Connected';
      integration.lastError = '';
      integration.lastConnectedAt = new Date();
    } catch (err) {
      const message = describeRequestError(err, PROVIDER_LABEL[integration.provider]);
      integration.status = 'Error';
      integration.lastError = message;
      result = { ok: false, message };
    }
    integration.lastTestedAt = new Date();
    await integration.save();

    res.json({ ...result, connector: serializeGit(integration) });
  } catch (err: any) {
    res.status(500).json({ message: 'Connection test failed', error: err.message });
  }
};

// Loads a connector for read operations; rejects unknown or disabled ones.
const loadActiveIntegration = async (id: unknown, res: Response) => {
  const integration = await findIntegration(id);
  if (!integration) {
    res.status(404).json({ message: 'Git integration not found' });
    return null;
  }
  if (!integration.isActive) {
    res.status(400).json({ message: `Connector '${integration.name}' is disabled` });
    return null;
  }
  return integration;
};

export const fetchRepositories = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const integration = await loadActiveIntegration(req.params.id, res);
    if (!integration) return;

    let repos: any[] = [];

    if (integration.provider === 'github') {
      repos = await listGithubRepos(integration.token, integration.baseUrl || DEFAULT_BASE_URL.github);
    } else if (integration.provider === 'gitlab') {
      const gitlabUrl = integration.baseUrl || DEFAULT_BASE_URL.gitlab;
      let glProjects: any[] = [];
      try {
        const response = await axios.get(
          `${gitlabUrl}/api/v4/projects?min_access_level=20&order_by=updated_at&per_page=100`,
          { headers: { 'PRIVATE-TOKEN': integration.token }, timeout: 10000 }
        );
        glProjects = response.data || [];
      } catch {
        // Fallback for owned projects
        const fallbackRes = await axios.get(
          `${gitlabUrl}/api/v4/projects?owned=true&order_by=updated_at&per_page=100`,
          { headers: { 'PRIVATE-TOKEN': integration.token }, timeout: 10000 }
        );
        glProjects = fallbackRes.data || [];
      }

      repos = glProjects.map(mapGitLabProject);
    }

    const scope = await buildScope(req.user);
    const visible = scope ? repos.filter((r) => scope.repoPaths.has(String(r.fullName || '').toLowerCase())) : repos;
    res.json({ provider: integration.provider, repos: visible });
  } catch (err: any) {
    res.status(500).json({ message: describeRequestError(err, 'Git provider'), error: err.message });
  }
};

const mapGitLabProject = (r: any) => ({
  id: r.id,
  name: r.name,
  fullName: r.path_with_namespace,
  private: r.visibility === 'private',
  visibility: r.visibility,
  htmlUrl: r.web_url,
  cloneUrl: r.http_url_to_repo,
  sshUrl: r.ssh_url_to_repo,
  defaultBranch: r.default_branch || 'main',
  description: r.description,
  lastActivityAt: r.last_activity_at,
  createdAt: r.created_at,
  starCount: r.star_count || 0,
  forksCount: r.forks_count || 0,
});

const VISIBILITIES = ['private', 'internal', 'public'];

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 100);

// Lists every file in a branch (recursive, paginated). Returns [] for empty repos or missing branches.
const listRepoTree = async (gitlabUrl: string, token: string, projectId: string | number, ref: string) => {
  const entries: { path: string; id: string; type: string }[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await axios
      .get(`${gitlabUrl}/api/v4/projects/${projectId}/repository/tree`, {
        headers: { 'PRIVATE-TOKEN': token },
        params: { recursive: true, per_page: 100, page, ref },
        timeout: 15000,
      })
      .catch((err) => {
        if (err.response?.status === 404) return { data: [] };
        throw err;
      });
    entries.push(...res.data);
    if (res.data.length < 100) break;
  }
  return entries;
};

interface PushResult {
  commit: { id: string; shortId: string; title: string; webUrl: string } | null;
  created: string[];
  updated: string[];
  skipped: string[];
  unchanged: number;
}

// What to do with files that exist on the branch with different content.
type ConflictMode = 'abort' | 'overwrite' | 'skip';

class TemplateConflictError extends Error {
  constructor(public conflicts: string[]) {
    super(`${conflicts.length} file(s) already exist with different content`);
  }
}

// Commits a workspace template to a branch in one GitLab commit. Unchanged files are skipped by
// comparing git blob ids; files changed in the repo abort the push, are overwritten, or are kept (skip).
const pushTemplateFiles = async (
  gitlabUrl: string,
  token: string,
  projectId: string | number,
  templateName: string,
  branch: string,
  commitMessage: string,
  conflictMode: ConflictMode
): Promise<PushResult> => {
  const files = readTemplateFiles(templateName);
  const headers = { 'PRIVATE-TOKEN': token };

  const project = (await axios.get(`${gitlabUrl}/api/v4/projects/${projectId}`, { headers, timeout: 15000 })).data;
  const branchExists = project.empty_repo
    ? false
    : await axios
        .get(`${gitlabUrl}/api/v4/projects/${projectId}/repository/branches/${encodeURIComponent(branch)}`, { headers, timeout: 15000 })
        .then(() => true)
        .catch((err) => {
          if (err.response?.status === 404) return false;
          throw err;
        });

  const tree = branchExists ? await listRepoTree(gitlabUrl, token, projectId, branch) : [];
  const existing = new Map(tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.id]));

  const created: string[] = [];
  const changed: string[] = [];
  const actions: any[] = [];
  for (const file of files) {
    const currentSha = existing.get(file.path);
    if (currentSha === file.blobSha) continue;
    if (currentSha) {
      changed.push(file.path);
      if (conflictMode !== 'overwrite') continue;
    } else {
      created.push(file.path);
    }
    actions.push({ action: currentSha ? 'update' : 'create', file_path: file.path, content: file.content.toString('base64'), encoding: 'base64' });
  }

  if (changed.length > 0 && conflictMode === 'abort') throw new TemplateConflictError(changed);
  const updated = conflictMode === 'overwrite' ? changed : [];
  const skipped = conflictMode === 'skip' ? changed : [];
  const unchanged = files.length - created.length - changed.length;
  if (actions.length === 0) return { commit: null, created, updated, skipped, unchanged };

  const payload: Record<string, unknown> = { branch, commit_message: commitMessage, actions };
  // New branch in a non-empty repo: start it from the default branch.
  if (!branchExists && !project.empty_repo) payload.start_branch = project.default_branch;

  const commitRes = await axios.post(`${gitlabUrl}/api/v4/projects/${projectId}/repository/commits`, payload, {
    headers,
    timeout: 60000,
  });
  const c = commitRes.data;
  return {
    commit: { id: c.id, shortId: c.short_id, title: c.title, webUrl: c.web_url },
    created,
    updated,
    skipped,
    unchanged,
  };
};

export const listWorkspaceTemplates = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.json({ templates: listTemplates() });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to read workspace templates', error: err.message });
  }
};

export const createGitLabProject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const integration = await loadActiveIntegration(req.params.id, res);
    if (!integration) return;
    if (integration.provider !== 'gitlab') {
      res.status(400).json({ message: 'Creating repositories is only supported for GitLab connectors' });
      return;
    }

    const name = cleanString(req.body.name, 100);
    const repoPath = slugify(cleanString(req.body.path, 100) || name);
    const visibility = VISIBILITIES.includes(req.body.visibility) ? req.body.visibility : 'private';
    const description = cleanString(req.body.description, 500);
    const template = cleanString(req.body.template, 100);
    const commitMessage = cleanString(req.body.commitMessage, 200) || 'chore: initial commit from DevOps Intelligence';

    if (!name || !repoPath) {
      res.status(400).json({ message: 'Project name is required' });
      return;
    }
    if (template && !listTemplates().some((t) => t.name === template)) {
      res.status(400).json({ message: `Template '${template}' not found` });
      return;
    }

    const gitlabUrl = integration.baseUrl || DEFAULT_BASE_URL.gitlab;
    let project: any;
    try {
      const created = await axios.post(
        `${gitlabUrl}/api/v4/projects`,
        { name, path: repoPath, description, visibility, initialize_with_readme: false, default_branch: 'main' },
        { headers: { 'PRIVATE-TOKEN': integration.token }, timeout: 20000 }
      );
      project = created.data;
    } catch (err: any) {
      const detail = err.response?.data?.message;
      const taken = JSON.stringify(detail || '').includes('has already been taken');
      res.status(taken ? 409 : 400).json({
        message: taken
          ? `A project named '${repoPath}' already exists for @${integration.username}`
          : describeRequestError(err, 'GitLab'),
      });
      return;
    }

    let push: PushResult | null = null;
    let pushError = '';
    if (template) {
      try {
        push = await pushTemplateFiles(gitlabUrl, integration.token, project.id, template, 'main', commitMessage, 'abort');
      } catch (err) {
        pushError = describeRequestError(err, 'GitLab');
      }
    }

    res.status(201).json({
      message: pushError
        ? `Project '${project.path_with_namespace}' created, but pushing '${template}' failed: ${pushError}`
        : template
        ? `Project '${project.path_with_namespace}' created with ${push?.created.length ?? 0} files from '${template}'`
        : `Project '${project.path_with_namespace}' created`,
      repo: mapGitLabProject({ ...project, default_branch: project.default_branch || 'main' }),
      push,
      pushError: pushError || undefined,
    });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to create project', error: err.message });
  }
};

export const pushWorkspaceTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const integration = await loadActiveIntegration(req.params.id, res);
    if (!integration) return;
    if (integration.provider !== 'gitlab') {
      res.status(400).json({ message: 'Pushing templates is only supported for GitLab connectors' });
      return;
    }

    const template = cleanString(req.body.template, 100);
    const branch = cleanString(req.body.branch, 200) || 'main';
    const commitMessage = cleanString(req.body.commitMessage, 200) || `chore: update from DevOps Intelligence template ${template}`;
    if (!listTemplates().some((t) => t.name === template)) {
      res.status(400).json({ message: `Template '${template}' not found` });
      return;
    }

    const gitlabUrl = integration.baseUrl || DEFAULT_BASE_URL.gitlab;
    const projectId = await resolveProjectId(gitlabUrl, integration.token, String(req.params.repoId));
    try {
      const mode: ConflictMode = req.body.onConflict === 'skip' ? 'skip' : req.body.overwrite === true || req.body.onConflict === 'overwrite' ? 'overwrite' : 'abort';
      const push = await pushTemplateFiles(gitlabUrl, integration.token, projectId, template, branch, commitMessage, mode);
      res.json({
        message: push.commit
          ? `Pushed ${push.created.length + push.updated.length} file(s) to ${branch} (${push.commit.shortId})${push.skipped.length ? `, kept ${push.skipped.length} changed file(s)` : ''}`
          : `${branch} already matches '${template}'. Nothing to push`,
        push,
      });
    } catch (err) {
      if (err instanceof TemplateConflictError) {
        res.status(409).json({ message: err.message, conflicts: err.conflicts });
        return;
      }
      res.status(400).json({ message: describeRequestError(err, 'GitLab') });
    }
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to push template', error: err.message });
  }
};

// Helper to resolve repository name or ID to numeric project ID
export const resolveProjectId = async (gitlabUrl: string, token: string, repoId: string): Promise<string> => {
  if (/^\d+$/.test(repoId)) return repoId;
  try {
    const res = await axios.get(`${gitlabUrl}/api/v4/projects?min_access_level=20&per_page=100`, {
      headers: { 'PRIVATE-TOKEN': token },
    });
    const found = res.data?.find(
      (p: any) =>
        p.name.toLowerCase() === repoId.toLowerCase() ||
        p.path.toLowerCase() === repoId.toLowerCase() ||
        p.path_with_namespace.toLowerCase() === repoId.toLowerCase()
    );
    if (found) return String(found.id);
  } catch {}
  return encodeURIComponent(repoId);
};

export const fetchCommits = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, repoId } = req.params;
    const integration = await findIntegration(id);

    if (!integration || integration.provider !== 'gitlab' || !integration.isActive) {
      res.json({ commits: [] });
      return;
    }

    const gitlabUrl = integration.baseUrl || DEFAULT_BASE_URL.gitlab;
    const targetId = await resolveProjectId(gitlabUrl, integration.token, String(repoId));

    const commitsRes = await axios.get(
      `${gitlabUrl}/api/v4/projects/${targetId}/repository/commits?per_page=15`,
      { headers: { 'PRIVATE-TOKEN': integration.token } }
    );

    const commits = (commitsRes.data || []).map((c: any) => ({
      id: c.id,
      shortId: c.short_id,
      title: c.title,
      message: c.message,
      authorName: c.author_name,
      authorEmail: c.author_email,
      committedDate: c.committed_date,
      webUrl: c.web_url,
    }));

    res.json({ commits });
  } catch (err: any) {
    res.status(500).json({ message: 'Error fetching live commits', error: err.message });
  }
};

export const fetchBranches = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, repoId } = req.params;
    const integration = await findIntegration(id);

    if (!integration || integration.provider !== 'gitlab' || !integration.isActive) {
      res.json({ branches: [] });
      return;
    }

    const gitlabUrl = integration.baseUrl || DEFAULT_BASE_URL.gitlab;
    const targetId = await resolveProjectId(gitlabUrl, integration.token, String(repoId));

    const branchRes = await axios.get(
      `${gitlabUrl}/api/v4/projects/${targetId}/repository/branches`,
      { headers: { 'PRIVATE-TOKEN': integration.token } }
    );

    const branches = (branchRes.data || []).map((b: any) => ({
      name: b.name,
      default: b.default,
      protected: b.protected,
      webUrl: b.web_url,
      commit: b.commit ? { id: b.commit.id, shortId: b.commit.short_id, title: b.commit.title } : undefined,
    }));

    res.json({ branches });
  } catch (err: any) {
    res.status(500).json({ message: 'Error fetching branches', error: err.message });
  }
};

export const fetchLanguages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, repoId } = req.params;
    const integration = await findIntegration(id);

    if (!integration || integration.provider !== 'gitlab' || !integration.isActive) {
      res.json({ languages: {} });
      return;
    }

    const gitlabUrl = integration.baseUrl || DEFAULT_BASE_URL.gitlab;
    const targetId = await resolveProjectId(gitlabUrl, integration.token, String(repoId));

    const langRes = await axios.get(
      `${gitlabUrl}/api/v4/projects/${targetId}/languages`,
      { headers: { 'PRIVATE-TOKEN': integration.token } }
    );

    res.json({ languages: langRes.data || {} });
  } catch (err: any) {
    res.status(500).json({ message: 'Error fetching languages', error: err.message });
  }
};

const FINISHED_STATUSES = new Set(['success', 'failed', 'canceled', 'skipped', 'manual']);
const pipelineCache = new Map<string, any>();
const PIPELINE_CACHE_MAX = 500;

const formatDuration = (seconds?: number | null) => {
  if (!seconds) return '-';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

// Builds one pipeline row: jobs, real commit title/author, who triggered it, and the test summary.
// Finished pipelines never change, so they are cached to keep auto-refresh cheap.
const describePipeline = async (gitlabUrl: string, token: string, projectId: string, p: any) => {
  const cacheKey = `${gitlabUrl}|${projectId}|${p.id}`;
  if (FINISHED_STATUSES.has(p.status) && pipelineCache.has(cacheKey)) return pipelineCache.get(cacheKey);

  const headers = { 'PRIVATE-TOKEN': token };
  const base = `${gitlabUrl}/api/v4/projects/${projectId}`;
  const [jobsRes, commitRes, detailRes, testsRes] = await Promise.allSettled([
    axios.get(`${base}/pipelines/${p.id}/jobs`, { headers, params: { per_page: 100 } }),
    axios.get(`${base}/repository/commits/${p.sha}`, { headers }),
    axios.get(`${base}/pipelines/${p.id}`, { headers }),
    axios.get(`${base}/pipelines/${p.id}/test_report_summary`, { headers }),
  ]);

  // GitLab lists jobs newest first; show them in pipeline order.
  const jobs = jobsRes.status === 'fulfilled' ? [...jobsRes.value.data].sort((a: any, b: any) => a.id - b.id) : [];
  const commit = commitRes.status === 'fulfilled' ? commitRes.value.data : null;
  const detail = detailRes.status === 'fulfilled' ? detailRes.value.data : null;
  const total = testsRes.status === 'fulfilled' ? testsRes.value.data?.total : null;

  const row = {
    id: p.id,
    status: p.status,
    ref: p.ref,
    sha: p.sha ? p.sha.substring(0, 8) : 'unknown',
    source: p.source,
    commitTitle: commit?.title || (p.source === 'push' ? `Push to ${p.ref}` : `Pipeline triggered via ${p.source}`),
    author: commit?.author_name || '',
    triggeredBy: detail?.user?.name || detail?.user?.username || '',
    createdAt: p.created_at,
    duration: formatDuration(detail?.duration),
    webUrl: p.web_url,
    tests: total && total.count > 0
      ? { total: total.count, passed: total.success, failed: total.failed + (total.error || 0), skipped: total.skipped }
      : null,
    stages: jobs.map((j: any) => ({
      id: j.id,
      name: j.name,
      stage: j.stage,
      status: j.status,
      duration: formatDuration(j.duration),
      tool: j.name,
      startedAt: j.started_at,
      finishedAt: j.finished_at,
      webUrl: j.web_url,
      failureReason: j.failure_reason,
    })),
  };

  if (FINISHED_STATUSES.has(p.status)) {
    if (pipelineCache.size >= PIPELINE_CACHE_MAX) pipelineCache.delete(pipelineCache.keys().next().value as string);
    pipelineCache.set(cacheKey, row);
  }
  return row;
};

interface TraceLine {
  time?: string;
  stream: 'out' | 'err';
  text: string;
}

// Newer runners prefix each line with "<RFC3339 time> <2-digit stream><O|E>[+]"; "+" continues the previous line.
const TIMESTAMPED_LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) \d{2}([OE])(\+?)(.*)$/;

// GitLab job logs contain ANSI colours, collapsible-section markers and \r progress redraws.
const parseJobTrace = (raw: string): TraceLine[] => {
  const cleaned = raw
    .replace(/section_(start|end):\d+:[^\r\n]*?\r?\x1b\[0K/g, '')
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

  const lines: TraceLine[] = [];
  for (const rawLine of cleaned.split('\n')) {
    const parts = rawLine.split('\r').filter((part) => part.length > 0);
    const line = parts.length ? parts[parts.length - 1] : '';
    const match = TIMESTAMPED_LINE.exec(line);
    if (!match) {
      lines.push({ stream: 'out', text: line });
      continue;
    }
    const [, time, stream, cont, rest] = match;
    const text = cont ? rest : rest.replace(/^ /, '');
    const previous = lines[lines.length - 1];
    if (cont && previous) {
      previous.text += text;
    } else {
      lines.push({ time, stream: stream === 'E' ? 'err' : 'out', text });
    }
  }
  // Collapse runs of blank lines left behind by section markers.
  return lines.filter((l, i) => l.text.trim() !== '' || (i > 0 && lines[i - 1].text.trim() !== ''));
};

const MAX_TRACE_BYTES = 256 * 1024;

export const fetchJobTrace = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const integration = await loadActiveIntegration(req.params.id, res);
    if (!integration) return;
    if (integration.provider !== 'gitlab') {
      res.status(400).json({ message: 'Job logs are only supported for GitLab connectors' });
      return;
    }
    const jobId = String(req.params.jobId);
    if (!/^\d+$/.test(jobId)) {
      res.status(400).json({ message: 'Invalid job id' });
      return;
    }

    const gitlabUrl = integration.baseUrl || DEFAULT_BASE_URL.gitlab;
    const projectId = await resolveProjectId(gitlabUrl, integration.token, String(req.params.repoId));
    const headers = { 'PRIVATE-TOKEN': integration.token };
    const base = `${gitlabUrl}/api/v4/projects/${projectId}/jobs/${jobId}`;

    const [jobRes, traceRes] = await Promise.all([
      axios.get(base, { headers, timeout: 15000 }),
      axios
        .get(`${base}/trace`, { headers, timeout: 20000, responseType: 'text', transformResponse: (d) => d })
        .catch((err) => (err.response?.status === 404 ? { data: '' } : Promise.reject(err))),
    ]);

    let raw = String(traceRes.data || '');
    const truncated = raw.length > MAX_TRACE_BYTES;
    if (truncated) raw = raw.slice(raw.length - MAX_TRACE_BYTES);

    const job = jobRes.data;
    res.json({
      job: {
        id: job.id,
        name: job.name,
        stage: job.stage,
        status: job.status,
        duration: formatDuration(job.duration),
        startedAt: job.started_at,
        finishedAt: job.finished_at,
        webUrl: job.web_url,
        failureReason: job.failure_reason,
        runner: job.runner?.description || '',
      },
      lines: parseJobTrace(raw),
      truncated,
      complete: FINISHED_STATUSES.has(job.status),
    });
  } catch (err: any) {
    res.status(500).json({ message: describeRequestError(err, 'GitLab') });
  }
};

export const fetchPipelines = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, repoId } = req.params;
    const integration = await findIntegration(id);

    if (!integration || integration.provider !== 'gitlab' || !integration.isActive) {
      res.json({ pipelines: [] });
      return;
    }

    const gitlabUrl = integration.baseUrl || DEFAULT_BASE_URL.gitlab;
    const token = integration.token;
    const targetId = await resolveProjectId(gitlabUrl, token, String(repoId));

    const glRes = await axios.get(
      `${gitlabUrl}/api/v4/projects/${targetId}/pipelines?per_page=10`,
      { headers: { 'PRIVATE-TOKEN': token } }
    );

    const pipelines = await Promise.all(
      (glRes.data || []).slice(0, 8).map((p: any) => describePipeline(gitlabUrl, token, targetId, p))
    );
    res.json({ pipelines });
  } catch (err: any) {
    res.status(500).json({ message: 'Error fetching live pipelines', error: err.message });
  }
};

export const triggerPipeline = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, repoId } = req.params;
    const { ref = 'main' } = req.body;
    const integration = await findIntegration(id);

    if (integration && integration.provider === 'gitlab' && integration.isActive) {
      const gitlabUrl = integration.baseUrl || DEFAULT_BASE_URL.gitlab;
      const targetId = await resolveProjectId(gitlabUrl, integration.token, String(repoId));

      const triggerRes = await axios.post(
        `${gitlabUrl}/api/v4/projects/${targetId}/pipeline?ref=${encodeURIComponent(String(ref))}`,
        {},
        { headers: { 'PRIVATE-TOKEN': integration.token } }
      );

      res.status(201).json({
        message: `Pipeline triggered successfully on branch '${ref}'!`,
        pipeline: triggerRes.data,
      });
      return;
    }

    res.status(400).json({ message: 'An active GitLab integration is required' });
  } catch (err: any) {
    res.status(500).json({ message: 'Error triggering pipeline', error: err.response?.data?.message || err.message });
  }
};

const MAX_ARTIFACT_ZIP_BYTES = 10 * 1024 * 1024;
const MAX_REPORT_BYTES = 512 * 1024;
const TEXT_REPORT = /\.(txt|log|json|ya?ml|xml|md|csv|sarif|html?)$/i;

// Files a job saved as artifacts (npm-audit.txt, trivy-report.txt, kube-config.yaml, junit.xml…),
// with the content of text reports so DevOps Intelligence can show them without opening GitLab.
export const fetchJobArtifacts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const integration = await loadActiveIntegration(req.params.id, res);
    if (!integration) return;
    const jobId = String(req.params.jobId);
    if (integration.provider !== 'gitlab' || !/^\d+$/.test(jobId)) {
      res.status(400).json({ message: 'Artifacts are only available for GitLab jobs' });
      return;
    }
    const gitlabUrl = integration.baseUrl || DEFAULT_BASE_URL.gitlab;
    const projectId = await resolveProjectId(gitlabUrl, integration.token, String(req.params.repoId));
    const headers = { 'PRIVATE-TOKEN': integration.token };

    const job = (await axios.get(`${gitlabUrl}/api/v4/projects/${projectId}/jobs/${jobId}`, { headers, timeout: 15000 })).data;
    const archive = (job.artifacts || []).find((a: any) => a.file_type === 'archive');
    if (!archive) {
      res.json({ files: [], expireAt: job.artifacts_expire_at || null });
      return;
    }
    if (archive.size > MAX_ARTIFACT_ZIP_BYTES) {
      res.json({ files: [], tooLarge: true, downloadUrl: `${job.web_url}/artifacts/download`, expireAt: job.artifacts_expire_at || null });
      return;
    }

    const zip = await axios.get(`${gitlabUrl}/api/v4/projects/${projectId}/jobs/${jobId}/artifacts`, {
      headers,
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: MAX_ARTIFACT_ZIP_BYTES,
    });
    const files = readZip(Buffer.from(zip.data)).map((entry) => {
      const isText = TEXT_REPORT.test(entry.path) || !entry.path.includes('.');
      let content: string | undefined;
      let truncated = false;
      if (isText) {
        const data = entry.read();
        truncated = data.length > MAX_REPORT_BYTES;
        content = data.subarray(0, MAX_REPORT_BYTES).toString('utf8');
      }
      return { path: entry.path, size: entry.size, content, truncated };
    });

    res.json({ files, expireAt: job.artifacts_expire_at || null, downloadUrl: `${job.web_url}/artifacts/download` });
  } catch (err: any) {
    if (err.response?.status === 404) {
      res.json({ files: [], expired: true });
      return;
    }
    res.status(500).json({ message: describeRequestError(err, 'GitLab') });
  }
};

// ---------------------------------------------------------------- GitOps layout detection

// Scans a GitOps repo for Kustomize folders and suggests where environment overlays live:
// k8s/overlays/{dev,qa,prod} → { path: 'k8s/overlays', environments: ['dev','qa','prod'] }.
export const fetchGitopsLayout = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, repoId } = req.params;
    const integration = await findIntegration(id);
    if (!integration || integration.provider !== 'gitlab' || !integration.isActive) {
      res.json({ overlayBases: [], kustomizations: [], empty: true });
      return;
    }
    const gitlabUrl = integration.baseUrl || DEFAULT_BASE_URL.gitlab;
    const targetId = await resolveProjectId(gitlabUrl, integration.token, String(repoId));
    const headers = { 'PRIVATE-TOKEN': integration.token };
    const project = await axios.get(`${gitlabUrl}/api/v4/projects/${targetId}`, { headers });
    const ref = String(req.query.ref || project.data.default_branch || 'main');
    if (project.data.empty_repo) {
      res.json({ ref, overlayBases: [], kustomizations: [], empty: true });
      return;
    }

    const files: string[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const r = await axios.get(`${gitlabUrl}/api/v4/projects/${targetId}/repository/tree`, {
        headers,
        params: { ref, recursive: true, per_page: 100, page },
      });
      files.push(...(r.data || []).filter((e: any) => e.type === 'blob').map((e: any) => e.path as string));
      if (!r.headers['x-next-page']) break;
    }

    const kustomizations = files.filter((f) => /(^|\/)kustomization\.ya?ml$/.test(f)).map((f) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : ''));
    const groups = new Map<string, string[]>();
    for (const dir of kustomizations) {
      if (!dir.includes('/')) continue;
      const parent = dir.slice(0, dir.lastIndexOf('/'));
      const name = dir.slice(dir.lastIndexOf('/') + 1);
      if (name === 'base' || name === 'bases' || name === 'components') continue;
      groups.set(parent, [...(groups.get(parent) || []), name]);
    }
    const overlayBases = [...groups.entries()]
      .map(([path, environments]) => ({ path, environments: environments.sort() }))
      .sort((a, b) => b.environments.length - a.environments.length || a.path.localeCompare(b.path));
    res.json({ ref, overlayBases, kustomizations, empty: false });
  } catch (err: any) {
    res.status(500).json({ message: describeRequestError(err, 'GitLab') });
  }
};
