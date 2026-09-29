import * as k8s from '@kubernetes/client-node';
import { kubeRequest } from '../utils/kubeRaw.js';

// Every kind the Resource Browser can list, with how to reach it and what to show per row.

export interface KindDef {
  kind: string;
  group: string; // '' = core
  version: string;
  plural: string;
  namespaced: boolean;
  columns: { key: string; label: string }[];
  row: (o: any) => { status: string; tone: Tone; cols: Record<string, string | number> };
}

export type Tone = 'ok' | 'warn' | 'bad' | 'muted';

const n = (v: unknown) => Number(v) || 0;
const images = (o: any) => (o.spec?.template?.spec?.containers || o.spec?.jobTemplate?.spec?.template?.spec?.containers || []).map((c: any) => c.image).join(', ');
const replicaRow = (o: any) => {
  const want = o.spec?.replicas ?? 1;
  const ready = n(o.status?.readyReplicas);
  return {
    status: want === 0 ? 'Scaled to 0' : ready >= want ? 'Healthy' : ready > 0 ? 'Degraded' : 'Unavailable',
    tone: (want === 0 ? 'muted' : ready >= want ? 'ok' : ready > 0 ? 'warn' : 'bad') as Tone,
    cols: { ready: `${ready}/${want}`, upToDate: n(o.status?.updatedReplicas), available: n(o.status?.availableReplicas), images: images(o) },
  };
};

