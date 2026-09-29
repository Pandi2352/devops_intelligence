import * as k8s from '@kubernetes/client-node';
import { Project } from '../models/Project.js';
import { kubeRequest, kubeStream, parseCpu, parseMemory } from '../utils/kubeRaw.js';

// ---------------------------------------------------------------- project / environment lookup

export interface NamespaceOwner {
  projectId: string;
  project: string;
  environment: string;
  appName: string;
  cluster: string;
}

// namespace -> the project environment deployed there (from the project's ArgoCD app mappings).
export const namespaceOwners = async (): Promise<Map<string, NamespaceOwner>> => {
  const projects = await Project.find({}, { name: 1, argoApps: 1, kubernetesMappings: 1 });
  const map = new Map<string, NamespaceOwner>();
  for (const p of projects) {
    const cluster = p.kubernetesMappings?.[0]?.clusterName || '';
    for (const a of p.argoApps || []) {
      if (!a.targetNamespace) continue;
      map.set(a.targetNamespace, {
        projectId: String(p._id),
        project: p.name,
        environment: a.environment || a.branch || '',
        appName: a.appName,
        cluster,
      });
    }
  }
  return map;
};

// ---------------------------------------------------------------- pod summary

export interface ContainerSummary {
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

export interface PodSummary {
  name: string;
  namespace: string;
  phase: string;
  status: string; // what kubectl shows: Running, CrashLoopBackOff, ImagePullBackOff, Completed ...
  problem: string; // one-line explanation when something is wrong
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
  containers: ContainerSummary[];
  conditions: { type: string; status: string; reason?: string; message?: string; lastTransitionTime?: string }[];
  usage?: { cpuCores: number; memoryBytes: number };
  projectId?: string;
  project?: string;
  environment?: string;
}

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : undefined);

const containerSummary = (spec: k8s.V1Container, status: k8s.V1ContainerStatus | undefined, init: boolean): ContainerSummary => {
  const st = status?.state;
  const state: ContainerSummary['state'] = st?.running ? 'running' : st?.waiting ? 'waiting' : st?.terminated ? 'terminated' : 'unknown';
  const last = status?.lastState?.terminated;
  return {
    name: spec.name,
    image: status?.image || spec.image || '',
    init,
    ready: Boolean(status?.ready),
    started: Boolean(status?.started),
    state,
    reason: st?.waiting?.reason || st?.terminated?.reason || '',
    message: st?.waiting?.message || st?.terminated?.message || '',
    startedAt: iso(st?.running?.startedAt || st?.terminated?.startedAt),
    restartCount: status?.restartCount || 0,
    lastTermination: last ? { reason: last.reason || '', exitCode: last.exitCode, finishedAt: iso(last.finishedAt), message: last.message } : undefined,
    requests: { cpu: spec.resources?.requests?.cpu, memory: spec.resources?.requests?.memory },
    limits: { cpu: spec.resources?.limits?.cpu, memory: spec.resources?.limits?.memory },
    ports: (spec.ports || []).map((p) => `${p.containerPort}/${p.protocol || 'TCP'}${p.name ? ` (${p.name})` : ''}`),
  };
};

const EXPLAIN: Record<string, string> = {
  CrashLoopBackOff: 'The container keeps crashing and Kubernetes is waiting before restarting it. Check the logs of the previous run.',
  ImagePullBackOff: 'The image cannot be pulled. Check the image name/tag and the registry pull secret.',
  ErrImagePull: 'The image cannot be pulled. Check the image name/tag and the registry pull secret.',
  CreateContainerConfigError: 'A ConfigMap or Secret the container needs is missing.',
  OOMKilled: 'The container used more memory than its limit and was killed.',
  Error: 'The container exited with an error.',
  ContainerCreating: 'The container is being created (pulling the image, mounting volumes).',
  PodInitializing: 'Init containers are still running.',
};

