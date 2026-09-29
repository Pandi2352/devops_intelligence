import api from './client';

export interface DeployedImage {
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

export interface EnvironmentView {
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
  syncedRevision: { sha: string; title: string; author: string; date: string; webUrl: string } | null;
  live: DeployedImage | null;
  desired: DeployedImage | null;
  pods: { ready: number; desired: number } | null;
  branch?: string;
  branchHead?: { sha: string; title: string; author: string; date: string; webUrl: string } | null;
  branchPipeline?: { id: number; status: string; sha: string; webUrl: string } | null;
  lastChange?: { sha: string; title: string; author: string; date: string; webUrl: string; kind: 'deploy' | 'rollback' | 'other' } | null;
  /** Deploys into this environment wait for an approved request. */
  requiresApproval?: boolean;
  pendingApproval?: PendingApproval | null;
  /** Public hostname URL, or the running preview URL. */
  publicUrl?: string;
}

export interface PendingApproval {
  id: string;
  status: 'PENDING' | 'EXECUTING';
  summary: string;
  requestedBy: string;
  at: string;
}

// Answer of every deploy call. approvalRequired = nothing ran yet: a request went to the approvers (HTTP 202).
export interface DeployResult {
  message: string;
  approvalRequired?: boolean;
  request?: { _id: string; status: string; summary?: string };
}

export type PromotionState =
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

export interface PromotionView {
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

export interface ProjectEnvironments {
  project: { _id: string; name: string; appRepo?: string };
  flow: 'branch' | 'publish';
  environments: EnvironmentView[];
  promotions: PromotionView[];
  errors: string[];
}

export interface DeployHistoryEntry {
  sha: string;
  id: string;
  title: string;
  author: string;
  date: string;
  webUrl: string;
  kind: 'deploy' | 'rollback' | 'other';
  tag: string | null;
  appCommit: { sha: string; title: string } | null;
  isLive: boolean;
  isDesired: boolean;
}

export interface EnvironmentDetails {
  appName: string;
  source: { repoURL: string; path: string; targetRevision: string };
  destination: { server?: string; namespace?: string };
  autoSync: boolean;
  sync: { status: string; revision: string };
  health: { status: string; message: string };
  resources: { kind: string; name: string; namespace: string; group: string; status: string; health: string; healthMessage: string }[];
  history: { id: number; revision: string; deployedAt: string; startedAt?: string; initiatedBy: string }[];
  conditions: { type: string; message: string; time?: string }[];
  operation: {
    phase: string;
    message: string;
    startedAt: string;
    finishedAt?: string;
    initiatedBy: string;
    results: { kind: string; name: string; status: string; message: string }[];
  } | null;
}

export const environmentApi = {
  get: async (projectId: string): Promise<ProjectEnvironments> => {
    const res = await api.get(`/projects/${projectId}/environments`);
    return res.data;
  },
  promote: async (projectId: string, from: string, to: string, reason?: string): Promise<DeployResult> => {
    const res = await api.post(`/projects/${projectId}/environments/promote`, { from, to, reason: reason || undefined });
    return res.data;
  },
  history: async (projectId: string, env: string): Promise<DeployHistoryEntry[]> => {
    const res = await api.get(`/projects/${projectId}/environments/${env}/history`);
    return res.data.entries;
  },
  rollback: async (projectId: string, env: string, sha: string, reason?: string): Promise<DeployResult> => {
    const res = await api.post(`/projects/${projectId}/environments/${env}/rollback`, { sha, reason: reason || undefined });
    return res.data;
  },
  redeploy: async (projectId: string, env: string, reason?: string): Promise<DeployResult> => {
    const res = await api.post(`/projects/${projectId}/environments/${env}/redeploy`, { reason: reason || undefined });
    return res.data;
  },
  details: async (projectId: string, env: string): Promise<EnvironmentDetails> => {
    const res = await api.get(`/projects/${projectId}/environments/${env}/details`);
    return res.data;
  },
};
