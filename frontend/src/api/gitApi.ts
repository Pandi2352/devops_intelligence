import api from './client';
import { ConnectionTestResult, GitIntegration, GitRepo, PipelineRun } from '../types';

export interface GitConnectorInput {
  name: string;
  provider: 'github' | 'gitlab';
  baseUrl?: string;
  token?: string;
  isActive?: boolean;
  isDefault?: boolean;
}

export interface WorkspaceTemplate {
  name: string;
  description: string;
  fileCount: number;
  totalBytes: number;
  hasPipeline: boolean;
}

export interface TemplatePushResult {
  commit: { id: string; shortId: string; title: string; webUrl: string } | null;
  created: string[];
  updated: string[];
  skipped: string[];
  unchanged: number;
}

export interface JobTraceLine {
  time?: string;
  stream: 'out' | 'err';
  text: string;
}

export interface JobTrace {
  job: {
    id: number;
    name: string;
    stage: string;
    status: string;
    duration: string;
    startedAt?: string;
    finishedAt?: string;
    webUrl: string;
    failureReason?: string;
    runner: string;
  };
  lines: JobTraceLine[];
  truncated: boolean;
  complete: boolean;
}

export interface JobArtifacts {
  files: { path: string; size: number; content?: string; truncated?: boolean }[];
  expireAt?: string | null;
  expired?: boolean;
  tooLarge?: boolean;
  downloadUrl?: string;
}

export interface CreateRepoInput {
  name: string;
  path?: string;
  description?: string;
  visibility: 'private' | 'internal' | 'public';
  template?: string;
  commitMessage?: string;
}

export interface GitopsLayout {
  ref?: string;
  empty: boolean;
  overlayBases: { path: string; environments: string[] }[];
  kustomizations: string[];
}

export interface GitBranch {
  name: string;
  default: boolean;
  protected: boolean;
  commit?: { id: string; shortId: string; title: string };
}

// ---------------------------------------------------------------- merge requests

export interface PipelineRef {
  id: number;
  status: string;
  ref: string;
  sha: string;
  webUrl: string;
  createdAt: string;
  source: string;
}

export interface MergeRequestInfo {
  iid: number;
  title: string;
  source: string;
  target: string;
  author: string;
  createdAt: string;
  webUrl: string;
  state: string;
  status: string;
  hasConflicts: boolean;
  draft: boolean;
  pipeline: PipelineRef | null;
  mergeCommitSha: string;
}

export interface BranchComparison {
  source: string;
  target: string;
  ahead: number;
  behind: number;
  fastForward: boolean;
  filesChanged: number;
  commits: { sha: string; shortId: string; title: string; author: string; date: string; webUrl: string }[];
  files: { path: string; status: string }[];
  compareUrl: string;
  openMergeRequest: MergeRequestInfo | null;
  targetProtected: boolean;
  targetPipeline: PipelineRef | null;
  deploysTo: { project: string; projectId: string; environment: string; namespace: string } | null;
}

export interface MergeResult {
  merged: boolean;
  scheduled?: boolean;
  message: string;
  mergeRequest: MergeRequestInfo;
  targetPipeline?: PipelineRef | null;
  targetPipelineStarted?: boolean;
}

