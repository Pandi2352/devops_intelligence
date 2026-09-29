import api, { API_BASE_URL } from './client';

// ---------------------------------------------------------------- scopes

export interface ScopeEnvironment {
  name: string;
  namespace: string;
  appName: string;
}

export interface ScopeProject {
  id: string;
  name: string;
  cluster: string;
  environments: ScopeEnvironment[];
}

export interface Scopes {
  clusters: { name: string; isDefault: boolean; status: string }[];
  projects: ScopeProject[];
  sources: { prometheus: boolean; loki: boolean; grafana: boolean };
}

export interface NamespaceInfo {
  name: string;
  status: string;
  project?: string;
  environment?: string;
}

// ---------------------------------------------------------------- pods

export interface ContainerInfo {
  name: string;
  image: string;
  init: boolean;
  ready: boolean;
  started: boolean;
  state: 'running' | 'waiting' | 'terminated' | 'unknown';
  reason: string;
  message: string;
  startedAt?: string;
  restartCount: number;
  lastTermination?: { reason: string; exitCode: number; finishedAt?: string; message?: string };
  requests: { cpu?: string; memory?: string };
  limits: { cpu?: string; memory?: string };
  ports: string[];
  usage?: { cpuCores: number; memoryBytes: number };
}

export interface PodInfo {
  name: string;
  namespace: string;
  phase: string;
  status: string;
  problem: string;
  ready: string;
  readyCount: number;
  containerCount: number;
  restarts: number;
  lastRestartAt?: string;
  createdAt?: string;
  node: string;
  podIP: string;
  hostIP: string;
  qosClass: string;
  owner: { kind: string; name: string } | null;
  labels: Record<string, string>;
  containers: ContainerInfo[];
  conditions: { type: string; status: string; reason?: string; message?: string; lastTransitionTime?: string }[];
  usage?: { cpuCores: number; memoryBytes: number };
  projectId?: string;
  project?: string;
  environment?: string;
}

export interface EventInfo {
  type: string;
  reason: string;
  message: string;
  object: string;
  count: number;
  firstSeen?: string;
  lastSeen?: string;
  source: string;
}

// ---------------------------------------------------------------- logs

export interface LogLine {
  ts: string;
  pod: string;
  container: string;
  text: string;
}

export interface LogRequest {
  cluster?: string;
  namespace: string;
  pods?: string[]; // empty = every pod
  container?: string; // 'all' = every container
  tailLines?: number;
  sinceSeconds?: number;
  previous?: boolean;
}

export interface LogResult {
  targets: { pod: string; container: string }[];
  truncated: boolean;
  lines: LogLine[];
  errors: { target: string; message: string }[];
}

export type StreamEvent =
  | ({ type: 'line' } & LogLine)
  | { type: 'status'; status: string; target?: string; message?: string; targets?: { pod: string; container: string }[] }
  | { type: 'ping'; at: string };

// ---------------------------------------------------------------- metrics

export type MetricUnit = 'cores' | 'bytes' | 'Bps' | 'count' | 'percent' | 'rps' | 'seconds';

export interface MetricSeries {
  name: string;
  labels: Record<string, string>;
  points: [number, number][];
}

export interface MetricPanel {
  key: string;
  group: 'app' | 'resources';
  aggregate: 'sum' | 'max';
  title: string;
  unit: MetricUnit;
  query: string;
  error?: string;
  series: MetricSeries[];
  limit?: number;
}

export interface MetricsRange {
  source: string;
  namespace: string;
  pods: string[];
  range: string;
  panels: MetricPanel[];
  grafana: { namespace: string; pod?: string; explore: string } | null;
}

export interface UsageResult {
  available: boolean;
  message?: string;
  capacity?: { cpuCores: number; memoryBytes: number };
  pods?: { namespace: string; pod: string; cpuCores: number; memoryBytes: number }[];
}

// ---------------------------------------------------------------- connectors

export type ObservabilityKind = 'prometheus' | 'grafana' | 'loki';

