import { Response } from 'express';
import axios, { AxiosInstance } from 'axios';
import { AuthRequest } from '../middleware/auth.js';
import { Project, IProject, IArgoAppMapping } from '../models/Project.js';
import { GitIntegration, IGitIntegration } from '../models/GitIntegration.js';
import { argoRequest, syncArgoApp } from './argoController.js';
import { resolveClients } from './clusterController.js';
import { describeRequestError } from '../utils/httpError.js';
import { isValidId } from '../utils/validation.js';

// Environments = the ArgoCD apps mapped on a DevOps Intelligence project. For each one we combine:
//   ArgoCD      → sync/health, synced GitOps revision, live image
//   GitOps repo → the image tag Git *wants* (overlay kustomization.yaml)
//   CI image tag → <env>-<yyyymmddhhmm>-<sha8>-<pipelineId> → app commit + pipeline
//   Kubernetes  → ready pods
//   App repo    → (branch flow) the environment branch head and its latest pipeline
//
// Two promotion flows are supported:
//   branch flow  (mapping has `branch`): promote = fast-forward merge request dev → qa → staging → prod
//   publish flow (no branches):          promote = run the manual `publish_argocd:<env>` job, then sync

export const ENV_ORDER = ['local', 'dev', 'development', 'qa', 'test', 'staging', 'uat', 'preprod', 'prod', 'production'];
const TAG_PATTERN = /^(.+)-(\d{12})-([0-9a-f]{7,40})-(\d+)$/;
const IN_PROGRESS = new Set(['created', 'pending', 'running', 'waiting_for_resource', 'preparing']);

interface ParsedImage {
  image: string;
  repoPath: string;
  tag: string;
  commitSha?: string;
  pipelineId?: number;
  builtAt?: string;
  commitTitle?: string;
  commitAuthor?: string;
  commitUrl?: string;
  pipelineStatus?: string;
  pipelineUrl?: string;
}

interface CommitRef {
  sha: string;
  title: string;
  author: string;
  date: string;
  webUrl: string;
}

interface EnvironmentView {
  key: string;
  appName: string;
  namespace: string;
  cluster: string;
  autoSync: boolean;
  sync: string;
  health: string;
  operation: { phase: string; message: string } | null;
  argoUrl: string;
  gitopsRepo: string;
  gitopsPath: string;
  syncedRevision: CommitRef | null;
  live: ParsedImage | null;
  desired: ParsedImage | null;
  pods: { ready: number; desired: number } | null;
  branch?: string;
  branchHead?: CommitRef | null;
  branchPipeline?: { id: number; status: string; sha: string; webUrl: string } | null;
  /** Latest GitOps commit that changed this environment's overlay (deploy or rollback). */
  lastChange?: (CommitRef & { kind: 'deploy' | 'rollback' | 'other' }) | null;
}

type PromotionState =
  | 'up-to-date'
  | 'ready'
  | 'review'
  | 'blocked'
  | 'diverged'
  | 'publishing'
  | 'needs-sync'
  | 'syncing'
  | 'failed'
  | 'rolled-back'
  | 'unavailable';

interface PromotionView {
  from: string;
  to: string;
  mode: 'branch' | 'publish';
  state: PromotionState;
  message: string;
  fromTag?: string;
  toLiveTag?: string;
  toDesiredTag?: string;
  pipelineId?: number;
  job?: { id: number; name: string; status: string; webUrl: string };
  fromBranch?: string;
  toBranch?: string;
  commits?: { shortId: string; title: string; author: string }[];
  aheadBy?: number;
  mergeRequest?: { iid: number; title: string; webUrl: string; status: string; author: string };
}

const envKeyFor = (appName: string, namespace: string) => {
  const candidates = [appName.split('-').pop() || '', namespace.split('-').pop() || ''];
  return candidates.find((c) => ENV_ORDER.includes(c)) || appName;
};

const parseImage = (image?: string): ParsedImage | null => {
  if (!image) return null;
  const lastColon = image.lastIndexOf(':');
  const hasTag = lastColon > image.lastIndexOf('/');
  const name = hasTag ? image.slice(0, lastColon) : image;
  const tag = hasTag ? image.slice(lastColon + 1) : 'latest';
  const m = TAG_PATTERN.exec(tag);
  const builtAt = m
    ? `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6, 8)}T${m[2].slice(8, 10)}:${m[2].slice(10, 12)}:00Z`
    : undefined;
  return { image, repoPath: name.split('/').slice(1).join('/'), tag, commitSha: m?.[3], pipelineId: m ? Number(m[4]) : undefined, builtAt };
};

