import { Response } from 'express';
import { dumpYaml } from '@kubernetes/client-node';
import { buildScope, envLevel, envNameOf, isManager, projectLevel } from '../services/access.js';
import { AuthRequest } from '../middleware/auth.js';
import { Cluster } from '../models/Cluster.js';
import { Project } from '../models/Project.js';
import { IObservabilityIntegration, ObservabilityIntegration, ObservabilityKind } from '../models/ObservabilityIntegration.js';
import { resolveClients } from './clusterController.js';
import { describeRequestError } from '../utils/httpError.js';
import { maskSecret } from '../utils/secrets.js';
import { cleanString, isHttpUrl, isValidId, normalizeUrl } from '../utils/validation.js';
import {
  LogTarget,
  fetchLogs,
  followLogs,
  listEvents,
  namespaceOwners,
  podUsage,
  summarizePod,
} from '../services/podInsights.js';
import { KINDS as RESOURCE_KINDS, listKind, readObject, redact } from '../services/resourceCatalog.js';
import { ConnectionFields, defaultConnector, discoverObservability, observabilityGet, probeObservability } from '../services/observabilityClient.js';

const DNS = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;
const MAX_LOG_TARGETS = 20;

const fail = (res: Response, err: any, service = 'Kubernetes API server', status = 502) => {
  res.status(err?.status || status).json({ message: err?.status ? err.message : describeRequestError(err, service) });
};

const pickCluster = async (name?: unknown): Promise<string> => {
  if (name && typeof name === 'string') return name;
  const c = (await Cluster.findOne({ isDefault: true })) || (await Cluster.findOne().sort({ createdAt: 1 }));
  if (!c) throw Object.assign(new Error('No cluster connector is configured'), { status: 400 });
  return c.name;
};

const requireNamespace = (value: unknown): string => {
  const ns = String(value || '');
  if (ns !== 'all' && !DNS.test(ns)) throw Object.assign(new Error('A valid namespace is required'), { status: 400 });
  return ns;
};

// ---------------------------------------------------------------- scopes

// Everything the pickers need: clusters, and every project environment with its namespace.
export const getScopes = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [clusters, projects, connectors] = await Promise.all([
      Cluster.find({}, { name: 1, isDefault: 1, status: 1 }).sort({ isDefault: -1, name: 1 }),
      Project.find({}, { name: 1, argoApps: 1, kubernetesMappings: 1 }).sort({ name: 1 }).then((all) => all.filter((p) => projectLevel(_req.user, p.name) >= 1)),
      ObservabilityIntegration.find({ isActive: true }, { kind: 1, name: 1, publicUrl: 1, status: 1 }),
    ]);
    const usedClusters = new Set(projects.map((p) => p.kubernetesMappings?.[0]?.clusterName).filter(Boolean));
    res.json({
      clusters: clusters.filter((c) => isManager(_req.user) || usedClusters.has(c.name)).map((c) => ({ name: c.name, isDefault: c.isDefault, status: c.status })),
      projects: projects.map((p) => ({
        id: String(p._id),
        name: p.name,
        cluster: p.kubernetesMappings?.[0]?.clusterName || '',
        environments: (p.argoApps || [])
          .filter((a) => a.targetNamespace && envLevel(_req.user, p.name, envNameOf(a)) >= 1)
          .map((a) => ({ name: a.environment || a.branch || a.appName, namespace: a.targetNamespace, appName: a.appName })),
      })),
      sources: {
        prometheus: connectors.some((c) => c.kind === 'prometheus'),
        loki: connectors.some((c) => c.kind === 'loki'),
        grafana: connectors.some((c) => c.kind === 'grafana' && c.publicUrl),
      },
    });
  } catch (err) {
    fail(res, err, 'DevOps Intelligence', 500);
  }
};

export const getNamespaces = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cluster = await pickCluster(req.query.cluster);
    const { core } = await resolveClients(cluster);
    const [list, owners] = await Promise.all([core.listNamespace(), namespaceOwners()]);
    const scope = await buildScope(req.user);
    res.json({
      cluster,
      namespaces: list.items.filter((n) => !scope || scope.namespaces.has(n.metadata?.name || '')).map((n) => {
        const name = n.metadata?.name || '';
        const owner = owners.get(name);
        return { name, status: n.status?.phase || '', project: owner?.project, environment: owner?.environment };
      }),
    });
  } catch (err) {
    fail(res, err);
  }
};

