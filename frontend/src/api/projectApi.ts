import api from './client';

export interface ProjectRepo {
  name: string;
  repoUrl: string;
  branch: string;
  provider: string;
  role?: 'app' | 'gitops' | '';
}

export interface ProjectArgoApp {
  appName: string;
  targetNamespace: string;
  environment?: string;
  branch?: string;
  serverUrl?: string;
}

export interface Project {
  _id: string;
  name: string;
  description?: string;
  gitLabRepos: ProjectRepo[];
  gitopsPath?: string;
  kubernetesMappings: { clusterName: string; namespaces: string[] }[];
  argoApps: ProjectArgoApp[];
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectInput {
  name?: string;
  gitopsPath?: string;
  description?: string;
  appRepoUrl?: string;
  appDefaultBranch?: string;
  gitopsRepoUrl?: string;
  clusterName?: string;
  active?: boolean;
}

export interface SetupCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export type StepStatus = 'exists' | 'created' | 'updated' | 'failed' | 'skipped';

export interface SetupStep {
  key: string;
  label: string;
  status: StepStatus;
  detail: string;
}

export interface EnvironmentSetup {
  name: string;
  namespace: string;
  appName: string;
  overlayPath: string;
  autoSync: boolean;
  checks: SetupCheck[];
}

export interface ProjectSetup {
  ready: boolean;
  message?: string;
  appRepo?: { url: string; path: string; defaultBranch: string };
  gitopsRepo?: { url: string; path: string };
  cluster?: string;
  overlayBase?: string;
  environments: EnvironmentSetup[];
}

export interface AddEnvironmentInput {
  name: string;
  namespace?: string;
  appName?: string;
  autoSync?: boolean;
  sourceBranch?: string;
}

export interface ProvisionResult {
  message: string;
  steps: SetupStep[];
  checks?: SetupCheck[];
}

const base = (id: string) => `/projects/${encodeURIComponent(id)}`;
const envPath = (id: string, env: string) => `${base(id)}/environments/${encodeURIComponent(env)}`;

export const appRepoOf = (p: Project) => p.gitLabRepos.find((r) => r.role === 'app') || p.gitLabRepos.find((r) => r.role !== 'gitops');
export const gitopsRepoOf = (p: Project) => p.gitLabRepos.find((r) => r.role === 'gitops');
export const clusterOf = (p: Project) => p.kubernetesMappings[0]?.clusterName || '';
export const environmentsOf = (p: Project) => p.argoApps.map((a) => a.environment || a.branch || a.appName);

export const projectApi = {
  list: async (): Promise<Project[]> => (await api.get('/projects')).data.projects || [],
  get: async (id: string): Promise<Project> => (await api.get(base(id))).data.project,
  create: async (input: ProjectInput): Promise<{ message: string; project: Project }> => (await api.post('/projects', input)).data,
  update: async (id: string, input: ProjectInput): Promise<{ message: string; project: Project }> => (await api.put(base(id), input)).data,
  remove: async (id: string): Promise<{ message: string }> => (await api.delete(base(id))).data,

  setup: async (id: string): Promise<ProjectSetup> => (await api.get(`${base(id)}/setup`)).data,
  checks: async (id: string, env: string): Promise<{ checks: SetupCheck[] }> => (await api.get(`${envPath(id, env)}/checks`)).data,
  addEnvironment: async (id: string, input: AddEnvironmentInput): Promise<ProvisionResult> =>
    (await api.post(`${base(id)}/environments/add`, input, { timeout: 120000 })).data,
  provision: async (id: string, env: string): Promise<ProvisionResult> =>
    (await api.post(`${envPath(id, env)}/provision`, {}, { timeout: 120000 })).data,
  removeEnvironment: async (id: string, env: string, deleteNamespace: boolean): Promise<ProvisionResult> =>
    (await api.delete(envPath(id, env), { params: { deleteNamespace }, timeout: 120000 })).data,
  manifests: async (id: string, env: string): Promise<EnvironmentManifests> => (await api.get(`${envPath(id, env)}/manifests`, { timeout: 60000 })).data,
  // null resets to the default (production gated, everything else not).
  setEnvironmentApproval: async (
    id: string,
    env: string,
    requiresApproval: boolean | null
  ): Promise<{ message: string; requiresApproval: boolean; isDefault: boolean; defaultValue: boolean }> =>
    (await api.put(`${envPath(id, env)}/approval`, { requiresApproval })).data,
};

export interface GitopsFile {
  path: string;
  layer: 'overlay' | 'base';
  content: string;
  webUrl: string;
}

export type ManifestState = 'in-sync' | 'modified' | 'missing' | 'extra';

export interface ManifestResource {
  kind: string;
  group: string;
  name: string;
  namespace: string;
  state: ManifestState;
  desiredYaml: string;
  liveYaml: string;
}

export interface EnvironmentManifests {
  environment: string;
  appName: string;
  namespace: string;
  gitopsRepo: string;
  overlayPath: string;
  files: GitopsFile[];
  filesError?: string;
  resources: ManifestResource[];
  resourcesError?: string;
}

// ---------------------------------------------------------------- overview (projects list + project page)

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
  commit: string;
  builtAt: string | null;
  lastDeployAt: string | null;
  lastDeployBy: string;
  history: { at: string; revision: string; by: string }[];
  requiresApproval?: boolean;
  approvalIsDefault?: boolean;
}

export interface ProjectOverview extends Project {
  environments: EnvOverview[];
  setup: { key: 'repos' | 'cluster' | 'environment' | 'deploy'; label: string; done: boolean }[];
  attention: number;
  lastDeployAt: string | null;
}

export const projectOverviewApi = {
  list: async (): Promise<{ argoError?: string; projects: ProjectOverview[] }> => (await api.get('/projects/overview')).data,
  get: async (id: string): Promise<{ argoError?: string; project: ProjectOverview }> => (await api.get(`/projects/${encodeURIComponent(id)}/overview`)).data,
};