export const gitApi = {
  getTemplates: async (): Promise<WorkspaceTemplate[]> => {
    const res = await api.get('/git/templates');
    return res.data.templates;
  },
  createRepo: async (
    integrationId: string,
    data: CreateRepoInput
  ): Promise<{ message: string; repo: GitRepo; push: TemplatePushResult | null; pushError?: string }> => {
    const res = await api.post(`/git/${integrationId}/projects`, data);
    return res.data;
  },
  pushTemplate: async (
    integrationId: string,
    repoId: string | number,
    data: { template: string; branch: string; commitMessage?: string; onConflict?: 'abort' | 'overwrite' | 'skip' }
  ): Promise<{ message: string; push: TemplatePushResult }> => {
    const res = await api.post(`/git/${integrationId}/repos/${repoId}/push-template`, data);
    return res.data;
  },
  getAll: async (): Promise<GitIntegration[]> => {
    const res = await api.get('/git');
    return res.data.integrations;
  },
  create: async (data: GitConnectorInput): Promise<GitIntegration> => {
    const res = await api.post('/git', data);
    return res.data.connector;
  },
  update: async (id: string, data: Partial<GitConnectorInput>): Promise<GitIntegration> => {
    const res = await api.put(`/git/${id}`, data);
    return res.data.connector;
  },
  remove: async (id: string): Promise<void> => {
    await api.delete(`/git/${id}`);
  },
  // Tests unsaved form values; `id` lets the server reuse the stored token when the field is blank.
  testConnection: async (data: Partial<GitConnectorInput> & { id?: string }): Promise<ConnectionTestResult> => {
    const res = await api.post('/git/test', data);
    return res.data;
  },
  testSaved: async (id: string): Promise<ConnectionTestResult & { connector: GitIntegration }> => {
    const res = await api.post(`/git/${id}/test`);
    return res.data;
  },
  getRepos: async (id: string): Promise<GitRepo[]> => {
    const res = await api.get(`/git/${id}/repos`);
    return res.data.repos;
  },
  getPipelines: async (integrationId: string, repoId: string | number): Promise<PipelineRun[]> => {
    const res = await api.get(`/git/${integrationId}/repos/${repoId}/pipelines`);
    return res.data.pipelines;
  },
  triggerPipeline: async (
    integrationId: string,
    repoId: string | number,
    ref: string = 'main'
  ): Promise<{ message: string; pipeline: PipelineRun }> => {
    const res = await api.post(`/git/${integrationId}/repos/${repoId}/pipelines`, { ref });
    return res.data;
  },
  getJobTrace: async (integrationId: string, repoId: string | number, jobId: string | number): Promise<JobTrace> => {
    const res = await api.get(`/git/${integrationId}/repos/${repoId}/jobs/${jobId}/trace`);
    return res.data;
  },
  getJobArtifacts: async (integrationId: string, repoId: string | number, jobId: string | number): Promise<JobArtifacts> => {
    const res = await api.get(`/git/${integrationId}/repos/${repoId}/jobs/${jobId}/artifacts`);
    return res.data;
  },
  getCommits: async (integrationId: string, repoId: string | number): Promise<any[]> => {
    const res = await api.get(`/git/${integrationId}/repos/${repoId}/commits`);
    return res.data.commits;
  },
  getBranches: async (integrationId: string, repoId: string | number): Promise<any[]> => {
    const res = await api.get(`/git/${integrationId}/repos/${repoId}/branches`);
    return res.data.branches;
  },
  // Where a GitOps repo keeps its per-environment Kustomize overlays (e.g. k8s/overlays → dev, qa, prod).
  getGitopsLayout: async (integrationId: string, repoId: string | number): Promise<GitopsLayout> =>
    (await api.get(`/git/${integrationId}/repos/${repoId}/gitops-layout`)).data,
  compareBranches: async (integrationId: string, repoId: string | number, source: string, target: string): Promise<BranchComparison> =>
    (await api.get(`/git/${integrationId}/repos/${repoId}/compare`, { params: { source, target } })).data,
  branchPipeline: async (integrationId: string, repoId: string | number, ref: string): Promise<PipelineRef | null> =>
    (await api.get(`/git/${integrationId}/repos/${repoId}/branch-pipeline`, { params: { ref } })).data.pipeline,
  listMergeRequests: async (integrationId: string, repoId: string | number, state = 'opened'): Promise<MergeRequestInfo[]> =>
    (await api.get(`/git/${integrationId}/repos/${repoId}/merge-requests`, { params: { state } })).data.mergeRequests,
  createMergeRequest: async (
    integrationId: string,
    repoId: string | number,
    input: { source: string; target: string; title?: string; description?: string; squash?: boolean; removeSourceBranch?: boolean }
  ): Promise<{ existed: boolean; message: string; mergeRequest: MergeRequestInfo }> =>
    (await api.post(`/git/${integrationId}/repos/${repoId}/merge-requests`, input)).data,
  mergeMergeRequest: async (
    integrationId: string,
    repoId: string | number,
    iid: number,
    options: { squash?: boolean; removeSourceBranch?: boolean; whenPipelineSucceeds?: boolean }
  ): Promise<MergeResult> => (await api.post(`/git/${integrationId}/repos/${repoId}/merge-requests/${iid}/merge`, options, { timeout: 60000 })).data,
  rebaseMergeRequest: async (integrationId: string, repoId: string | number, iid: number): Promise<{ message: string }> =>
    (await api.post(`/git/${integrationId}/repos/${repoId}/merge-requests/${iid}/rebase`)).data,
  closeMergeRequest: async (integrationId: string, repoId: string | number, iid: number): Promise<{ message: string }> =>
    (await api.post(`/git/${integrationId}/repos/${repoId}/merge-requests/${iid}/close`)).data,
  getLanguages: async (integrationId: string, repoId: string | number): Promise<Record<string, number>> => {
    const res = await api.get(`/git/${integrationId}/repos/${repoId}/languages`);
    return res.data.languages;
  },
};