// ---------------------------------------------------------------- pods

export const getPods = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cluster = await pickCluster(req.query.cluster);
    const namespace = requireNamespace(req.query.namespace || 'all');
    const { core, kc } = await resolveClients(cluster);
    const [list, usage, owners] = await Promise.all([
      namespace === 'all' ? core.listPodForAllNamespaces() : core.listNamespacedPod({ namespace }),
      podUsage(kc, namespace === 'all' ? undefined : namespace),
      namespaceOwners(),
    ]);
    const scope = await buildScope(req.user);
    const pods = list.items.filter((p) => !scope || scope.namespaces.has(p.metadata?.namespace || '')).map((p) => {
      const s = summarizePod(p);
      const u = usage?.get(`${s.namespace}/${s.name}`);
      if (u) {
        s.usage = { cpuCores: u.cpuCores, memoryBytes: u.memoryBytes };
        s.containers.forEach((c) => (c.usage = u.containers[c.name]));
      }
      const owner = owners.get(s.namespace);
      if (owner) Object.assign(s, { projectId: owner.projectId, project: owner.project, environment: owner.environment });
      return s;
    });
    res.json({ cluster, namespace, metricsAvailable: Boolean(usage), pods });
  } catch (err) {
    fail(res, err);
  }
};

export const getPodDetail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cluster = await pickCluster(req.query.cluster);
    const namespace = requireNamespace(req.params.namespace);
    const name = String(req.params.pod);
    const { core, kc } = await resolveClients(cluster);
    const [pod, events, usage, owners] = await Promise.all([
      core.readNamespacedPod({ name, namespace }),
      listEvents(core, namespace, name).catch(() => []),
      podUsage(kc, namespace),
      namespaceOwners(),
    ]);
    const summary = summarizePod(pod);
    const u = usage?.get(`${namespace}/${name}`);
    if (u) {
      summary.usage = { cpuCores: u.cpuCores, memoryBytes: u.memoryBytes };
      summary.containers.forEach((c) => (c.usage = u.containers[c.name]));
    }
    const owner = owners.get(namespace);
    if (owner) Object.assign(summary, { projectId: owner.projectId, project: owner.project, environment: owner.environment });
    if (pod.metadata?.managedFields) delete pod.metadata.managedFields;
    res.json({ cluster, pod: summary, events, manifestYaml: dumpYaml(pod) });
  } catch (err) {
    fail(res, err);
  }
};

export const getEvents = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cluster = await pickCluster(req.query.cluster);
    const namespace = requireNamespace(req.query.namespace || 'all');
    if (namespace === 'all' && !isManager(req.user)) throw Object.assign(new Error('Pick a namespace'), { status: 400 });
    const { core } = await resolveClients(cluster);
    const name = req.query.name ? String(req.query.name) : undefined;
    res.json({ cluster, namespace, events: await listEvents(core, namespace, name) });
  } catch (err) {
    fail(res, err);
  }
};

// ---------------------------------------------------------------- logs

// pods=a,b (or "all") + container=name (or "all") -> concrete pod/container pairs.
const resolveTargets = async (req: AuthRequest) => {
  const cluster = await pickCluster(req.query.cluster);
  const namespace = requireNamespace(req.query.namespace);
  if (namespace === 'all') throw Object.assign(new Error('Pick a namespace to read logs'), { status: 400 });
  const clients = await resolveClients(cluster);
  const wanted = String(req.query.pods || 'all').split(',').map((s) => s.trim()).filter(Boolean);
  const container = String(req.query.container || 'all');

  const list = await clients.core.listNamespacedPod({ namespace });
  const pods = list.items.filter((p) => wanted.includes('all') || wanted.includes(p.metadata?.name || ''));
  if (!pods.length) throw Object.assign(new Error('No matching pods in this namespace'), { status: 404 });

  const targets: LogTarget[] = [];
  for (const p of pods) {
    const names = [
      ...(p.spec?.containers || []).map((c) => c.name),
      ...(req.query.init === 'true' ? (p.spec?.initContainers || []).map((c) => c.name) : []),
    ];
    for (const c of names) if (container === 'all' || c === container) targets.push({ pod: p.metadata?.name || '', container: c });
  }
  if (!targets.length) throw Object.assign(new Error(`No container named ${container}`), { status: 404 });
  return { cluster, namespace, clients, targets: targets.slice(0, MAX_LOG_TARGETS), truncated: targets.length > MAX_LOG_TARGETS };
};