export const repoPathFromUrl = (url: string) => {
  try {
    return new URL(url).pathname.replace(/^\/+/, '').replace(/\.git$/, '');
  } catch {
    return '';
  }
};

const hostOf = (url?: string) => {
  try {
    return url ? new URL(url).host : '';
  } catch {
    return '';
  }
};

// The GitLab connector whose host serves the repos (falls back to the default active one).
export const pickConnector = async (repoUrl: string): Promise<IGitIntegration | null> => {
  const all = await GitIntegration.find({ provider: 'gitlab', isActive: true });
  const host = hostOf(repoUrl);
  return (
    all.find((g) => g.isDefault && hostOf(g.baseUrl) === host) ||
    all.find((g) => hostOf(g.baseUrl) === host) ||
    all.find((g) => g.isDefault) ||
    all[0] ||
    null
  );
};

export const gitlabClient = (g: IGitIntegration): AxiosInstance =>
  axios.create({ baseURL: `${g.baseUrl || 'https://gitlab.com'}/api/v4`, headers: { 'PRIVATE-TOKEN': g.token }, timeout: 15000 });

const project = (path: string) => `/projects/${encodeURIComponent(path)}`;
const soft = async <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
const toCommitRef = (c: any): CommitRef => ({ sha: c.short_id, title: c.title, author: c.author_name, date: c.committed_date, webUrl: c.web_url });

interface Context {
  gl: AxiosInstance | null;
  appRepo: string; // path of the application repo (branch flow)
  argoServerUrl: string;
  clusterName: string;
  cache: Map<string, Promise<any>>;
}

// Images are pushed to <app repo>/<env>; commits and pipelines live in the app repo itself.
const sourceRepo = (ctx: Context, image: ParsedImage) => ctx.appRepo || image.repoPath;