export const KINDS: Record<string, KindDef> = {
  deployment: {
    kind: 'Deployment', group: 'apps', version: 'v1', plural: 'deployments', namespaced: true,
    columns: [{ key: 'ready', label: 'Ready' }, { key: 'upToDate', label: 'Up-to-date' }, { key: 'available', label: 'Available' }, { key: 'images', label: 'Images' }],
    row: replicaRow,
  },
  statefulset: {
    kind: 'StatefulSet', group: 'apps', version: 'v1', plural: 'statefulsets', namespaced: true,
    columns: [{ key: 'ready', label: 'Ready' }, { key: 'images', label: 'Images' }],
    row: replicaRow,
  },
  daemonset: {
    kind: 'DaemonSet', group: 'apps', version: 'v1', plural: 'daemonsets', namespaced: true,
    columns: [{ key: 'desired', label: 'Desired' }, { key: 'ready', label: 'Ready' }, { key: 'images', label: 'Images' }],
    row: (o) => {
      const want = n(o.status?.desiredNumberScheduled);
      const ready = n(o.status?.numberReady);
      return { status: ready >= want ? 'Healthy' : 'Degraded', tone: ready >= want ? 'ok' : 'warn', cols: { desired: want, ready, images: images(o) } };
    },
  },
  replicaset: {
    kind: 'ReplicaSet', group: 'apps', version: 'v1', plural: 'replicasets', namespaced: true,
    columns: [{ key: 'ready', label: 'Ready' }, { key: 'owner', label: 'Owner' }, { key: 'images', label: 'Images' }],
    row: (o) => {
      const r = replicaRow(o);
      return { ...r, cols: { ...r.cols, owner: o.metadata?.ownerReferences?.[0]?.name || '' } };
    },
  },
  job: {
    kind: 'Job', group: 'batch', version: 'v1', plural: 'jobs', namespaced: true,
    columns: [{ key: 'completions', label: 'Completions' }, { key: 'duration', label: 'Duration' }],
    row: (o) => {
      const done = o.status?.conditions?.find((c: any) => c.type === 'Complete' && c.status === 'True');
      const failed = o.status?.conditions?.find((c: any) => c.type === 'Failed' && c.status === 'True');
      const start = o.status?.startTime ? new Date(o.status.startTime).getTime() : 0;
      const end = o.status?.completionTime ? new Date(o.status.completionTime).getTime() : Date.now();
      return {
        status: failed ? 'Failed' : done ? 'Complete' : 'Running',
        tone: failed ? 'bad' : done ? 'muted' : 'warn',
        cols: { completions: `${n(o.status?.succeeded)}/${o.spec?.completions ?? 1}`, duration: start ? `${Math.round((end - start) / 1000)}s` : '' },
      };
    },
  },
  cronjob: {
    kind: 'CronJob', group: 'batch', version: 'v1', plural: 'cronjobs', namespaced: true,
    columns: [{ key: 'schedule', label: 'Schedule' }, { key: 'lastRun', label: 'Last run' }, { key: 'active', label: 'Active' }],
    row: (o) => ({
      status: o.spec?.suspend ? 'Suspended' : 'Scheduled',
      tone: o.spec?.suspend ? 'muted' : 'ok',
      cols: { schedule: o.spec?.schedule || '', lastRun: o.status?.lastScheduleTime || '', active: (o.status?.active || []).length },
    }),
  },
  configmap: {
    kind: 'ConfigMap', group: '', version: 'v1', plural: 'configmaps', namespaced: true,
    columns: [{ key: 'keys', label: 'Keys' }],
    row: (o) => ({ status: 'Active', tone: 'ok', cols: { keys: Object.keys(o.data || {}).length + Object.keys(o.binaryData || {}).length } }),
  },
  secret: {
    kind: 'Secret', group: '', version: 'v1', plural: 'secrets', namespaced: true,
    columns: [{ key: 'type', label: 'Type' }, { key: 'keys', label: 'Keys' }],
    row: (o) => ({ status: 'Active', tone: 'ok', cols: { type: o.type || '', keys: Object.keys(o.data || {}).length } }),
  },
  persistentvolumeclaim: {
    kind: 'PersistentVolumeClaim', group: '', version: 'v1', plural: 'persistentvolumeclaims', namespaced: true,
    columns: [{ key: 'capacity', label: 'Capacity' }, { key: 'storageClass', label: 'Storage class' }, { key: 'volume', label: 'Volume' }],
    row: (o) => ({
      status: o.status?.phase || 'Unknown',
      tone: o.status?.phase === 'Bound' ? 'ok' : o.status?.phase === 'Lost' ? 'bad' : 'warn',
      cols: { capacity: o.status?.capacity?.storage || o.spec?.resources?.requests?.storage || '', storageClass: o.spec?.storageClassName || '', volume: o.spec?.volumeName || '' },
    }),
  },
  storageclass: {
    kind: 'StorageClass', group: 'storage.k8s.io', version: 'v1', plural: 'storageclasses', namespaced: false,
    columns: [{ key: 'provisioner', label: 'Provisioner' }, { key: 'reclaim', label: 'Reclaim' }, { key: 'default', label: 'Default' }],
    row: (o) => ({
      status: 'Active',
      tone: 'ok',
      cols: {
        provisioner: o.provisioner || '',
        reclaim: o.reclaimPolicy || '',
        default: o.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true' ? 'yes' : '',
      },
    }),
  },
  service: {
    kind: 'Service', group: '', version: 'v1', plural: 'services', namespaced: true,
    columns: [{ key: 'type', label: 'Type' }, { key: 'clusterIP', label: 'Cluster IP' }, { key: 'ports', label: 'Ports' }, { key: 'selector', label: 'Selector' }],
    row: (o) => ({
      status: 'Active',
      tone: 'ok',
      cols: {
        type: o.spec?.type || '',
        clusterIP: o.spec?.clusterIP || '',
        ports: (o.spec?.ports || []).map((p: any) => `${p.port}${p.targetPort ? `→${p.targetPort}` : ''}/${p.protocol || 'TCP'}${p.nodePort ? ` (node ${p.nodePort})` : ''}`).join(', '),
        selector: Object.entries(o.spec?.selector || {}).map(([k, v]) => `${k}=${v}`).join(', '),
      },
    }),
  },
  ingress: {
    kind: 'Ingress', group: 'networking.k8s.io', version: 'v1', plural: 'ingresses', namespaced: true,
    columns: [{ key: 'hosts', label: 'Hosts' }, { key: 'address', label: 'Address' }, { key: 'class', label: 'Class' }],
    row: (o) => ({
      status: 'Active',
      tone: 'ok',
      cols: {
        hosts: (o.spec?.rules || []).map((r: any) => r.host || '*').join(', '),
        address: (o.status?.loadBalancer?.ingress || []).map((i: any) => i.ip || i.hostname).join(', '),
        class: o.spec?.ingressClassName || '',
      },
    }),
  },
  endpoints: {
    kind: 'Endpoints', group: '', version: 'v1', plural: 'endpoints', namespaced: true,
    columns: [{ key: 'endpoints', label: 'Endpoints' }],
    row: (o) => {
      const addrs = (o.subsets || []).flatMap((s: any) => (s.addresses || []).flatMap((a: any) => (s.ports || [{ port: '' }]).map((p: any) => `${a.ip}:${p.port}`)));
      return { status: addrs.length ? 'Ready' : 'No endpoints', tone: addrs.length ? 'ok' : 'warn', cols: { endpoints: addrs.slice(0, 6).join(', ') + (addrs.length > 6 ? ` +${addrs.length - 6}` : '') } };
    },
  },
  networkpolicy: {
    kind: 'NetworkPolicy', group: 'networking.k8s.io', version: 'v1', plural: 'networkpolicies', namespaced: true,
    columns: [{ key: 'podSelector', label: 'Pod selector' }, { key: 'types', label: 'Policy types' }],
    row: (o) => ({
      status: 'Active',
      tone: 'ok',
      cols: {
        podSelector: Object.entries(o.spec?.podSelector?.matchLabels || {}).map(([k, v]) => `${k}=${v}`).join(', ') || '(all pods)',
        types: (o.spec?.policyTypes || []).join(', '),
      },
    }),
  },
  horizontalpodautoscaler: {
    kind: 'HorizontalPodAutoscaler', group: 'autoscaling', version: 'v2', plural: 'horizontalpodautoscalers', namespaced: true,
    columns: [{ key: 'target', label: 'Target' }, { key: 'replicas', label: 'Replicas' }, { key: 'range', label: 'Min–max' }],
    row: (o) => ({
      status: 'Active',
      tone: 'ok',
      cols: { target: `${o.spec?.scaleTargetRef?.kind}/${o.spec?.scaleTargetRef?.name}`, replicas: n(o.status?.currentReplicas), range: `${o.spec?.minReplicas ?? 1}–${o.spec?.maxReplicas}` },
    }),
  },
  node: {
    kind: 'Node', group: '', version: 'v1', plural: 'nodes', namespaced: false,
    columns: [{ key: 'roles', label: 'Roles' }, { key: 'version', label: 'Version' }, { key: 'cpu', label: 'CPU' }, { key: 'memory', label: 'Memory' }, { key: 'os', label: 'OS' }],
    row: (o) => {
      const ready = o.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True';
      return {
        status: ready ? (o.spec?.unschedulable ? 'Ready, cordoned' : 'Ready') : 'NotReady',
        tone: ready ? (o.spec?.unschedulable ? 'warn' : 'ok') : 'bad',
        cols: {
          roles: Object.keys(o.metadata?.labels || {}).filter((l) => l.startsWith('node-role.kubernetes.io/')).map((l) => l.split('/')[1]).join(', ') || 'worker',
          version: o.status?.nodeInfo?.kubeletVersion || '',
          cpu: o.status?.allocatable?.cpu || '',
          memory: o.status?.allocatable?.memory || '',
          os: o.status?.nodeInfo?.osImage || '',
        },
      };
    },
  },
  namespace: {
    kind: 'Namespace', group: '', version: 'v1', plural: 'namespaces', namespaced: false,
    columns: [],
    row: (o) => ({ status: o.status?.phase || 'Active', tone: o.status?.phase === 'Terminating' ? 'warn' : 'ok', cols: {} }),
  },
};