const num = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.max(n, min), max) : undefined;
};

export const getLogs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { cluster, namespace, clients, targets, truncated } = await resolveTargets(req);
    const { lines, errors } = await fetchLogs(clients.kc, {
      namespace,
      targets,
      tailLines: num(req.query.tailLines, 10, 10000) ?? 500,
      sinceSeconds: num(req.query.sinceSeconds, 10, 7 * 86400),
      previous: req.query.previous === 'true',
    });
    res.json({ cluster, namespace, targets, truncated, lines, errors });
  } catch (err) {
    fail(res, err);
  }
};

// Live tail as NDJSON: one {type:'line'|'status'|'ping'} object per line, until the client disconnects.
export const streamLogs = async (req: AuthRequest, res: Response): Promise<void> => {
  let target;
  try {
    target = await resolveTargets(req);
  } catch (err) {
    fail(res, err);
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (obj: unknown) => res.write(`${JSON.stringify(obj)}\n`);
  send({ type: 'status', status: 'connected', targets: target.targets, truncated: target.truncated });

  let open = target.targets.length;
  const stop = await followLogs(
    target.clients.kc,
    target.namespace,
    target.targets,
    (line) => send({ type: 'line', ...line }),
    (t, status, message) => {
      send({ type: 'status', target: t, status, message });
      open -= 1;
      if (open <= 0) res.end();
    }
  );
  const ping = setInterval(() => send({ type: 'ping', at: new Date().toISOString() }), 15000);
  req.on('close', () => {
    clearInterval(ping);
    stop();
  });
};

// Loki: logs that outlive the pod (deleted pods, older than the container's log file).
export const getLogHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const loki = await defaultConnector('loki');
    if (!loki) {
      res.status(409).json({ message: 'No Loki connector. Add one in Connectors → Observability to search log history.' });
      return;
    }
    const namespace = requireNamespace(req.query.namespace);
    const pods = String(req.query.pods || '').split(',').filter((p) => p && p !== 'all');
    const container = String(req.query.container || 'all');
    const search = cleanString(req.query.search, 200);
    const sinceSeconds = num(req.query.sinceSeconds, 60, 30 * 86400) ?? 3600;
    const limit = num(req.query.limit, 10, 5000) ?? 1000;
    const esc = (s: string) => s.replace(/[\\"]/g, '\\$&');
    const regex = (vals: string[]) => vals.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&')).join('|');
    const selector = [
      `namespace="${esc(namespace)}"`,
      pods.length ? `pod=~"${regex(pods)}"` : '',
      container !== 'all' ? `container="${esc(container)}"` : '',
    ].filter(Boolean);
    const query = `{${selector.join(', ')}}${search ? ` |= "${esc(search)}"` : ''}`;
    const end = Date.now();
    const data: any = await observabilityGet(loki, '/loki/api/v1/query_range', {
      query,
      start: String((end - sinceSeconds * 1000) * 1e6),
      end: String(end * 1e6),
      limit,
      direction: 'backward',
    }, 30000);
    const lines = (data?.data?.result || [])
      .flatMap((stream: any) =>
        (stream.values || []).map(([ns, text]: [string, string]) => ({
          ts: new Date(Number(BigInt(ns) / 1000000n)).toISOString(),
          pod: stream.stream?.pod || stream.stream?.instance || '',
          container: stream.stream?.container || '',
          text,
        }))
      )
      .sort((a: any, b: any) => a.ts.localeCompare(b.ts));
    res.json({ source: loki.name, query, lines });
  } catch (err) {
    fail(res, err, 'Loki');
  }
};

// ---------------------------------------------------------------- metrics

export const getUsage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cluster = await pickCluster(req.query.cluster);
    const namespace = requireNamespace(req.query.namespace || 'all');
    const { kc, core } = await resolveClients(cluster);
    const [usage, nodes] = await Promise.all([
      podUsage(kc, namespace === 'all' ? undefined : namespace),
      core.listNode().catch(() => null),
    ]);
    const scope = await buildScope(req.user);
    if (!usage) {
      res.json({ cluster, available: false, message: 'metrics-server is not installed or not ready (minikube: minikube addons enable metrics-server)' });
      return;
    }
    const capacity = (nodes?.items || []).reduce(
      (acc, n) => ({
        cpuCores: acc.cpuCores + Number(n.status?.allocatable?.cpu?.replace(/m$/, '') || 0) / (n.status?.allocatable?.cpu?.endsWith('m') ? 1000 : 1),
        memoryBytes: acc.memoryBytes + (Number((n.status?.allocatable?.memory || '0').replace(/Ki$/, '')) * 1024 || 0),
      }),
      { cpuCores: 0, memoryBytes: 0 }
    );
    res.json({
      cluster,
      available: true,
      capacity,
      pods: [...usage.entries()].filter(([key]) => !scope || scope.namespaces.has(key.split('/')[0])).map(([key, u]) => {
        const [ns, pod] = key.split('/');
        return { namespace: ns, pod, cpuCores: u.cpuCores, memoryBytes: u.memoryBytes, containers: u.containers };
      }),
    });
  } catch (err) {
    fail(res, err);
  }
};