const changeKind = (title: string): 'deploy' | 'rollback' | 'other' =>
  /^rollback\(/.test(title) ? 'rollback' : /^deploy\(/.test(title) ? 'deploy' : 'other';

const cached = <T>(ctx: Context, key: string, load: () => Promise<T>): Promise<T | null> => {
  if (!ctx.cache.has(key)) ctx.cache.set(key, soft(load()));
  return ctx.cache.get(key) as Promise<T | null>;
};

const describeEnvironment = async (app: any, mapping: IArgoAppMapping | undefined, ctx: Context): Promise<EnvironmentView> => {
  const spec = app.spec || {};
  const status = app.status || {};
  const namespace = spec.destination?.namespace || '';
  const gitopsRepo = spec.source?.repoURL || '';
  const gitopsPath = spec.source?.path || '';
  const gitopsProject = repoPathFromUrl(gitopsRepo);
  const syncedSha: string = status.sync?.revision || '';
  const { gl } = ctx;

  const view: EnvironmentView = {
    key: mapping?.environment || envKeyFor(app.metadata.name, namespace),
    appName: app.metadata.name,
    namespace,
    cluster: ctx.clusterName,
    autoSync: Boolean(spec.syncPolicy?.automated),
    sync: status.sync?.status || 'Unknown',
    health: status.health?.status || 'Unknown',
    operation: status.operationState ? { phase: status.operationState.phase, message: status.operationState.message || '' } : null,
    argoUrl: `${ctx.argoServerUrl}/applications/argocd/${app.metadata.name}`,
    gitopsRepo,
    gitopsPath,
    syncedRevision: null,
    live: parseImage(status.summary?.images?.[0]),
    desired: null,
    pods: null,
    branch: mapping?.branch || undefined,
  };

  const tasks: Promise<void>[] = [];

  if (gl && gitopsProject) {
    tasks.push(
      (async () => {
        const [revision, overlay, changes] = await Promise.all([
          syncedSha ? cached(ctx, `c:${gitopsProject}:${syncedSha}`, () => gl.get(`${project(gitopsProject)}/repository/commits/${syncedSha}`)) : null,
          soft(
            gl.get(`${project(gitopsProject)}/repository/files/${encodeURIComponent(`${gitopsPath}/kustomization.yaml`)}/raw`, {
              params: { ref: spec.source?.targetRevision || 'HEAD' },
              responseType: 'text',
              transformResponse: (d) => d,
            })
          ),
          soft(gl.get(`${project(gitopsProject)}/repository/commits`, { params: { path: `${gitopsPath}/kustomization.yaml`, per_page: 1 } })),
        ]);
        if (revision) view.syncedRevision = toCommitRef((revision as any).data);
        const latest = (changes as any)?.data?.[0];
        if (latest) view.lastChange = { ...toCommitRef(latest), kind: changeKind(latest.title) };
        const text = overlay ? String((overlay as any).data) : '';
        const newName = /newName:\s*["']?([^\s"']+)/.exec(text)?.[1];
        const newTag = /newTag:\s*["']?([^\s"']+)/.exec(text)?.[1];
        if (newName && newTag) view.desired = parseImage(`${newName}:${newTag}`);
      })()
    );
  }

  const live = view.live;
  const liveRepo = live ? sourceRepo(ctx, live) : '';
  if (gl && liveRepo && live && (live.commitSha || live.pipelineId)) {
    tasks.push(
      (async () => {
        const [commit, pipeline] = await Promise.all([
          live.commitSha ? cached(ctx, `c:${liveRepo}:${live.commitSha}`, () => gl.get(`${project(liveRepo)}/repository/commits/${live.commitSha}`)) : null,
          live.pipelineId ? cached(ctx, `p:${liveRepo}:${live.pipelineId}`, () => gl.get(`${project(liveRepo)}/pipelines/${live.pipelineId}`)) : null,
        ]);
        if (commit) {
          const c = (commit as any).data;
          Object.assign(live, { commitTitle: c.title, commitAuthor: c.author_name, commitUrl: c.web_url });
        }
        if (pipeline) {
          const p = (pipeline as any).data;
          Object.assign(live, { pipelineStatus: p.status, pipelineUrl: p.web_url });
        }
      })()
    );
  }

  // Branch flow: what is on the environment branch, and is its latest pipeline still running?
  if (gl && ctx.appRepo && view.branch) {
    const branch = view.branch;
    tasks.push(
      (async () => {
        const [branchRes, pipelinesRes] = await Promise.all([
          cached(ctx, `b:${ctx.appRepo}:${branch}`, () => gl.get(`${project(ctx.appRepo)}/repository/branches/${encodeURIComponent(branch)}`)),
          soft(gl.get(`${project(ctx.appRepo)}/pipelines`, { params: { ref: branch, per_page: 1 } })),
        ]);
        view.branchHead = branchRes ? toCommitRef((branchRes as any).data.commit) : null;
        const p = (pipelinesRes as any)?.data?.[0];
        view.branchPipeline = p ? { id: p.id, status: p.status, sha: String(p.sha).slice(0, 8), webUrl: p.web_url } : null;
      })()
    );
  }

  if (namespace && ctx.clusterName) {
    tasks.push(
      (async () => {
        try {
          const { apps } = await resolveClients(ctx.clusterName);
          const deps: any = await apps.listNamespacedDeployment({ namespace });
          const items = deps.items || [];
          if (items.length) {
            view.pods = {
              ready: items.reduce((n: number, d: any) => n + (d.status?.readyReplicas || 0), 0),
              desired: items.reduce((n: number, d: any) => n + (d.spec?.replicas || 0), 0),
            };
          }
        } catch {
          view.pods = null;
        }
      })()
    );
  }

  await Promise.all(tasks);
  return view;
};

// ---------------------------------------------------------------- branch flow
const describeBranchPromotion = async (from: EnvironmentView, to: EnvironmentView, ctx: Context): Promise<PromotionView> => {
  const base: PromotionView = {
    from: from.key,
    to: to.key,
    mode: 'branch',
    state: 'unavailable',
    message: '',
    fromBranch: from.branch,
    toBranch: to.branch,
    fromTag: from.live?.tag,
    toLiveTag: to.live?.tag,
  };
  const { gl, appRepo } = ctx;
  if (!gl || !appRepo) return { ...base, message: 'The application repository is not mapped on this project.' };
  if (!from.branchHead) return { ...base, message: `Branch ${from.branch} does not exist yet.` };
  if (!to.branchHead) {
    return { ...base, state: 'ready', message: `Branch ${to.branch} does not exist yet. Promoting creates it from ${from.branch}.`, aheadBy: undefined };
  }

  const compare = (fromRef: string, toRef: string) =>
    soft(gl.get(`${project(appRepo)}/repository/compare`, { params: { from: fromRef, to: toRef, straight: true } }));
  const [ahead, behind, mrs] = await Promise.all([
    compare(to.branch!, from.branch!), // commits on from that to does not have
    compare(from.branch!, to.branch!), // commits on to that from does not have
    soft(gl.get(`${project(appRepo)}/merge_requests`, { params: { state: 'opened', source_branch: from.branch, target_branch: to.branch } })),
  ]);

  const aheadCommits = ((ahead as any)?.data?.commits || []) as any[];
  const behindCommits = ((behind as any)?.data?.commits || []) as any[];
  const commits = aheadCommits
    .slice(-5)
    .reverse()
    .map((c) => ({ shortId: c.short_id, title: c.title, author: c.author_name }));

  if (aheadCommits.length === 0) {
    // Branches match. Up to date only once the target environment actually runs the branch head.
    const head = to.branchHead.sha;
    const live = to.live?.commitSha;
    const sameCommit = (a?: string, b?: string) => Boolean(a && b && (a.startsWith(b) || b.startsWith(a)));
    if (sameCommit(live, head)) {
      if (to.health !== 'Healthy') {
        return { ...base, state: 'syncing', aheadBy: 0, message: `Rolling out ${head} in ${to.key}: ${to.health}.` };
      }
      return { ...base, state: 'up-to-date', aheadBy: 0, message: `${to.key} runs ${head}, the head of ${to.branch}.` };
    }
    const pipeline = to.branchPipeline;
    if (pipeline && IN_PROGRESS.has(pipeline.status)) {
      return { ...base, state: 'publishing', aheadBy: 0, message: `The ${to.branch} pipeline #${pipeline.id} is building and publishing ${head}.` };
    }
    if (pipeline && (pipeline.status === 'failed' || pipeline.status === 'canceled')) {
      return { ...base, state: 'failed', aheadBy: 0, message: `The ${to.branch} pipeline #${pipeline.id} ${pipeline.status}, so ${head} was not published to ${to.key}.` };
    }
    if (to.lastChange?.kind === 'rollback') {
      return {
        ...base,
        state: 'rolled-back',
        aheadBy: 0,
        message: `${to.key} was rolled back (${to.lastChange.title.replace(/^rollback\([^)]*\):\s*/, '')}). ${to.branch} head ${head} is not deployed: fix forward and promote, or redeploy the head.`,
      };
    }
    if (sameCommit(to.desired?.commitSha, head)) {
      return to.autoSync
        ? { ...base, state: 'syncing', aheadBy: 0, message: `Git points ${to.key} at ${head}. ArgoCD deploys it within ~3 minutes, or sync now.` }
        : { ...base, state: 'needs-sync', aheadBy: 0, message: `Git points ${to.key} at ${head}. Sync ${to.appName} to deploy it (production approval).` };
    }
    return { ...base, state: 'publishing', aheadBy: 0, message: `Waiting for the ${to.branch} pipeline to publish ${head}.` };
  }
  if (behindCommits.length > 0) {
    return {
      ...base,
      state: 'diverged',
      aheadBy: aheadCommits.length,
      commits,
      message: `${to.branch} has ${behindCommits.length} commit(s) that ${from.branch} does not (e.g. a hotfix). Merge ${to.branch} back into ${from.branch} first, so promotion stays fast-forward.`,
    };
  }

  const mr = (mrs as any)?.data?.[0];
  if (mr) {
    const mergeStatus: string = mr.detailed_merge_status || mr.merge_status || 'unknown';
    const mergeRequest = { iid: mr.iid, title: mr.title, webUrl: mr.web_url, status: mergeStatus, author: mr.author?.name || '' };
    if (mergeStatus === 'mergeable') {
      return {
        ...base,
        state: 'review',
        aheadBy: aheadCommits.length,
        commits,
        mergeRequest,
        message: `Merge request !${mr.iid} is ready. Merging fast-forwards ${to.branch} and deploys to ${to.key}.`,
      };
    }
    return {
      ...base,
      state: 'blocked',
      aheadBy: aheadCommits.length,
      commits,
      mergeRequest,
      message: `Merge request !${mr.iid} cannot be merged yet (${mergeStatus.replace(/_/g, ' ')}).`,
    };
  }

  return {
    ...base,
    state: 'ready',
    aheadBy: aheadCommits.length,
    commits,
    message: `${from.branch} is ${aheadCommits.length} commit(s) ahead of ${to.branch}. Open a merge request to promote.`,
  };
};

// ---------------------------------------------------------------- publish flow
const describePublishPromotion = async (from: EnvironmentView, to: EnvironmentView, ctx: Context): Promise<PromotionView> => {
  const base: PromotionView = {
    from: from.key,
    to: to.key,
    mode: 'publish',
    state: 'unavailable',
    message: '',
    fromTag: from.live?.tag,
    toLiveTag: to.live?.tag,
    toDesiredTag: to.desired?.tag,
    pipelineId: from.live?.pipelineId,
  };
  if (!from.live) return { ...base, message: `Nothing is running in ${from.key} yet.` };

  const fromTag = from.live.tag;
  if (to.live?.tag === fromTag && to.sync === 'Synced') {
    if (to.health === 'Healthy') return { ...base, state: 'up-to-date', message: `${to.key} runs the same build as ${from.key}.` };
    const pods = to.pods ? ` (${to.pods.ready}/${to.pods.desired} pods ready)` : '';
    return { ...base, state: 'syncing', message: `Rolling out ${fromTag} in ${to.key}: ${to.health}${pods}.` };
  }
  if (to.desired?.tag === fromTag) {
    const syncing = to.operation?.phase === 'Running';
    return {
      ...base,
      state: syncing ? 'syncing' : 'needs-sync',
      message: syncing
        ? `ArgoCD is deploying ${fromTag} to ${to.key}.`
        : `The GitOps repo already points ${to.key} at this build. Sync ${to.appName} to deploy it.`,
    };
  }
  if (!ctx.gl || !from.live.pipelineId || !sourceRepo(ctx, from.live)) {
    return { ...base, message: 'The running image tag does not identify the pipeline that built it.' };
  }

  const jobName = `publish_argocd:${to.key}`;
  const jobs = await soft(
    ctx.gl.get(`${project(sourceRepo(ctx, from.live))}/pipelines/${from.live.pipelineId}/jobs`, { params: { per_page: 100 } })
  );
  const job = (jobs as any)?.data?.find((j: any) => j.name === jobName);
  if (!job) return { ...base, message: `Pipeline #${from.live.pipelineId} has no ${jobName} job.` };
  const jobView = { id: job.id, name: job.name, status: job.status, webUrl: job.web_url };
  if (job.status === 'manual') {
    return { ...base, job: jobView, state: 'ready', message: `Run ${jobName} in pipeline #${from.live.pipelineId} to publish this build to ${to.key}.` };
  }
  if (IN_PROGRESS.has(job.status)) {
    return { ...base, job: jobView, state: 'publishing', message: `${jobName} is ${job.status}; it commits the new tag to the GitOps repo.` };
  }
  if (job.status === 'failed' || job.status === 'canceled') {
    return { ...base, job: jobView, state: 'failed', message: `${jobName} ${job.status}. Check its log, then retry.` };
  }
  return {
    ...base,
    job: jobView,
    message: `${jobName} already ran for this build, but ${to.key} now points at ${to.desired?.tag || 'another build'}.`,
  };
};

const loadProjectEnvironments = async (projectDoc: IProject) => {
  const mappings = (projectDoc.argoApps || []).filter((a) => a.appName);
  const clusterName = projectDoc.kubernetesMappings?.[0]?.clusterName || '';

  const apps: { app: any; mapping: IArgoAppMapping }[] = [];
  let argoServerUrl = '';
  const errors: string[] = [];
  await Promise.all(
    mappings.map(async (mapping) => {
      try {
        const { data, serverUrl } = await argoRequest('get', `/api/v1/applications/${encodeURIComponent(mapping.appName)}`);
        argoServerUrl = serverUrl;
        apps.push({ app: data, mapping });
      } catch (err) {
        errors.push(`${mapping.appName}: ${describeRequestError(err, 'ArgoCD')}`);
      }
    })
  );

  const gitopsUrl = apps[0]?.app.spec?.source?.repoURL || '';
  const gitopsPath = repoPathFromUrl(gitopsUrl);
  const appRepoUrl = (projectDoc.gitLabRepos || []).map((r) => r.repoUrl).find((url) => repoPathFromUrl(url) !== gitopsPath) || '';
  const connector = await pickConnector(appRepoUrl || gitopsUrl);

  const ctx: Context = {
    gl: connector ? gitlabClient(connector) : null,
    appRepo: repoPathFromUrl(appRepoUrl),
    argoServerUrl,
    clusterName,
    cache: new Map(),
  };

  const environments = (await Promise.all(apps.map(({ app, mapping }) => describeEnvironment(app, mapping, ctx)))).sort(
    (a, b) => (ENV_ORDER.indexOf(a.key) + 1 || 99) - (ENV_ORDER.indexOf(b.key) + 1 || 99)
  );

  const promotions: PromotionView[] = [];
  for (let i = 0; i < environments.length - 1; i++) {
    const [from, to] = [environments[i], environments[i + 1]];
    promotions.push(from.branch && to.branch ? await describeBranchPromotion(from, to, ctx) : await describePublishPromotion(from, to, ctx));
  }

  return { environments, promotions, ctx, errors, flow: environments.some((e) => e.branch) ? 'branch' : 'publish' };
};

const findProject = async (id: unknown) => (isValidId(id) ? Project.findById(id) : null);

export const getProjectEnvironments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectDoc = await findProject(req.params.id);
    if (!projectDoc) {
      res.status(404).json({ message: 'Project not found' });
      return;
    }
    const { environments, promotions, errors, flow, ctx } = await loadProjectEnvironments(projectDoc);
    res.json({ project: { _id: projectDoc._id, name: projectDoc.name, appRepo: ctx.appRepo }, flow, environments, promotions, errors });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to load environments', error: err.message });
  }
};

// Runs the next promotion step. The action is always re-validated against the current state:
//   branch flow:  open a merge request, or merge the open one (fast-forward)
//   publish flow: play/retry the publish job
export const promoteEnvironment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectDoc = await findProject(req.params.id);
    if (!projectDoc) {
      res.status(404).json({ message: 'Project not found' });
      return;
    }
    const { from, to } = req.body || {};
    const { promotions, environments, ctx } = await loadProjectEnvironments(projectDoc);
    const promotion = promotions.find((p) => p.from === from && p.to === to);
    const gl = ctx.gl;
    if (!promotion || !gl) {
      res.status(400).json({ message: `No promotion from ${from} to ${to} is possible right now` });
      return;
    }

    if (promotion.mode === 'branch') {
      const repo = project(ctx.appRepo);
      if (promotion.state === 'ready') {
        const target = environments.find((e) => e.key === to);
        if (!target?.branchHead) {
          const created = await gl.post(`${repo}/repository/branches`, null, { params: { branch: promotion.toBranch, ref: promotion.fromBranch } });
          res.json({ message: `Created branch ${promotion.toBranch} from ${promotion.fromBranch} (${created.data.commit.short_id}). Its pipeline deploys ${to}.` });
          return;
        }
        const titleCommit = promotion.commits?.[0]?.title || 'latest changes';
        const description = [
          `Promotes **${promotion.fromBranch} → ${promotion.toBranch}** (environment \`${to}\`).`,
          '',
          ...(promotion.commits || []).map((c) => `- ${c.shortId} ${c.title} (${c.author})`),
          '',
          `Opened from DevOps Intelligence by ${req.user?.name || req.user?.email || 'a DevOps Intelligence user'}.`,
        ].join('\n');
        const mr = await gl.post(`${repo}/merge_requests`, {
          source_branch: promotion.fromBranch,
          target_branch: promotion.toBranch,
          title: `Promote ${from} → ${to}: ${titleCommit}`,
          description,
          remove_source_branch: false,
          squash: false,
        });
        res.json({ message: `Opened merge request !${mr.data.iid} (${promotion.fromBranch} → ${promotion.toBranch}).`, mergeRequest: { iid: mr.data.iid, webUrl: mr.data.web_url } });
        return;
      }
      if (promotion.state === 'review' && promotion.mergeRequest) {
        const merged = await gl.put(`${repo}/merge_requests/${promotion.mergeRequest.iid}/merge`, { squash: false, should_remove_source_branch: false });
        res.json({
          message: `Merged !${promotion.mergeRequest.iid} into ${promotion.toBranch}. The ${promotion.toBranch} pipeline now deploys it to ${to}.`,
          mergeRequest: { iid: merged.data.iid, webUrl: merged.data.web_url, sha: merged.data.merge_commit_sha || merged.data.sha },
        });
        return;
      }
      res.status(409).json({ message: promotion.message, promotion });
      return;
    }

    if (promotion.state !== 'ready' && promotion.state !== 'failed') {
      res.status(409).json({ message: promotion.message, promotion });
      return;
    }
    const source = environments.find((e) => e.key === from);
    const action = promotion.state === 'ready' ? 'play' : 'retry';
    const jobRes = await gl.post(`${project(sourceRepo(ctx, source!.live!))}/jobs/${promotion.job!.id}/${action}`);
    const job = jobRes.data;
    res.json({
      message: `${job.name} ${action === 'play' ? 'started' : 'retried'} (job #${job.id}). When it finishes, sync ${to}.`,
      job: { id: job.id, name: job.name, status: job.status, webUrl: job.web_url },
    });
  } catch (err: any) {
    res.status(500).json({ message: describeRequestError(err, 'GitLab') });
  }
};