export const summarizePod = (p: k8s.V1Pod): PodSummary => {
  const statuses = p.status?.containerStatuses || [];
  const initStatuses = p.status?.initContainerStatuses || [];
  const containers = [
    ...(p.spec?.initContainers || []).map((c) => containerSummary(c, initStatuses.find((s) => s.name === c.name), true)),
    ...(p.spec?.containers || []).map((c) => containerSummary(c, statuses.find((s) => s.name === c.name), false)),
  ];
  const main = containers.filter((c) => !c.init);
  const readyCount = main.filter((c) => c.ready).length;
  const restarts = main.reduce((n, c) => n + c.restartCount, 0);
  const lastRestartAt = main.map((c) => c.lastTermination?.finishedAt).filter(Boolean).sort().pop();

  // Same precedence kubectl uses: a waiting/terminated reason beats the phase.
  const phase = p.status?.phase || 'Unknown';
  let status: string = p.metadata?.deletionTimestamp ? 'Terminating' : phase;
  const initProblem = containers.find((c) => c.init && c.state === 'waiting' && c.reason && c.reason !== 'PodInitializing');
  const mainProblem = main.find((c) => c.state === 'waiting' && c.reason) || main.find((c) => c.state === 'terminated' && c.reason && c.reason !== 'Completed');
  if (initProblem) status = `Init:${initProblem.reason}`;
  else if (mainProblem) status = mainProblem.reason;
  else if (phase === 'Succeeded') status = 'Completed';
  else if (phase === 'Pending' && p.status?.reason) status = p.status.reason;

  const unschedulable = p.status?.conditions?.find((c) => c.type === 'PodScheduled' && c.status === 'False');
  const problemReason = initProblem?.reason || mainProblem?.reason || '';
  const crashed = main.find((c) => c.lastTermination && c.restartCount > 0 && !c.ready);
  let problem = '';
  if (unschedulable) problem = unschedulable.message || 'The pod cannot be scheduled on any node.';
  else if (problemReason) problem = [EXPLAIN[problemReason], initProblem?.message || mainProblem?.message].filter(Boolean).join(' ');
  else if (crashed?.lastTermination) problem = `Last run ended with ${crashed.lastTermination.reason || 'exit'} (exit code ${crashed.lastTermination.exitCode}).`;
  else if (phase === 'Running' && readyCount < main.length) problem = 'Running but not ready: the readiness probe is failing.';

  const ownerRef = p.metadata?.ownerReferences?.find((o) => o.controller) || p.metadata?.ownerReferences?.[0];
  let owner = ownerRef ? { kind: ownerRef.kind, name: ownerRef.name } : null;
  // A ReplicaSet named <deployment>-<pod-template-hash> belongs to that Deployment.
  const hash = p.metadata?.labels?.['pod-template-hash'];
  if (owner?.kind === 'ReplicaSet' && hash && owner.name.endsWith(`-${hash}`)) owner = { kind: 'Deployment', name: owner.name.slice(0, -hash.length - 1) };

  return {
    name: p.metadata?.name || '',
    namespace: p.metadata?.namespace || '',
    phase,
    status,
    problem,
    ready: `${readyCount}/${main.length}`,
    readyCount,
    containerCount: main.length,
    restarts,
    lastRestartAt,
    createdAt: iso(p.metadata?.creationTimestamp),
    node: p.spec?.nodeName || '',
    podIP: p.status?.podIP || '',
    hostIP: p.status?.hostIP || '',
    qosClass: p.status?.qosClass || '',
    owner,
    labels: p.metadata?.labels || {},
    containers,
    conditions: (p.status?.conditions || []).map((c) => ({
      type: c.type,
      status: c.status,
      reason: c.reason,
      message: c.message,
      lastTransitionTime: iso(c.lastTransitionTime),
    })),
  };
};

// ---------------------------------------------------------------- usage (metrics-server)

export interface PodUsage {
  cpuCores: number;
  memoryBytes: number;
  containers: Record<string, { cpuCores: number; memoryBytes: number }>;
}

export const podUsage = async (kc: k8s.KubeConfig, namespace?: string): Promise<Map<string, PodUsage> | null> => {
  const path = namespace ? `/apis/metrics.k8s.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/pods` : '/apis/metrics.k8s.io/v1beta1/pods';
  try {
    const data: any = await kubeRequest(kc, path, { timeoutMs: 8000 });
    const map = new Map<string, PodUsage>();
    for (const item of data.items || []) {
      const containers: PodUsage['containers'] = {};
      let cpu = 0;
      let mem = 0;
      for (const c of item.containers || []) {
        const u = { cpuCores: parseCpu(c.usage?.cpu), memoryBytes: parseMemory(c.usage?.memory) };
        containers[c.name] = u;
        cpu += u.cpuCores;
        mem += u.memoryBytes;
      }
      map.set(`${item.metadata.namespace}/${item.metadata.name}`, { cpuCores: cpu, memoryBytes: mem, containers });
    }
    return map;
  } catch {
    return null; // metrics-server not installed or not ready
  }
};

// ---------------------------------------------------------------- events

export interface EventSummary {
  type: string;
  reason: string;
  message: string;
  object: string;
  count: number;
  firstSeen?: string;
  lastSeen?: string;
  source: string;
}

