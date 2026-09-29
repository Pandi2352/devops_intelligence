import { IStarterRun, StarterPlan, StarterRun, StarterStep, StepState } from '../models/StarterRun.js';
import { IAiConnector } from '../models/AiConnector.js';
import { GitIntegration } from '../models/GitIntegration.js';
import { ChatMessage, complete, CompletionResult, describeAiError, recordUsage, ToolDef } from './openaiClient.js';
import { ECOSYSTEMS, Ecosystem, resolveVersion, VersionInfo } from './versionResolver.js';
import { describeGitError, publish, PublishInput, repoExists } from './gitPublisher.js';

// The AI Project Starter: interview → plan (with registry-verified versions) → files in batches → push.

export const LIMITS = { maxFiles: 150, maxFileBytes: 200_000, maxTotalBytes: 4_000_000, batchSize: 6 };

// ---------------------------------------------------------------- prompts

const INTERVIEW = `You are the Project Starter of DevOps Intelligence: a senior software architect who sets up NEW
software projects (any language, framework or platform: web frontends, backends/APIs, full-stack, mobile,
desktop, CLI tools, libraries, data/ML, games, microservices, monorepos…).

Your job in this chat: understand what the user wants to build and agree on a concrete setup.
- Ask short, specific questions, at most 3 per message, and propose a recommended default for each
  (e.g. "Frontend: React + Vite with TypeScript (recommended), Next.js, Vue, Angular, SvelteKit?").
- Cover only what matters for the setup: project type and scope; languages and frameworks; styling/UI kit;
  backend framework and API style; database and ORM; authentication; testing; lint/format; package manager;
  folder structure (single repo vs monorepo); Docker and docker-compose if wanted; CI file if wanted;
  license; README contents. Skip anything the user already answered or clearly does not need.
- Whenever you mention package, framework, runtime or base image versions, look them up first: put ALL of
  them in ONE lookup_latest_versions call (not one call per package). Never state a version from memory.
- When you have enough, summarize the final setup as a short bullet list (stack with verified versions,
  structure, tooling) and tell the user to press "Generate project" (they can still ask for changes).
- The user can say "use your recommendations" at any time: then pick sensible, popular, current defaults.
- This is only about creating the project files. Do not offer to deploy, run, build or host anything.
Answer in concise Markdown.`;

const PLAN = `You are generating the file plan for a new software project agreed in the conversation below.
Return JSON only, matching the schema.
- "stack": every framework, library, runtime, tool and base image the project uses, each with the exact
  latest version. Versions already verified in the conversation are listed below: reuse them. Look up ALL the
  remaining ones in ONE lookup_latest_versions call (at most two calls in total). If a lookup fails, use the
  newest version you are sure exists and write "unverified" in purpose. "ecosystem" is one of: ${ECOSYSTEMS.join(', ')}.
- "files": EVERY file of a complete, working starter project (source code, configuration, package manifests
  such as package.json / pyproject.toml / pom.xml / go.mod / *.csproj, lint/format/test config, .gitignore,
  .env.example, README.md, LICENSE if chosen, Dockerfile/compose/CI only if agreed). Use forward slashes,
  relative paths, no lock files, no binary files (no images, fonts, jars). Keep it a clean starter,
  not a full product: typically 15–60 files, at most ${LIMITS.maxFiles}.
- "setupInstructions": the commands a developer runs after cloning (install, run, test).`;

const FILES = `You are writing files of a new software project. Return JSON only, matching the schema, with the
COMPLETE content of exactly the requested files (no placeholders like "..." or "TODO: implement", no
markdown fences). Code must be correct, idiomatic, consistent with the plan and with the other files
listed, and use exactly the versions in the plan's stack. Package manifests must list those versions.
README.md explains the project, structure and setup commands. Never include secrets: use .env.example
with placeholder values.`;

// ---------------------------------------------------------------- tools and schemas

const lookupTool: ToolDef = {
  name: 'lookup_latest_version',
  description:
    'Latest stable version of a package, framework, runtime or Docker base image, read live from the official registry. ' +
    'Maven names are "groupId:artifactId"; Packagist names are "vendor/package"; runtimes use endoflife.date names (nodejs, python, go, java, dotnet, php, ruby, rust, kotlin, flutter, postgresql, mongodb, mysql, redis).',
  parameters: {
    type: 'object',
    properties: {
      ecosystem: { type: 'string', enum: ECOSYSTEMS, description: 'Registry to query' },
      name: { type: 'string', description: 'Exact package / image / runtime name' },
    },
    required: ['ecosystem', 'name'],
    additionalProperties: false,
  },
  run: async (args: { ecosystem: Ecosystem; name: string }) => {
    const v = await resolveVersion(args.ecosystem, String(args.name || ''));
    return { ecosystem: v.ecosystem, name: v.name, found: v.found, latest: v.latest, released: v.released, deprecated: v.deprecated, notes: v.notes };
  },
};