// ---------------------------------------------------------------- history, rollback, redeploy, details

const TAG_IN_TITLE = /^(deploy|rollback)\(([^)]*)\):\s*\S+\s+(\S+)/;

// Loads the project and one of its environments, or answers 404/400 itself.
const loadEnvironment = async (req: AuthRequest, res: Response) => {
  const projectDoc = await findProject(req.params.id);
  if (!projectDoc) {
    res.status(404).json({ message: 'Project not found' });
    return null;
  }
  const loaded = await loadProjectEnvironments(projectDoc);
  const env = loaded.environments.find((e) => e.key === req.params.env);
  if (!env) {
    res.status(404).json({ message: `Environment '${req.params.env}' not found on project ${projectDoc.name}` });
    return null;
  }
  if (!loaded.ctx.gl) {
    res.status(400).json({ message: 'No active GitLab connector can read this project' });
    return null;
  }
  return { projectDoc, env, ...loaded, gl: loaded.ctx.gl };
};

const overlayFile = (env: EnvironmentView) => `${env.gitopsPath}/kustomization.yaml`;

// Every GitOps commit that changed the environment's overlay: the deploy history ArgoCD applied.
export const getEnvironmentHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadEnvironment(req, res);
    if (!loaded) return;
    const { env, gl, ctx } = loaded;
    const gitopsProject = repoPathFromUrl(env.gitopsRepo);
    const commits = (
      await gl.get(`${project(gitopsProject)}/repository/commits`, { params: { path: overlayFile(env), per_page: 15 } })
    ).data as any[];

    const entries = await Promise.all(
      commits.map(async (c) => {
        const match = TAG_IN_TITLE.exec(c.title);
        const image = match ? parseImage(`x/${ctx.appRepo || 'app'}:${match[3]}`) : null;
        const appCommit =
          image?.commitSha && ctx.appRepo
            ? await cached(ctx, `c:${ctx.appRepo}:${image.commitSha}`, () => gl.get(`${project(ctx.appRepo)}/repository/commits/${image.commitSha}`))
            : null;
        return {
          sha: c.short_id,
          id: c.id,
          title: c.title,
          author: c.author_name,
          date: c.committed_date,
          webUrl: c.web_url,
          kind: changeKind(c.title),
          tag: match?.[3] || null,
          appCommit: appCommit ? { sha: (appCommit as any).data.short_id, title: (appCommit as any).data.title } : null,
          isLive: Boolean(match && env.live && match[3] === env.live.tag),
          isDesired: Boolean(match && env.desired && match[3] === env.desired.tag),
        };
      })
    );
    res.json({ environment: env.key, overlay: overlayFile(env), entries });
  } catch (err: any) {
    res.status(500).json({ message: describeRequestError(err, 'GitLab') });
  }
};