const RANGES: Record<string, number> = { '15m': 900, '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800 };

const promRange = async (prom: IObservabilityIntegration, query: string, seconds: number) => {
  const end = Math.floor(Date.now() / 1000);
  const step = Math.max(15, Math.round(seconds / 120));
  const data: any = await observabilityGet(prom, '/api/v1/query_range', { query, start: end - seconds, end, step }, 30000);
  return (data?.data?.result || [])
    .map((r: any) => ({
    name: r.metric?.pod || r.metric?.container || r.metric?.namespace || Object.values(r.metric || {}).join(' ') || 'value',
    labels: r.metric || {},
    // NaN/Inf (e.g. a quantile over zero requests) would break charts; drop those points.
    points: (r.values || []).map(([t, v]: [number, string]) => [t * 1000, Number(v)]).filter(([, v]: [number, number]) => Number.isFinite(v)),
  }))
    .filter((s: any) => s.points.length > 0);
};

// Kubernetes / Compute Resources dashboards shipped with kube-prometheus-stack.
const GRAFANA_DASHBOARDS = {
  pod: '6581e46e4e5c7ba40a07646395ef7b23',
  namespace: '85a562078cdf77779eaa1add43ccec1e',
};

const grafanaLinks = async (namespace: string, pod?: string) => {
  const grafana = await defaultConnector('grafana');
  if (!grafana?.publicUrl) return null;
  const base = grafana.publicUrl.replace(/\/+$/, '');
  const ns = encodeURIComponent(namespace);
  return {
    namespace: `${base}/d/${GRAFANA_DASHBOARDS.namespace}/?var-namespace=${ns}`,
    pod: pod ? `${base}/d/${GRAFANA_DASHBOARDS.pod}/?var-namespace=${ns}&var-pod=${encodeURIComponent(pod)}` : undefined,
    explore: `${base}/explore`,
  };
};

export const getMetricsRange = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prom = await defaultConnector('prometheus');
    if (!prom) {
      res.status(409).json({ message: 'No Prometheus connector. Add one in Connectors → Observability (Discover finds it in the cluster).' });
      return;
    }
    const namespace = requireNamespace(req.query.namespace);
    if (namespace === 'all') throw Object.assign(new Error('Pick a namespace'), { status: 400 });
    const pods = String(req.query.pods || '').split(',').filter((p) => p && p !== 'all' && DNS.test(p));
    const range = RANGES[String(req.query.range)] ? String(req.query.range) : '1h';
    const seconds = RANGES[range];
    const podSel = pods.length ? `, pod=~"${pods.join('|')}"` : '';
    const sel = `namespace="${namespace}"${podSel}`;
    const w = seconds <= 3600 ? '2m' : '5m';

    // Per-container cAdvisor series when the runtime exports them, else the pod cgroup
    // (minikube's docker driver only has the pod-level series, without a container label).
    const perPod = (metric: string, rate: boolean) => {
      const wrap = (m: string) => (rate ? `rate(${m}[${w}])` : m);
      return `sum by (pod) (${wrap(`${metric}{${sel}, container!="", container!="POD"}`)}) or sum by (pod) (${wrap(`${metric}{${sel}, container="", id=~".*/pod[^/]+"}`)})`;
    };
    // Application metrics: the prom-client convention http_request_duration_seconds{method, route, status},
    // scraped through a ServiceMonitor. Probe and scrape traffic is left out so it doesn't hide real load.
    const http = `http_request_duration_seconds`;
    const appSel = `${sel}, route!~"/health.*|/metrics"`;
    const panels: { key: string; title: string; unit: string; query: string; group: 'app' | 'resources'; aggregate?: 'sum' | 'max' }[] = [
      { key: 'rps', group: 'app', title: 'Requests per second (by route)', unit: 'rps', query: `sum by (route) (rate(${http}_count{${appSel}}[${w}]))` },
      {
        key: 'latency',
        group: 'app',
        aggregate: 'max',
        title: 'Latency p95 (by route)',
        unit: 'seconds',
        query: `histogram_quantile(0.95, sum by (le, route) (rate(${http}_bucket{${appSel}}[${w}])))`,
      },
      {
        key: 'status',
        group: 'app',
        title: 'Responses by status',
        unit: 'rps',
        query: `sum by (code) (label_replace(rate(${http}_count{${appSel}}[${w}]), "code", "\${1}xx", "status", "([0-9]).*"))`,
      },
      {
        key: 'errors',
        group: 'app',
        aggregate: 'max',
        title: 'Error rate (5xx %)',
        unit: 'percent',
        query: `100 * (sum(rate(${http}_count{${appSel}, status=~"5.."}[${w}])) or vector(0)) / sum(rate(${http}_count{${appSel}}[${w}]))`,
      },
      { key: 'cpu', group: 'resources', title: 'CPU usage', unit: 'cores', query: perPod('container_cpu_usage_seconds_total', true) },
      { key: 'memory', group: 'resources', title: 'Memory (working set)', unit: 'bytes', query: perPod('container_memory_working_set_bytes', false) },
      { key: 'netRx', group: 'resources', title: 'Network received', unit: 'Bps', query: `sum by (pod) (rate(container_network_receive_bytes_total{${sel}}[${w}]))` },
      { key: 'netTx', group: 'resources', title: 'Network sent', unit: 'Bps', query: `sum by (pod) (rate(container_network_transmit_bytes_total{${sel}}[${w}]))` },
      { key: 'restarts', group: 'resources', title: 'Container restarts', unit: 'count', query: `sum by (pod) (kube_pod_container_status_restarts_total{${sel}})` },
      { key: 'throttle', group: 'resources', title: 'CPU throttled', unit: 'percent', query: `100 * (${perPod('container_cpu_cfs_throttled_periods_total', true)}) / clamp_min(${perPod('container_cpu_cfs_periods_total', true)}, 0.001)` },
    ];
    const limits = {
      cpu: `sum by (pod) (kube_pod_container_resource_limits{${sel}, resource="cpu"})`,
      memory: `sum by (pod) (kube_pod_container_resource_limits{${sel}, resource="memory"})`,
    };

    const results = await Promise.all(panels.map((p) => promRange(prom, p.query, seconds).catch((e) => ({ error: describeRequestError(e, 'Prometheus') }))));
    const limitResults = await Promise.all([promRange(prom, limits.cpu, seconds).catch(() => []), promRange(prom, limits.memory, seconds).catch(() => [])]);
    const lastValue = (series: any[]) => series.reduce((sum: number, s: any) => sum + (s.points.at(-1)?.[1] || 0), 0);

    res.json({
      source: prom.name,
      namespace,
      pods,
      range,
      panels: panels.map((p, i) => {
        const r: any = results[i];
        return {
          key: p.key,
          group: p.group,
          aggregate: p.aggregate || 'sum',
          title: p.title,
          unit: p.unit,
          query: p.query,
          error: r?.error,
          series: Array.isArray(r) ? r : [],
          limit: p.key === 'cpu' ? lastValue(limitResults[0]) || undefined : p.key === 'memory' ? lastValue(limitResults[1]) || undefined : undefined,
        };
      }),
      grafana: await grafanaLinks(namespace, pods.length === 1 ? pods[0] : undefined),
    });
  } catch (err) {
    fail(res, err, 'Prometheus');
  }
};