const batchLookupTool: ToolDef = {
  name: 'lookup_latest_versions',
  description:
    'Latest stable versions of MANY packages/frameworks/runtimes/images in ONE call (up to 40). Prefer this over lookup_latest_version. ' +
    'Maven names are "groupId:artifactId"; Packagist "vendor/package"; runtimes use endoflife.date names (nodejs, python, go, java, dotnet, php, ruby, rust, kotlin, flutter, postgresql, mongodb, mysql, redis).',
  parameters: {
    type: 'object',
    properties: {
      packages: {
        type: 'array',
        items: {
          type: 'object',
          properties: { ecosystem: { type: 'string', enum: ECOSYSTEMS }, name: { type: 'string' } },
          required: ['ecosystem', 'name'],
          additionalProperties: false,
        },
      },
    },
    required: ['packages'],
    additionalProperties: false,
  },
  run: async (args: { packages: { ecosystem: Ecosystem; name: string }[] }) => {
    const list = (args.packages || []).slice(0, 40);
    const found = await Promise.all(list.map((p) => resolveVersion(p.ecosystem, String(p.name || ''))));
    return found.map((v) => ({ ecosystem: v.ecosystem, name: v.name, found: v.found, latest: v.latest, deprecated: v.deprecated, notes: v.notes }));
  },
};

const TOOLS = [batchLookupTool, lookupTool];

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Repository-friendly project name (lowercase, dashes)' },
    summary: { type: 'string' },
    stack: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, ecosystem: { type: 'string' }, version: { type: 'string' }, purpose: { type: 'string' } },
        required: ['name', 'ecosystem', 'version', 'purpose'],
        additionalProperties: false,
      },
    },
    files: {
      type: 'array',
      items: { type: 'object', properties: { path: { type: 'string' }, purpose: { type: 'string' } }, required: ['path', 'purpose'], additionalProperties: false },
    },
    setupInstructions: { type: 'string' },
  },
  required: ['name', 'summary', 'stack', 'files', 'setupInstructions'],
  additionalProperties: false,
};

const FILES_SCHEMA = {
  type: 'object',
  properties: {
    files: {
      type: 'array',
      items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false },
    },
  },
  required: ['files'],
  additionalProperties: false,
};

// ---------------------------------------------------------------- helpers