export const apiVersionOf = (d: KindDef) => (d.group ? `${d.group}/${d.version}` : d.version);

export const collectionPath = (d: KindDef, namespace?: string) => {
  const base = d.group ? `/apis/${d.group}/${d.version}` : `/api/${d.version}`;
  return d.namespaced && namespace && namespace !== 'all' ? `${base}/namespaces/${encodeURIComponent(namespace)}/${d.plural}` : `${base}/${d.plural}`;
};

export const listKind = async (kc: k8s.KubeConfig, d: KindDef, namespace: string) => {
  const data: any = await kubeRequest(kc, collectionPath(d, namespace), { timeoutMs: 20000 });
  return (data.items || []) as any[];
};

export const readObject = async (kc: k8s.KubeConfig, d: KindDef, namespace: string, name: string) =>
  kubeRequest<any>(kc, `${collectionPath(d, d.namespaced ? namespace : undefined)}/${encodeURIComponent(name)}`, { timeoutMs: 20000 });

// Secret values never leave the server.
export const redact = (o: any) => {
  if (o?.kind === 'Secret') {
    for (const field of ['data', 'stringData']) {
      if (o[field]) for (const k of Object.keys(o[field])) o[field][k] = `<redacted: ${String(o[field][k]).length} chars>`;
    }
    if (o.metadata?.annotations?.['kubectl.kubernetes.io/last-applied-configuration']) {
      o.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'] = '<redacted>';
    }
  }
  if (o?.metadata?.managedFields) delete o.metadata.managedFields;
  return o;
};