// Free-form PromQL for the Explore box (DevOps / Super Admin only).
export const queryMetrics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prom = await defaultConnector('prometheus');
    if (!prom) {
      res.status(409).json({ message: 'No Prometheus connector configured' });
      return;
    }
    const query = cleanString(req.query.query, 2000);
    if (!query) throw Object.assign(new Error('Enter a PromQL query'), { status: 400 });
    const range = RANGES[String(req.query.range)] ? String(req.query.range) : '1h';
    res.json({ query, range, series: await promRange(prom, query, RANGES[range]) });
  } catch (err: any) {
    const data = err?.response?.data;
    if (data?.error) {
      res.status(400).json({ message: `PromQL: ${data.error}` });
      return;
    }
    fail(res, err, 'Prometheus');
  }
};

// ---------------------------------------------------------------- connectors

export const serializeObservability = (c: IObservabilityIntegration) => ({
  _id: String(c._id),
  name: c.name,
  kind: c.kind,
  access: c.access,
  clusterName: c.clusterName,
  namespace: c.namespace,
  service: c.service,
  port: c.port,
  scheme: c.scheme,
  url: c.url,
  publicUrl: c.publicUrl,
  authType: c.authType,
  username: c.username,
  hasPassword: Boolean(c.password),
  hasToken: Boolean(c.token),
  tokenHint: maskSecret(c.token || c.password),
  insecure: c.insecure,
  isDefault: c.isDefault,
  isActive: c.isActive,
  status: c.status,
  lastError: c.lastError,
  lastTestedAt: c.lastTestedAt,
  version: c.version,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const KINDS: ObservabilityKind[] = ['prometheus', 'grafana', 'loki'];

// Validates the body into connection fields; `current` supplies stored secrets on edit.
const readInput = (body: any, current?: IObservabilityIntegration): { fields?: ConnectionFields & { name: string; publicUrl: string }; error?: string } => {
  const kind = (body.kind ?? current?.kind) as ObservabilityKind;
  if (!KINDS.includes(kind)) return { error: 'Kind must be prometheus, grafana or loki' };
  const name = cleanString(body.name ?? current?.name, 80);
  if (!name) return { error: 'Enter a name' };
  const access = (body.access ?? current?.access ?? 'service') === 'url' ? 'url' : 'service';
  const fields = {
    name,
    kind,
    access,
    clusterName: cleanString(body.clusterName ?? current?.clusterName, 63),
    namespace: cleanString(body.namespace ?? current?.namespace, 63),
    service: cleanString(body.service ?? current?.service, 63),
    port: Number(body.port ?? current?.port) || 0,
    scheme: (body.scheme ?? current?.scheme) === 'https' ? 'https' : 'http',
    url: body.url !== undefined ? normalizeUrl(String(body.url)) : current?.url || '',
    publicUrl: body.publicUrl !== undefined ? normalizeUrl(String(body.publicUrl)) : current?.publicUrl || '',
    authType: ['basic', 'bearer'].includes(body.authType ?? current?.authType) ? (body.authType ?? current?.authType) : 'none',
    username: cleanString(body.username ?? current?.username, 100),
    password: body.password ? String(body.password) : current?.password || '',
    token: body.token ? String(body.token) : current?.token || '',
    insecure: Boolean(body.insecure ?? current?.insecure),
  } as ConnectionFields & { name: string; publicUrl: string };

  if (access === 'service') {
    if (!fields.clusterName) return { error: 'Pick the cluster that runs the service' };
    if (!DNS.test(fields.namespace) || !DNS.test(fields.service)) return { error: 'Enter a valid namespace and service name' };
    if (!(fields.port > 0 && fields.port < 65536)) return { error: 'Enter the service port' };
  } else if (!isHttpUrl(fields.url)) return { error: 'Enter a valid http(s) URL' };
  if (fields.publicUrl && !isHttpUrl(fields.publicUrl)) return { error: 'Browser URL must be a valid http(s) URL' };
  return { fields };
};

export const listObservabilityConnectors = async (_req: AuthRequest, res: Response): Promise<void> => {
  const items = await ObservabilityIntegration.find().sort({ kind: 1, isDefault: -1, name: 1 });
  res.json({ connectors: items.map(serializeObservability) });
};

const applyProbe = async (doc: IObservabilityIntegration) => {
  doc.lastTestedAt = new Date();
  try {
    const r = await probeObservability(doc);
    doc.status = 'Connected';
    doc.version = r.version;
    doc.lastError = '';
    return { ok: true, message: r.message };
  } catch (err) {
    doc.status = 'Error';
    doc.lastError = describeRequestError(err, doc.kind === 'prometheus' ? 'Prometheus' : doc.kind === 'loki' ? 'Loki' : 'Grafana');
    return { ok: false, message: doc.lastError };
  }
};

export const createObservabilityConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { fields, error } = readInput(req.body || {});
    if (!fields) {
      res.status(400).json({ message: error });
      return;
    }
    if (await ObservabilityIntegration.exists({ name: fields.name })) {
      res.status(409).json({ message: `A connector named ${fields.name} already exists` });
      return;
    }
    const first = !(await ObservabilityIntegration.exists({ kind: fields.kind }));
    const doc = new ObservabilityIntegration({ ...fields, isDefault: first || Boolean(req.body.isDefault), isActive: req.body.isActive !== false });
    if (doc.isDefault) await ObservabilityIntegration.updateMany({ kind: fields.kind }, { isDefault: false });
    const test = await applyProbe(doc);
    await doc.save();
    res.status(201).json({ message: `${doc.name} added. ${test.message}`, test, connector: serializeObservability(doc) });
  } catch (err) {
    fail(res, err, 'DevOps Intelligence', 500);
  }
};