export const listEvents = async (core: k8s.CoreV1Api, namespace: string, involvedName?: string): Promise<EventSummary[]> => {
  const fieldSelector = involvedName ? `involvedObject.name=${involvedName}` : undefined;
  const list = namespace === 'all' ? await core.listEventForAllNamespaces({ fieldSelector }) : await core.listNamespacedEvent({ namespace, fieldSelector });
  return list.items
    .map((e) => ({
      type: e.type || 'Normal',
      reason: e.reason || '',
      message: e.message || '',
      object: `${e.involvedObject?.kind || ''}/${e.involvedObject?.name || ''}`,
      count: e.count || e.series?.count || 1,
      firstSeen: iso(e.firstTimestamp || e.eventTime || e.metadata?.creationTimestamp),
      lastSeen: iso(e.lastTimestamp || e.series?.lastObservedTime || e.eventTime || e.metadata?.creationTimestamp),
      source: e.source?.component || e.reportingComponent || '',
    }))
    .sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));
};

// ---------------------------------------------------------------- logs

export interface LogTarget {
  pod: string;
  container: string;
}

export interface LogLine {
  ts: string;
  pod: string;
  container: string;
  text: string;
}

export interface LogQuery {
  namespace: string;
  targets: LogTarget[];
  tailLines?: number;
  sinceSeconds?: number;
  previous?: boolean;
}

const logPath = (namespace: string, pod: string) => `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/log`;

// "2026-09-28T11:37:36.123456789Z message" -> [ts, message]
export const splitTimestamp = (line: string): [string, string] => {
  const i = line.indexOf(' ');
  if (i > 0 && /^\d{4}-\d{2}-\d{2}T/.test(line)) return [line.slice(0, i), line.slice(i + 1)];
  return ['', line];
};

export const fetchLogs = async (kc: k8s.KubeConfig, q: LogQuery): Promise<{ lines: LogLine[]; errors: { target: string; message: string }[] }> => {
  const errors: { target: string; message: string }[] = [];
  const results = await Promise.all(
    q.targets.map(async (t) => {
      try {
        const text = await kubeRequest<string>(kc, logPath(q.namespace, t.pod), {
          query: {
            container: t.container,
            timestamps: true,
            tailLines: q.sinceSeconds ? undefined : q.tailLines,
            sinceSeconds: q.sinceSeconds,
            previous: q.previous || undefined,
            limitBytes: 5 * 1024 * 1024,
          },
          timeoutMs: 30000,
        });
        return String(text || '')
          .split('\n')
          .filter((l) => l.length > 0)
          .map((l) => {
            const [ts, body] = splitTimestamp(l);
            return { ts, pod: t.pod, container: t.container, text: body };
          });
      } catch (err: any) {
        errors.push({ target: `${t.pod}/${t.container}`, message: err?.message || 'Could not read logs' });
        return [];
      }
    })
  );
  const lines = results.flat().sort((a, b) => a.ts.localeCompare(b.ts));
  // With several pods the per-pod tail adds up; keep the newest N overall.
  const max = Math.max(q.tailLines || 1000, 1000);
  return { lines: lines.length > max * 2 ? lines.slice(-max * 2) : lines, errors };
};

// Follow logs of several containers; calls onLine for every complete line until stop() is called.
export const followLogs = async (
  kc: k8s.KubeConfig,
  namespace: string,
  targets: LogTarget[],
  onLine: (line: LogLine) => void,
  onStatus: (target: string, status: 'ended' | 'error', message?: string) => void
): Promise<() => void> => {
  const stops = await Promise.all(
    targets.map(async (t) => {
      let buffer = '';
      return kubeStream(
        kc,
        logPath(namespace, t.pod),
        { query: { container: t.container, follow: true, timestamps: true, sinceSeconds: 1 } },
        {
          onData: (chunk) => {
            buffer += chunk;
            const parts = buffer.split('\n');
            buffer = parts.pop() || '';
            for (const l of parts) {
              if (!l) continue;
              const [ts, text] = splitTimestamp(l);
              onLine({ ts, pod: t.pod, container: t.container, text });
            }
          },
          onEnd: (err) => onStatus(`${t.pod}/${t.container}`, err ? 'error' : 'ended', err?.message),
        }
      ).catch((err) => {
        onStatus(`${t.pod}/${t.container}`, 'error', err?.message);
        return () => undefined;
      });
    })
  );
  return () => stops.forEach((s) => s());
};
