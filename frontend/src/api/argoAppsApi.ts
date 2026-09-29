import api from './client';

export interface ArgoAppSummary {
  name: string;
  namespace: string;
  project: string;
  createdAt: string;
  source: { repoURL: string; path: string; targetRevision: string; chart: string };
  sourceType: string;
  destination: { server: string; name: string; namespace: string };
  sync: { status: string; revision: string };
  health: { status: string; message: string };
  autoSync: { enabled: boolean; prune: boolean; selfHeal: boolean };
  syncOptions: string[];
  images: string[];
  reconciledAt: string | null;
  lastSync: { at: string; by: string; revision: string } | null;
  operation: { phase: string; message: string; startedAt: string; finishedAt: string | null; by: string } | null;
  conditions: { type: string; message: string; time?: string }[];
  resourceCounts: { total: number; outOfSync: number; unhealthy: number };
  kubeorbit: { project: string; projectId: string; environment: string } | null;
}

export interface ArgoAppDetail extends ArgoAppSummary {
  argoUrl: string;
  resources: {
    group: string;
    version: string;
    kind: string;
    namespace: string;
    name: string;
    status: string;
    health: string;
    healthMessage: string;
    hook: boolean;
    requiresPruning: boolean;
  }[];
  history: {
    id: number;
    revision: string;
    fullRevision: string;
    deployedAt: string;
    startedAt?: string;
    by: string;
    source: { path: string; targetRevision: string };
  }[];
  operationDetail: {
    phase: string;
    message: string;
    startedAt: string;
    finishedAt: string | null;
    by: string;
    revision: string;
    prune: boolean;
    results: { kind: string; name: string; namespace: string; status: string; message: string; syncPhase: string }[];
  } | null;
}

export interface ArgoTreeNode {
  uid: string;
  kind: string;
  name: string;
  namespace: string;
  group: string;
  parents: string[];
  health: string;
  healthMessage: string;
  info: { name: string; value: string }[];
  images: string[];
  createdAt: string | null;
}

export interface ArgoDiffItem {
  group: string;
  kind: string;
  namespace: string;
  name: string;
  state: 'in-sync' | 'modified' | 'missing' | 'extra';
  diff: { type: ' ' | '+' | '-' | '…'; text: string }[];
}

export interface ArgoEvent {
  type: string;
  reason: string;
  message: string;
  object: string;
  count: number;
  time: string;
  source: string;
}

export interface ArgoSyncOptions {
  prune: boolean;
  force: boolean;
  applyOutOfSyncOnly: boolean;
}

const enc = encodeURIComponent;

export const argoAppsApi = {
  list: async (): Promise<{ serverUrl: string; apps: ArgoAppSummary[] }> => (await api.get('/argocd/apps')).data,
  get: async (name: string): Promise<ArgoAppDetail> => (await api.get(`/argocd/apps/${enc(name)}`)).data,
  tree: async (name: string): Promise<ArgoTreeNode[]> => (await api.get(`/argocd/apps/${enc(name)}/tree`)).data.nodes,
  diff: async (name: string): Promise<ArgoDiffItem[]> => (await api.get(`/argocd/apps/${enc(name)}/diff`)).data.items,
  events: async (name: string): Promise<ArgoEvent[]> => (await api.get(`/argocd/apps/${enc(name)}/events`)).data.events,
  refresh: async (name: string, hard: boolean): Promise<{ message: string }> => (await api.post(`/argocd/apps/${enc(name)}/refresh`, { hard })).data,
  sync: async (name: string, options: ArgoSyncOptions): Promise<{ message: string }> => (await api.post(`/argocd/apps/${enc(name)}/sync`, options)).data,
  rollback: async (name: string, id: number): Promise<{ message: string }> => (await api.post(`/argocd/apps/${enc(name)}/rollback`, { id })).data,
  terminate: async (name: string): Promise<{ message: string }> => (await api.delete(`/argocd/apps/${enc(name)}/operation`)).data,
};