export const updateObservabilityConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const doc = isValidId(req.params.id) ? await ObservabilityIntegration.findById(req.params.id) : null;
    if (!doc) {
      res.status(404).json({ message: 'Connector not found' });
      return;
    }
    const { fields, error } = readInput(req.body || {}, doc);
    if (!fields) {
      res.status(400).json({ message: error });
      return;
    }
    if (fields.name !== doc.name && (await ObservabilityIntegration.exists({ name: fields.name }))) {
      res.status(409).json({ message: `A connector named ${fields.name} already exists` });
      return;
    }
    Object.assign(doc, fields);
    if (typeof req.body.isActive === 'boolean') doc.isActive = req.body.isActive;
    if (req.body.isDefault === true) {
      await ObservabilityIntegration.updateMany({ kind: doc.kind, _id: { $ne: doc._id } }, { isDefault: false });
      doc.isDefault = true;
    }
    const test = await applyProbe(doc);
    await doc.save();
    res.json({ message: `${doc.name} saved. ${test.message}`, test, connector: serializeObservability(doc) });
  } catch (err) {
    fail(res, err, 'DevOps Intelligence', 500);
  }
};

export const deleteObservabilityConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  const doc = isValidId(req.params.id) ? await ObservabilityIntegration.findByIdAndDelete(req.params.id) : null;
  if (!doc) {
    res.status(404).json({ message: 'Connector not found' });
    return;
  }
  if (doc.isDefault) {
    const next = await ObservabilityIntegration.findOne({ kind: doc.kind }).sort({ createdAt: 1 });
    if (next) await ObservabilityIntegration.updateOne({ _id: next._id }, { isDefault: true });
  }
  res.json({ message: `${doc.name} deleted` });
};