// Relative, forward-slash paths inside the project; nothing in .git.
export const safePath = (raw: string): string | null => {
  const p = String(raw || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
  if (!p || p.length > 200 || p.endsWith('/')) return null;
  const parts = p.split('/');
  if (parts.some((s) => !s || s === '.' || s === '..' || s === '.git')) return null;
  if (!/^[\w@.+\-/ ()[\]]+$/.test(p)) return null;
  return p;
};

export const setStep = (run: IStarterRun, key: StarterStep['key'], state: StepState, message = '') => {
  const s = run.steps.find((x) => x.key === key);
  if (!s) return;
  if (state === 'running' && s.state !== 'running') s.startedAt = new Date();
  if (state === 'done' || state === 'failed' || state === 'skipped') s.finishedAt = new Date();
  s.state = state;
  if (message || state !== 'running') s.message = message;
  run.markModified('steps');
};

const addUsage = (run: IStarterRun, u: CompletionResult['usage']) => {
  run.usage.promptTokens += u.promptTokens;
  run.usage.completionTokens += u.completionTokens;
  run.usage.requests += u.requests;
};

const conversation = (run: IStarterRun): ChatMessage[] => run.messages.map((m) => ({ role: m.role, content: m.content }));
const transcript = (run: IStarterRun) => run.messages.map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content}`).join('\n\n').slice(-60000);

const versionsOf = (r: CompletionResult) =>
  r.toolCalls
    .flatMap((t) => (t.name === 'lookup_latest_versions' ? (t.result as VersionInfo[]) : t.name === 'lookup_latest_version' ? [t.result as VersionInfo] : []))
    .filter((v) => v && typeof v === 'object' && 'latest' in v)
    .map((v) => ({ ecosystem: v.ecosystem, name: v.name, latest: v.latest, found: v.found, notes: v.notes }));

// Latest verified version per package from the whole conversation (newest answer wins).
const verifiedInChat = (run: IStarterRun) => {
  const map = new Map<string, string>();
  for (const m of run.messages) for (const v of m.versions || []) if (v.found && v.latest) map.set(`${v.ecosystem}:${v.name}`, v.latest);
  return [...map.entries()].map(([k, latest]) => `${k}@${latest}`);
};

// ---------------------------------------------------------------- chat

export const chatTurn = async (run: IStarterRun, ai: IAiConnector, text: string) => {
  run.messages.push({ role: 'user', content: text.slice(0, 8000), at: new Date() });
  if (run.title === 'New project') run.title = text.replace(/\s+/g, ' ').slice(0, 70);
  const r = await complete(ai, {
    model: run.aiModel,
    messages: [{ role: 'system', content: INTERVIEW }, ...conversation(run)],
    tools: TOOLS,
    maxOutputTokens: 4000,
    maxToolRounds: 6,
    timeoutMs: 180000,
  });
  run.messages.push({ role: 'assistant', content: r.content, at: new Date(), versions: versionsOf(r) });
  run.markModified('messages');
  addUsage(run, r.usage);
  await recordUsage(String(ai._id), r.usage);
  // New input after generation means the files may be out of date.
  if (run.status === 'ready' || run.status === 'failed') run.status = 'chatting';
  await run.save();
  return run;
};

// ---------------------------------------------------------------- generate (runs in the background)

export const generate = async (runId: string, ai: IAiConnector) => {
  const run = await StarterRun.findById(runId);
  if (!run) return;
  try {
    run.status = 'generating';
    run.error = '';
    for (const k of ['plan', 'files', 'review', 'create-repo', 'upload', 'commit'] as const) setStep(run, k, 'pending');
    setStep(run, 'interview', 'done', `${run.messages.filter((m) => m.role === 'user').length} answers`);
    setStep(run, 'plan', 'running', 'Choosing the stack and checking the latest versions');
    await run.save();

    // 1. Plan with verified versions.
    const planRes = await complete(ai, {
      model: run.aiModel,
      messages: [
        { role: 'system', content: PLAN },
        {
          role: 'user',
          content: `Versions already verified from the registries (reuse, do not look up again):\n${verifiedInChat(run).join('\n') || '(none)'}\n\nConversation:\n\n${transcript(run)}`,
        },
      ],
      tools: TOOLS,
      jsonSchema: { name: 'project_plan', schema: PLAN_SCHEMA },
      maxOutputTokens: 12000,
      maxToolRounds: 6,
      timeoutMs: 180000,
      onProgress: async (e) => {
        const n = e.tools.reduce((sum, t) => sum + t.count, 0);
        setStep(run, 'plan', 'running', e.phase === 'tools' ? `Checking ${n} package version${n === 1 ? '' : 's'} in the registries…` : e.round === 0 ? 'Choosing the stack…' : 'Writing the plan…');
        await run.save();
      },
    });
    addUsage(run, planRes.usage);
    await recordUsage(String(ai._id), planRes.usage);
    const plan = JSON.parse(planRes.content) as StarterPlan;
    const seen = new Set<string>();
    plan.files = plan.files
      .map((f) => ({ ...f, path: safePath(f.path) || '' }))
      .filter((f) => f.path && !seen.has(f.path) && seen.add(f.path) && !/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|go\.sum)$/.test(f.path))
      .slice(0, LIMITS.maxFiles);
    if (!plan.files.length) throw new Error('The AI returned no files. Add more detail in the chat and try again.');
    run.plan = plan;
    run.markModified('plan');
    if (plan.name && run.title.length > 50) run.title = plan.name;
    setStep(run, 'plan', 'done', `${plan.stack.length} components, ${plan.files.length} files`);
    setStep(run, 'files', 'running', `0/${plan.files.length} files`);
    run.files = [];
    await run.save();

    // 2. Files in small batches (keeps every answer well under the output limit).
    const allPaths = plan.files.map((f) => `- ${f.path}: ${f.purpose}`).join('\n');
    const planText = JSON.stringify({ name: plan.name, summary: plan.summary, stack: plan.stack, setupInstructions: plan.setupInstructions });
    let total = 0;
    for (let i = 0; i < plan.files.length; i += LIMITS.batchSize) {
      const batch = plan.files.slice(i, i + LIMITS.batchSize);
      const res = await complete(ai, {
        model: run.aiModel,
        messages: [
          { role: 'system', content: FILES },
          {
            role: 'user',
            content: `Plan:\n${planText}\n\nAll files of the project:\n${allPaths}\n\nConversation (requirements):\n${transcript(run).slice(-20000)}\n\nWrite these files now:\n${batch.map((f) => `- ${f.path}: ${f.purpose}`).join('\n')}`,
          },
        ],
        jsonSchema: { name: 'project_files', schema: FILES_SCHEMA },
        maxOutputTokens: Math.max(ai.maxOutputTokens || 16000, 8000),
        timeoutMs: 180000,
      });
      addUsage(run, res.usage);
      await recordUsage(String(ai._id), res.usage);
      const out = (JSON.parse(res.content).files || []) as { path: string; content: string }[];
      for (const f of out) {
        const path = safePath(f.path);
        if (!path || !batch.some((b) => b.path === path)) continue;
        const content = String(f.content ?? '').slice(0, LIMITS.maxFileBytes);
        if (total + content.length > LIMITS.maxTotalBytes) throw new Error('The generated project is larger than 4 MB; ask for a smaller starter.');
        total += content.length;
        run.files = [...run.files.filter((x) => x.path !== path), { path, content }];
      }
      setStep(run, 'files', 'running', `${Math.min(i + LIMITS.batchSize, plan.files.length)}/${plan.files.length} files`);
      await run.save();
    }
    const missing = plan.files.filter((f) => !run.files.some((x) => x.path === f.path)).map((f) => f.path);
    setStep(run, 'files', 'done', `${run.files.length} files${missing.length ? ` (${missing.length} skipped by the AI: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''})` : ''}`);
    setStep(run, 'review', 'running', 'Check the files, then push to a repository');
    run.status = 'ready';
    await run.save();
  } catch (err: any) {
    const message = err?.response ? describeAiError(err) : err instanceof SyntaxError ? 'The AI returned invalid JSON; try Generate again.' : err?.message || 'Generation failed';
    run.status = 'failed';
    run.error = message;
    const current = run.steps.find((s) => s.state === 'running');
    if (current) setStep(run, current.key, 'failed', message);
    await run.save().catch(() => undefined);
  }
};

// ---------------------------------------------------------------- publish (runs in the background)

export const publishRun = async (runId: string, input: Omit<PublishInput, 'files'> & { gitConnectorId: string; ownerName: string }) => {
  const run = await StarterRun.findById(runId);
  if (!run) return;
  const git = await GitIntegration.findById(input.gitConnectorId);
  if (!git) return;
  const provider = git.provider === 'github' ? 'GitHub' : 'GitLab';
  try {
    run.status = 'publishing';
    run.error = '';
    setStep(run, 'review', 'done', 'Approved');
    for (const k of ['create-repo', 'upload', 'commit'] as const) setStep(run, k, 'pending');
    setStep(run, 'create-repo', 'running');
    await run.save();

    const result = await publish(git, { ...input, files: run.files }, async (step, message) => {
      if (step === 'upload') {
        setStep(run, 'create-repo', 'done', `${input.ownerName}/${input.name}`);
        setStep(run, 'upload', 'running', message);
      } else if (step === 'commit') {
        if (run.steps.find((s) => s.key === 'upload')?.state !== 'done') setStep(run, 'upload', 'done', `${run.files.length} files`);
        setStep(run, 'commit', 'running', message);
      } else setStep(run, 'create-repo', 'running', message);
      await run.save();
    });
    setStep(run, 'commit', 'done', `${result.branch} @ ${result.commit}`);
    run.repo = {
      connectorId: String(git._id),
      provider: git.provider,
      owner: input.ownerName,
      name: input.name,
      visibility: input.visibility,
      url: result.url,
      fullName: result.fullName,
      branch: result.branch,
      commit: result.commit,
    };
    run.markModified('repo');
    run.status = 'published';
    await run.save();
  } catch (err: any) {
    const message = describeGitError(err, provider);
    run.status = 'failed';
    run.error = message;
    const current = run.steps.find((s) => s.state === 'running');
    if (current) setStep(run, current.key, 'failed', message);
    await run.save().catch(() => undefined);
  }
};

export { repoExists };

// Generation and pushing run inside this process, so a restart ends them. Called once at startup:
// anything still marked as running was interrupted and can be started again.
export const recoverInterruptedRuns = async () => {
  const stuck = await StarterRun.find({ status: { $in: ['generating', 'publishing'] } });
  for (const run of stuck) {
    run.status = 'failed';
    run.error = 'Interrupted: the server restarted while this was running. Press the button again to retry.';
    const current = run.steps.find((s) => s.state === 'running');
    if (current) setStep(run, current.key, 'failed', run.error);
    await run.save();
  }
  if (stuck.length) console.log(`[Project Starter] marked ${stuck.length} interrupted run(s) as failed`);
};