// Rollback = commit the image from an earlier deploy back into the overlay, then sync.
// Git stays the source of truth: the rollback itself is a commit anyone can see and revert.
export const rollbackEnvironment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadEnvironment(req, res);
    if (!loaded) return;
    const { env, gl } = loaded;
    const target = String(req.body?.sha || '');
    if (!/^[0-9a-f]{7,40}$/.test(target)) {
      res.status(400).json({ message: 'Choose a deploy from the history to roll back to' });
      return;
    }
    const gitopsProject = project(repoPathFromUrl(env.gitopsRepo));
    const file = encodeURIComponent(overlayFile(env));
    const raw = (ref: string) =>
      gl.get(`${gitopsProject}/repository/files/${file}/raw`, { params: { ref }, responseType: 'text', transformResponse: (d) => d });

    // The history entry must really have changed this environment's overlay.
    const history = (await gl.get(`${gitopsProject}/repository/commits`, { params: { path: overlayFile(env), per_page: 50 } })).data as any[];
    const entry = history.find((c) => c.id.startsWith(target) || c.short_id === target);
    if (!entry || changeKind(entry.title) === 'other') {
      res.status(400).json({ message: 'That commit is not a deploy of this environment' });
      return;
    }

    const [oldFile, currentFile] = await Promise.all([raw(entry.id), raw('main')]);
    const pick = (text: string, key: string) => new RegExp(`${key}:\\s*["']?([^\\s"']+)`).exec(text)?.[1];
    const oldName = pick(String(oldFile.data), 'newName');
    const oldTag = pick(String(oldFile.data), 'newTag');
    const current = String(currentFile.data);
    const currentTag = pick(current, 'newTag');
    if (!oldName || !oldTag) {
      res.status(400).json({ message: 'Could not read the image of that deploy' });
      return;
    }
    if (oldTag === currentTag) {
      res.status(409).json({ message: `${env.key} already points at ${oldTag}` });
      return;
    }

    const updated = current
      .replace(/(newName:\s*)["']?[^\s"']+["']?/, `$1${oldName}`)
      .replace(/(newTag:\s*)["']?[^\s"']+["']?/, `$1${oldTag}`);
    const who = req.user?.email || req.user?.name || 'DevOps Intelligence';
    await gl.put(`${gitopsProject}/repository/files/${file}`, {
      branch: 'main',
      content: updated,
      commit_message: `rollback(${env.key}): demo-api ${oldTag} (was ${currentTag}) by ${who}`,
    });

    let syncMessage = 'ArgoCD sync started.';
    try {
      const synced = await syncArgoApp(env.appName);
      if (!synced.revision) syncMessage = synced.message;
    } catch (err) {
      syncMessage = `Committed, but starting the ArgoCD sync failed: ${describeRequestError(err, 'ArgoCD')}`;
    }
    res.json({ message: `${env.key} rolled back to ${oldTag}. ${syncMessage}` });
  } catch (err: any) {
    res.status(500).json({ message: describeRequestError(err, 'GitLab') });
  }
};