// Test unsaved settings (the form's "Test connection"), reusing stored secrets when editing.
export const testObservabilityConnection = async (req: AuthRequest, res: Response): Promise<void> => {
  const current = isValidId(req.body?.id) ? await ObservabilityIntegration.findById(req.body.id) : undefined;
  const { fields, error } = readInput(req.body || {}, current || undefined);
  if (!fields) {
    res.status(400).json({ ok: false, message: error });
    return;
  }
  try {
    const r = await probeObservability(fields);
    res.json({ ok: true, message: r.message, details: { version: r.version } });
  } catch (err) {
    res.json({ ok: false, message: describeRequestError(err, fields.kind === 'prometheus' ? 'Prometheus' : fields.kind === 'loki' ? 'Loki' : 'Grafana') });
  }
};

export const testSavedObservabilityConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  const doc = isValidId(req.params.id) ? await ObservabilityIntegration.findById(req.params.id) : null;
  if (!doc) {
    res.status(404).json({ message: 'Connector not found' });
    return;
  }
  const test = await applyProbe(doc);
  await doc.save();
  res.json({ ...test, connector: serializeObservability(doc) });
};

export const discoverObservabilityServices = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cluster = await pickCluster(req.query.cluster);
    res.json({ cluster, services: await discoverObservability(cluster) });
  } catch (err) {
    fail(res, err);
  }
};