export interface ObservabilityConnector {
  _id: string;
  name: string;
  kind: ObservabilityKind;
  access: 'service' | 'url';
  clusterName: string;
  namespace: string;
  service: string;
  port: number;
  scheme: 'http' | 'https';
  url: string;
  publicUrl: string;
  authType: 'none' | 'basic' | 'bearer';
  username: string;
  hasPassword: boolean;
  hasToken: boolean;
  tokenHint: string;
  insecure: boolean;
  isDefault: boolean;
  isActive: boolean;
  status: 'Connected' | 'Error' | 'Unknown';
  lastError: string;
  lastTestedAt?: string;
  version: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ObservabilityConnectorInput {
  id?: string;
  name?: string;
  kind?: ObservabilityKind;
  access?: 'service' | 'url';
  clusterName?: string;
  namespace?: string;
  service?: string;
  port?: number;
  scheme?: 'http' | 'https';
  url?: string;
  publicUrl?: string;
  authType?: 'none' | 'basic' | 'bearer';
  username?: string;
  password?: string;
  token?: string;
  insecure?: boolean;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface DiscoveredService {
  kind: ObservabilityKind;
  clusterName: string;
  namespace: string;
  service: string;
  port: number;
  suggestedName: string;
  alreadyAdded: boolean;
}

export interface ConnectorTest {
  ok: boolean;
  message: string;
}

// ---------------------------------------------------------------- resource browser

export interface ResourceRow {
  name: string;
  namespace: string;
  createdAt?: string;
  labels: Record<string, string>;
  selector?: Record<string, string>;
  status: string;
  tone: 'ok' | 'warn' | 'bad' | 'muted';
  cols: Record<string, string | number>;
  project?: string;
  projectId?: string;
  environment?: string;
}

export interface ResourceList {
  kind: string;
  namespaced: boolean;
  columns: { key: string; label: string }[];
  rows: ResourceRow[];
  message?: string;
}

export interface ResourceDetail {
  kind: string;
  name: string;
  namespace: string;
  yaml: string;
  events: EventInfo[];
  pods: PodInfo[];
  row: { status: string; tone: ResourceRow['tone']; cols: Record<string, string | number> };
}

const O = '/observability';

const logParams = (r: LogRequest) => ({
  cluster: r.cluster || undefined,
  namespace: r.namespace,
  pods: r.pods?.length ? r.pods.join(',') : 'all',
  container: r.container || 'all',
  tailLines: r.sinceSeconds ? undefined : r.tailLines,
  sinceSeconds: r.sinceSeconds || undefined,
  previous: r.previous || undefined,
});

export const observabilityApi = {
  scopes: async (): Promise<Scopes> => (await api.get(`${O}/scopes`)).data,
  namespaces: async (cluster?: string): Promise<{ cluster: string; namespaces: NamespaceInfo[] }> =>
    (await api.get(`${O}/namespaces`, { params: { cluster } })).data,
  pods: async (namespace: string, cluster?: string): Promise<{ cluster: string; metricsAvailable: boolean; pods: PodInfo[] }> =>
    (await api.get(`${O}/pods`, { params: { namespace, cluster } })).data,
  pod: async (namespace: string, pod: string, cluster?: string): Promise<{ pod: PodInfo; events: EventInfo[]; manifestYaml: string }> =>
    (await api.get(`${O}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(pod)}`, { params: { cluster } })).data,
  events: async (namespace: string, cluster?: string, name?: string): Promise<{ events: EventInfo[] }> =>
    (await api.get(`${O}/events`, { params: { namespace, cluster, name } })).data,

  logs: async (r: LogRequest): Promise<LogResult> => (await api.get(`${O}/logs`, { params: logParams(r), timeout: 60000 })).data,
  logHistory: async (r: LogRequest & { search?: string; limit?: number }): Promise<{ source: string; query: string; lines: LogLine[] }> =>
    (await api.get(`${O}/logs/history`, { params: { ...logParams(r), search: r.search || undefined, limit: r.limit, sinceSeconds: r.sinceSeconds || 3600 }, timeout: 60000 })).data,

  // Live tail over a streamed fetch (NDJSON), so the Authorization header can be sent.
  streamLogs: (r: LogRequest, onEvent: (e: StreamEvent) => void, onClose: (error?: string) => void): (() => void) => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    Object.entries({ ...logParams(r), tailLines: undefined, sinceSeconds: undefined }).forEach(([k, v]) => v !== undefined && params.set(k, String(v)));
    const token = localStorage.getItem('kubeorbit_token');
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}${O}/logs/stream?${params}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}));
          onClose(body.message || `Live tail failed (HTTP ${res.status})`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n');
          buffer = parts.pop() || '';
          for (const p of parts) {
            if (!p.trim()) continue;
            try {
              onEvent(JSON.parse(p));
            } catch {
              /* partial line */
            }
          }
        }
        onClose();
      } catch (err) {
        if ((err as Error).name !== 'AbortError') onClose((err as Error).message || 'Live tail disconnected');
      }
    })();
    return () => controller.abort();
  },

  usage: async (namespace: string, cluster?: string): Promise<UsageResult> => (await api.get(`${O}/metrics/usage`, { params: { namespace, cluster } })).data,
  metrics: async (namespace: string, pods: string[], range: string): Promise<MetricsRange> =>
    (await api.get(`${O}/metrics/range`, { params: { namespace, pods: pods.join(',') || undefined, range }, timeout: 60000 })).data,
  query: async (query: string, range: string): Promise<{ series: MetricSeries[] }> =>
    (await api.get(`${O}/metrics/query`, { params: { query, range }, timeout: 60000 })).data,

  resources: async (kind: string, namespace: string, cluster?: string): Promise<ResourceList> =>
    (await api.get(`${O}/resources`, { params: { kind, namespace, cluster } })).data,
  resource: async (kind: string, namespace: string, name: string, cluster?: string): Promise<ResourceDetail> =>
    (await api.get(`${O}/resources/${kind}/${encodeURIComponent(namespace || '_')}/${encodeURIComponent(name)}`, { params: { cluster } })).data,

  connectors: async (): Promise<ObservabilityConnector[]> => (await api.get(`${O}/connectors`)).data.connectors,
  discover: async (cluster?: string): Promise<{ cluster: string; services: DiscoveredService[] }> =>
    (await api.get(`${O}/connectors/discover`, { params: { cluster } })).data,
  testConnection: async (input: ObservabilityConnectorInput): Promise<ConnectorTest> => (await api.post(`${O}/connectors/test`, input)).data,
  testSaved: async (id: string): Promise<ConnectorTest & { connector: ObservabilityConnector }> => (await api.post(`${O}/connectors/${id}/test`)).data,
  create: async (input: ObservabilityConnectorInput): Promise<{ message: string; connector: ObservabilityConnector }> => (await api.post(`${O}/connectors`, input)).data,
  update: async (id: string, input: ObservabilityConnectorInput): Promise<{ message: string; connector: ObservabilityConnector }> =>
    (await api.put(`${O}/connectors/${id}`, input)).data,
  remove: async (id: string): Promise<{ message: string }> => (await api.delete(`${O}/connectors/${id}`)).data,
};
