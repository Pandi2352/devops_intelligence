import api from './client';
import { ConnectionTestResult } from '../types';

// ---------------------------------------------------------------- AI connectors (DevOps admins)

export interface AiConnector {
  _id: string;
  name: string;
  provider: 'openai' | 'openai-compatible';
  baseUrl: string;
  organization: string;
  project: string;
  defaultModel: string;
  /** Chat models the key can use (from the last Test). */
  models: string[];
  maxOutputTokens: number;
  hasKey: boolean;
  keyHint: string;
  isDefault: boolean;
  isActive: boolean;
  status: 'Connected' | 'Error' | 'Unknown';
  lastError: string;
  lastTestedAt?: string;
  usage: { promptTokens: number; completionTokens: number; requests: number };
  createdAt?: string;
  updatedAt?: string;
}

export interface AiConnectorInput {
  name: string;
  provider: 'openai' | 'openai-compatible';
  baseUrl?: string;
  apiKey?: string; // blank on edit = keep
  organization?: string;
  project?: string;
  defaultModel?: string;
  maxOutputTokens?: number;
  isDefault?: boolean;
  isActive?: boolean;
}

export const aiApi = {
  connectors: async (): Promise<AiConnector[]> => (await api.get('/ai/connectors')).data.connectors,
  create: async (data: AiConnectorInput): Promise<{ message: string; connector: AiConnector; test: ConnectionTestResult }> => (await api.post('/ai/connectors', data)).data,
  update: async (id: string, data: AiConnectorInput): Promise<{ message: string; connector: AiConnector; test: ConnectionTestResult }> => (await api.put(`/ai/connectors/${id}`, data)).data,
  setDefault: async (id: string): Promise<AiConnector> => (await api.put(`/ai/connectors/${id}/default`)).data.connector,
  remove: async (id: string): Promise<void> => {
    await api.delete(`/ai/connectors/${id}`);
  },
  /** Tests unsaved values; returns the chat models so the form can offer a model picker. */
  test: async (data: Partial<AiConnectorInput> & { id?: string }): Promise<ConnectionTestResult & { models: string[] }> => (await api.post('/ai/connectors/test', data)).data,
  testSaved: async (id: string): Promise<ConnectionTestResult & { connector: AiConnector }> => (await api.post(`/ai/connectors/${id}/test`)).data,
};

export const aiStatus = (c: AiConnector) => (c.isActive ? c.status : 'Disabled');

// ---------------------------------------------------------------- Project Starter (managers)

export type StarterStatus = 'chatting' | 'generating' | 'ready' | 'publishing' | 'published' | 'failed';
export type StepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface StarterMessage {
  role: 'user' | 'assistant';
  content: string; // Markdown for the assistant
  at: string;
  /** Versions the AI looked up from the registries for this answer. */
  versions?: { ecosystem: string; name: string; latest: string; found: boolean; notes?: string }[];
}

export interface StarterStep {
  key: 'interview' | 'plan' | 'files' | 'review' | 'create-repo' | 'upload' | 'commit';
  label: string;
  state: StepState;
  message: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface StarterPlan {
  name: string;
  summary: string;
  stack: { name: string; ecosystem: string; version: string; purpose: string }[];
  files: { path: string; purpose: string }[];
  setupInstructions: string;
}

export interface StarterRepo {
  connectorId: string;
  provider: 'github' | 'gitlab';
  owner: string;
  name: string;
  visibility: string;
  url: string;
  fullName: string;
  branch: string;
  commit: string;
}

export interface StarterRunSummary {
  _id: string;
  title: string;
  owner: string;
  ownerName: string;
  model: string;
  status: StarterStatus;
  fileCount: number;
  repo: StarterRepo | null;
  error: string;
  createdAt: string;
  updatedAt: string;
}

export interface StarterRun extends StarterRunSummary {
  connectorId: string;
  messages: StarterMessage[];
  plan: StarterPlan | null;
  files: { path: string; content: string; size: number }[];
  steps: StarterStep[];
  usage: { promptTokens: number; completionTokens: number; requests: number };
  limits: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number; batchSize: number };
}

export interface GitTarget {
  id: string;
  name: string;
  provider: 'github' | 'gitlab';
  username?: string;
  baseUrl?: string;
  isDefault?: boolean;
}

export interface RepoOwner {
  id: string; // GitHub login / GitLab namespace id
  name: string; // "@me", "acme", "group/subgroup"
  kind: 'user' | 'org' | 'group';
}

export interface PublishInput {
  gitConnectorId: string;
  owner: string; // RepoOwner.id
  ownerName: string; // RepoOwner.name without "@"
  name: string;
  description?: string;
  visibility: 'private' | 'public' | 'internal';
  branch?: string;
  message?: string;
}

export interface VersionLookup {
  ecosystem: string;
  name: string;
  found: boolean;
  latest: string;
  released?: string;
  deprecated?: string;
  notes?: string;
  source: string;
}

export const starterApi = {
  runs: async (all = false): Promise<StarterRunSummary[]> => (await api.get('/starter/runs', { params: all ? { all: 1 } : {} })).data.runs,
  run: async (id: string): Promise<StarterRun> => (await api.get(`/starter/runs/${id}`)).data.run,
  /** Creates a conversation; with `message` the AI answers right away (can take up to a minute). */
  create: async (data: { message?: string; connectorId?: string; model?: string }): Promise<StarterRun> => (await api.post('/starter/runs', data, { timeout: 200000 })).data.run,
  send: async (id: string, content: string): Promise<StarterRun> => (await api.post(`/starter/runs/${id}/messages`, { content }, { timeout: 200000 })).data.run,
  /** 202: runs in the background; poll run() and watch steps. */
  generate: async (id: string): Promise<{ message: string; run: StarterRun }> => (await api.post(`/starter/runs/${id}/generate`)).data,
  saveFile: async (id: string, path: string, content: string): Promise<StarterRun> => (await api.put(`/starter/runs/${id}/files`, { path, content })).data.run,
  deleteFile: async (id: string, path: string): Promise<StarterRun> => (await api.delete(`/starter/runs/${id}/files`, { params: { path } })).data.run,
  targets: async (): Promise<GitTarget[]> => (await api.get('/starter/targets')).data.connectors,
  owners: async (connectorId: string): Promise<RepoOwner[]> => (await api.get('/starter/owners', { params: { connectorId } })).data.owners,
  /** 202: runs in the background; 409 when the repository already exists. */
  publish: async (id: string, data: PublishInput): Promise<{ message: string; run: StarterRun }> => (await api.post(`/starter/runs/${id}/publish`, data)).data,
  remove: async (id: string): Promise<{ message: string }> => (await api.delete(`/starter/runs/${id}`)).data,
  version: async (ecosystem: string, name: string): Promise<VersionLookup> => (await api.get('/starter/versions', { params: { ecosystem, name } })).data,
};