// ---------------------------------------------------------------- resource browser

export const getKinds = (_req: AuthRequest, res: Response): void => {
  res.json({
    kinds: Object.entries(RESOURCE_KINDS).map(([key, d]) => ({ key, kind: d.kind, namespaced: d.namespaced, columns: d.columns })),
  });
};

export const getResources = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const key = String(req.query.kind || '').toLowerCase();
    const def = RESOURCE_KINDS[key];
    if (!def) throw Object.assign(new Error(`Unknown kind ${key}`), { status: 400 });
    const cluster = await pickCluster(req.query.cluster);
    const namespace = requireNamespace(req.query.namespace || 'all');
    const { kc } = await resolveClients(cluster);
    if (!def.namespaced && def.kind !== 'Namespace' && !isManager(req.user)) throw Object.assign(new Error(`${def.kind} is cluster-wide: DevOps admins only`), { status: 403 });
    const [items, owners] = await Promise.all([listKind(kc, def, namespace), namespaceOwners()]);
    const scope = await buildScope(req.user);
    const inScope = (o: any) => !scope || scope.namespaces.has(def.kind === 'Namespace' ? o.metadata?.name : o.metadata?.namespace);
    const rows = items.filter(inScope).map((o) => {
      const r = def.row(o);
      const ns = o.metadata?.namespace || '';
      const owner = owners.get(def.kind === 'Namespace' ? o.metadata?.name : ns);
      return {
        name: o.metadata?.name || '',
        namespace: ns,
        createdAt: o.metadata?.creationTimestamp,
        labels: o.metadata?.labels || {},
        selector: o.spec?.selector?.matchLabels || (def.kind === 'Service' ? o.spec?.selector : undefined) || undefined,
        project: owner?.project,
        projectId: owner?.projectId,
        environment: owner?.environment,
        ...r,
      };
    });
    res.json({ cluster, kind: def.kind, namespaced: def.namespaced, columns: def.columns, rows });
  } catch (err: any) {
    if (err?.response?.status === 404) {
      res.json({ cluster: req.query.cluster, kind: req.query.kind, rows: [], columns: [], message: 'This kind is not available on this cluster' });
      return;
    }
    fail(res, err);
  }
};

export const getResourceDetail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const key = String(req.params.kind).toLowerCase();
    const def = RESOURCE_KINDS[key];
    if (!def) throw Object.assign(new Error(`Unknown kind ${key}`), { status: 400 });
    const cluster = await pickCluster(req.query.cluster);
    const namespace = def.namespaced ? requireNamespace(req.params.namespace) : '';
    const name = String(req.params.name);
    if (!def.namespaced && !isManager(req.user)) {
      const scope = await buildScope(req.user);
      if (!(def.kind === 'Namespace' && scope?.namespaces.has(name))) throw Object.assign(new Error(`${def.kind} is cluster-wide: DevOps admins only`), { status: 403 });
    }
    const { kc, core } = await resolveClients(cluster);
    const obj = redact(await readObject(kc, def, namespace, name));
    const [events, pods] = await Promise.all([
      listEvents(core, def.namespaced ? namespace : 'all', name).catch(() => []),
      // Pods behind a workload or service, so their logs are one click away.
      (async () => {
        const selector = obj.spec?.selector?.matchLabels || (def.kind === 'Service' ? obj.spec?.selector : null);
        if (!def.namespaced || !selector || !Object.keys(selector).length) return [];
        const labelSelector = Object.entries(selector).map(([k, v]) => `${k}=${v}`).join(',');
        const list = await core.listNamespacedPod({ namespace, labelSelector });
        return list.items.map(summarizePod);
      })().catch(() => []),
    ]);
    res.json({ cluster, kind: def.kind, name, namespace, yaml: dumpYaml(obj), events, pods, row: def.row(obj) });
  } catch (err) {
    fail(res, err);
  }
};