// Branch flow: run the environment branch pipeline again, which republishes the branch head.
export const redeployEnvironment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadEnvironment(req, res);
    if (!loaded) return;
    const { env, gl, ctx } = loaded;
    if (!env.branch || !ctx.appRepo) {
      res.status(400).json({ message: `${env.key} is not deployed from a branch` });
      return;
    }
    const pipeline = (await gl.post(`${project(ctx.appRepo)}/pipeline`, null, { params: { ref: env.branch } })).data;
    res.json({ message: `Pipeline #${pipeline.id} started on ${env.branch}. It rebuilds and deploys ${String(pipeline.sha).slice(0, 8)} to ${env.key}.` });
  } catch (err: any) {
    res.status(500).json({ message: describeRequestError(err, 'GitLab') });
  }
};

// ArgoCD view of one environment: managed resources, sync history, conditions, last operation.
export const getEnvironmentDetails = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const projectDoc = await findProject(req.params.id);
    const mapping = projectDoc?.argoApps.find((a) => (a.environment || envKeyFor(a.appName, a.targetNamespace)) === req.params.env);
    if (!projectDoc || !mapping) {
      res.status(404).json({ message: 'Environment not found' });
      return;
    }
    const { data: app } = await argoRequest('get', `/api/v1/applications/${encodeURIComponent(mapping.appName)}`);
    const status = app.status || {};
    const op = status.operationState;
    res.json({
      appName: app.metadata.name,
      source: { repoURL: app.spec?.source?.repoURL, path: app.spec?.source?.path, targetRevision: app.spec?.source?.targetRevision },
      destination: app.spec?.destination,
      autoSync: Boolean(app.spec?.syncPolicy?.automated),
      sync: { status: status.sync?.status, revision: String(status.sync?.revision || '').slice(0, 8) },
      health: { status: status.health?.status, message: status.health?.message || '' },
      resources: (status.resources || []).map((r: any) => ({
        kind: r.kind,
        name: r.name,
        namespace: r.namespace || '',
        group: r.group || '',
        status: r.status || '',
        health: r.health?.status || '',
        healthMessage: r.health?.message || '',
      })),
      history: [...(status.history || [])]
        .reverse()
        .slice(0, 10)
        .map((h: any) => ({
          id: h.id,
          revision: String(h.revision || '').slice(0, 8),
          deployedAt: h.deployedAt,
          startedAt: h.deployStartedAt,
          initiatedBy: h.initiatedBy?.username || (h.initiatedBy?.automated ? 'auto-sync' : ''),
        })),
      conditions: (status.conditions || []).map((c: any) => ({ type: c.type, message: c.message, time: c.lastTransitionTime })),
      operation: op
        ? {
            phase: op.phase,
            message: op.message,
            startedAt: op.startedAt,
            finishedAt: op.finishedAt,
            initiatedBy: op.operation?.initiatedBy?.username || (op.operation?.initiatedBy?.automated ? 'auto-sync' : ''),
            results: (op.syncResult?.resources || []).map((r: any) => ({
              kind: r.kind,
              name: r.name,
              status: r.status,
              message: r.message,
            })),
          }
        : null,
    });
  } catch (err: any) {
    res.status(500).json({ message: describeRequestError(err, 'ArgoCD') });
  }
};
