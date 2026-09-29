import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { IProject, Project } from '../models/Project.js';
import { argoRequest } from './argoController.js';
import { ENV_ORDER } from './environmentController.js';
import { describeRequestError } from '../utils/httpError.js';
import { isValidId } from '../utils/validation.js';
import { IUser } from '../models/User.js';
import { envLevel, projectLevel } from '../services/access.js';

// One plain-language state per environment, derived from ArgoCD sync + health + operation.
export type EnvState = 'healthy' | 'deploying' | 'waiting' | 'failing' | 'missing' | 'unknown';

export interface EnvOverview {
  name: string;
  namespace: string;
  appName: string;
  branch: string;
  state: EnvState;
  message: string;
  sync: string;
  health: string;
  autoSync: boolean;
  image: string;
  tag: string;
  commit: string; // sha8 from the image tag, else the synced revision
  builtAt: string | null; // from <env>-<yyyymmddhhmm>-<sha8>-<pipeline>
  lastDeployAt: string | null;
  lastDeployBy: string;
  history: { at: string; revision: string; by: string }[];
}

const rank = (name: string) => {
  const i = ENV_ORDER.indexOf(name);
  return i === -1 ? ENV_ORDER.length : i;
};

// dev-202609281115-ea41a441-2889250766 -> { builtAt, sha }
const parseTag = (tag: string): { builtAt: string | null; sha: string } => {
  const m = /-(\d{12})-([0-9a-f]{7,40})(?:-\d+)?$/.exec(tag);
  if (!m) return { builtAt: null, sha: '' };
  const d = m[1];
  return { builtAt: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(8, 10)}:${d.slice(10, 12)}:00Z`, sha: m[2].slice(0, 8) };
};

const initiator = (i: any) => (i?.automated ? 'auto-sync' : i?.username || '');

const describe = (app: any): { state: EnvState; message: string } => {
  if (!app) return { state: 'missing', message: 'No ArgoCD application yet. Open the project and press Fix.' };
  const sync = app.status?.sync?.status || 'Unknown';
  const health = app.status?.health?.status || 'Unknown';
  const auto = Boolean(app.spec?.syncPolicy?.automated);
  const op = app.status?.operationState?.phase;
  const image = String(app.status?.summary?.images?.[0] || '');
  if (op === 'Running' || op === 'Terminating') return { state: 'deploying', message: 'ArgoCD is applying a change right now.' };
  if (op === 'Failed' || op === 'Error') return { state: 'failing', message: app.status?.operationState?.message?.slice(0, 160) || 'The last sync failed.' };
  if (image.endsWith(':not-built-yet')) return { state: 'waiting', message: 'Nothing built yet: push or promote to this branch.' };
  if (health === 'Degraded' || health === 'Missing') return { state: 'failing', message: app.status?.health?.message?.slice(0, 160) || `Resources are ${health.toLowerCase()}.` };
  if (sync === 'OutOfSync')
    return auto
      ? { state: 'deploying', message: 'Git changed; auto-sync will apply it within ~3 minutes.' }
      : { state: 'waiting', message: 'A new version is in Git. Press Sync to deploy it (manual approval).' };
  if (health === 'Progressing') return { state: 'deploying', message: 'Pods are rolling out.' };
  if (health === 'Healthy' && sync === 'Synced') return { state: 'healthy', message: 'Running the version in Git.' };
  if (health === 'Suspended') return { state: 'waiting', message: 'The application is suspended.' };
  return { state: 'unknown', message: `ArgoCD reports ${sync} / ${health}.` };
};

const envOverview = (a: IProject['argoApps'][number], app: any): EnvOverview => {
  const image = String(app?.status?.summary?.images?.[0] || '');
  const tag = image.includes(':') ? image.slice(image.lastIndexOf(':') + 1) : '';
  const parsed = parseTag(tag);
  const history: any[] = app?.status?.history || [];
  const last = history[history.length - 1];
  const { state, message } = describe(app);
  return {
    name: a.environment || a.branch || a.appName,
    namespace: a.targetNamespace,
    appName: a.appName,
    branch: a.branch || a.environment || '',
    state,
    message,
    sync: app?.status?.sync?.status || 'Unknown',
    health: app?.status?.health?.status || 'Unknown',
    autoSync: Boolean(app?.spec?.syncPolicy?.automated),
    image,
    tag,
    commit: parsed.sha || String(app?.status?.sync?.revision || '').slice(0, 8),
    builtAt: parsed.builtAt,
    lastDeployAt: last?.deployedAt || null,
    lastDeployBy: initiator(last?.initiatedBy),
    history: history
      .slice(-8)
      .reverse()
      .map((h) => ({ at: h.deployedAt, revision: String(h.revision || '').slice(0, 8), by: initiator(h.initiatedBy) })),
  };
};

const loadArgoApps = async (): Promise<{ apps: Map<string, any> | null; error: string }> => {
  try {
    const { data } = await argoRequest('get', '/api/v1/applications');
    return { apps: new Map((data.items || []).map((a: any) => [a.metadata.name, a])), error: '' };
  } catch (err) {
    return { apps: null, error: describeRequestError(err, 'ArgoCD') };
  }
};

const summarize = (p: IProject, apps: Map<string, any> | null, user?: IUser) => {
  const environments = [...(p.argoApps || [])]
    .filter((a) => envLevel(user, p.name, a.environment || a.branch || a.appName) >= 1)
    .sort((x, y) => rank(x.environment || x.branch || '') - rank(y.environment || y.branch || ''))
    .map((a) => envOverview(a, apps?.get(a.appName)));
  const hasApp = p.gitLabRepos.some((r) => r.role === 'app') || p.gitLabRepos.some((r) => r.role !== 'gitops');
  // Older projects have no repo roles; like the provisioner, fall back to the ArgoCD apps' source repo.
  const hasGitops =
    p.gitLabRepos.some((r) => r.role === 'gitops') || (p.argoApps || []).some((a) => Boolean(apps?.get(a.appName)?.spec?.source?.repoURL));
  const hasCluster = Boolean(p.kubernetesMappings?.[0]?.clusterName);
  const deployed = environments.some((e) => e.tag && e.tag !== 'not-built-yet');
  const lastDeploy = environments.map((e) => e.lastDeployAt).filter(Boolean).sort().pop() || null;
  return {
    _id: String(p._id),
    name: p.name,
    description: p.description,
    gitLabRepos: p.gitLabRepos,
    gitopsPath: p.gitopsPath || '',
    kubernetesMappings: p.kubernetesMappings,
    argoApps: p.argoApps,
    active: p.active,
    createdAt: (p as any).createdAt,
    updatedAt: (p as any).updatedAt,
    environments,
    // Setup milestones, in the order a new project goes through them.
    setup: [
      { key: 'repos', label: 'Repositories', done: hasApp && hasGitops },
      { key: 'cluster', label: 'Cluster', done: hasCluster },
      { key: 'environment', label: 'First environment', done: environments.length > 0 },
      { key: 'deploy', label: 'First deploy', done: deployed },
    ],
    attention: environments.filter((e) => e.state === 'failing' || e.state === 'missing' || e.state === 'waiting').length,
    lastDeployAt: lastDeploy,
  };
};

export const getProjectsOverview = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [projects, argo] = await Promise.all([Project.find().sort({ createdAt: -1 }), loadArgoApps()]);
    const visible = projects.filter((p) => projectLevel(req.user, p.name) >= 1);
    res.json({ argoError: argo.error || undefined, projects: visible.map((p) => summarize(p, argo.apps, req.user)) });
  } catch (err) {
    res.status(500).json({ message: describeRequestError(err, 'DevOps Intelligence') });
  }
};

export const getProjectOverview = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const project = isValidId(req.params.id) ? await Project.findById(req.params.id) : null;
    if (!project) {
      res.status(404).json({ message: 'Project not found' });
      return;
    }
    const argo = await loadArgoApps();
    res.json({ argoError: argo.error || undefined, project: summarize(project, argo.apps, req.user) });
  } catch (err) {
    res.status(500).json({ message: describeRequestError(err, 'DevOps Intelligence') });
  }
};
