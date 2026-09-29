import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { NamespaceInfo, PodInfo, Scopes, observabilityApi } from '../api/observabilityApi';
import { getApiErrorMessage } from '../api/client';
import { sortEnvironments } from '../utils/project';

// Selection shared by the Logs and Metrics pages, kept in the URL:
//   ?cluster=minikube&project=<id>&env=dev&namespace=kubeorbit-demo-dev&target=wl:Deployment/demo-api&container=all
// target: "all" | "wl:<Kind>/<name>" (every pod of a workload) | "pod:<name>"
export function useObservabilityScope() {
  const [params, setParams] = useSearchParams();
  const [scopes, setScopes] = useState<Scopes | null>(null);
  const [namespaces, setNamespaces] = useState<NamespaceInfo[]>([]);
  const [pods, setPods] = useState<PodInfo[] | null>(null);
  const [metricsAvailable, setMetricsAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [podsLoading, setPodsLoading] = useState(false);

  const projectId = params.get('project') || '';
  const envName = params.get('env') || '';
  const target = params.get('target') || 'all';
  const container = params.get('container') || 'all';

  const project = scopes?.projects.find((p) => p.id === projectId) || null;
  const environment = project?.environments.find((e) => e.name === envName) || null;
  const defaultCluster = scopes?.clusters.find((c) => c.isDefault)?.name || scopes?.clusters[0]?.name || '';
  const cluster = params.get('cluster') || project?.cluster || defaultCluster;
  const namespace = environment?.namespace || params.get('namespace') || '';

  const update = useCallback(
    (patch: Record<string, string | null>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
          return next;
        },
        { replace: true }
      ),
    [setParams]
  );

  useEffect(() => {
    observabilityApi
      .scopes()
      .then(setScopes)
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load projects and clusters')));
  }, []);

  useEffect(() => {
    if (!cluster) return;
    observabilityApi
      .namespaces(cluster)
      .then((r) => setNamespaces(r.namespaces))
      .catch((err) => setError(getApiErrorMessage(err, 'Could not list namespaces')));
  }, [cluster]);

  const reloadPods = useCallback(async () => {
    if (!cluster || !namespace) {
      setPods(null);
      return;
    }
    setPodsLoading(true);
    try {
      const r = await observabilityApi.pods(namespace, cluster);
      setPods(r.pods);
      setMetricsAvailable(r.metricsAvailable);
      setError(null);
    } catch (err) {
      setPods([]);
      setError(getApiErrorMessage(err, 'Could not list pods'));
    } finally {
      setPodsLoading(false);
    }
  }, [cluster, namespace]);

  useEffect(() => {
    reloadPods();
  }, [reloadPods]);

  // Pods the current target resolves to (empty = all pods in the namespace).
  const selectedPods = useMemo(() => {
    if (!pods || target === 'all') return [];
    if (target.startsWith('pod:')) return [target.slice(4)];
    if (target.startsWith('wl:')) {
      const [kind, name] = target.slice(3).split('/');
      return pods.filter((p) => p.owner?.kind === kind && p.owner?.name === name).map((p) => p.name);
    }
    return [];
  }, [pods, target]);

  const workloads = useMemo(() => {
    const map = new Map<string, { kind: string; name: string; pods: number }>();
    for (const p of pods || []) {
      if (!p.owner) continue;
      const key = `${p.owner.kind}/${p.owner.name}`;
      const cur = map.get(key) || { ...p.owner, pods: 0 };
      cur.pods += 1;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [pods]);

  const containers = useMemo(() => {
    const names = new Set<string>();
    const within = selectedPods.length ? (pods || []).filter((p) => selectedPods.includes(p.name)) : pods || [];
    within.forEach((p) => p.containers.filter((c) => !c.init).forEach((c) => names.add(c.name)));
    return [...names];
  }, [pods, selectedPods]);

  const actions = {
    setCluster: (name: string) => update({ cluster: name, project: null, env: null, namespace: null, target: null, container: null }),
    setProject: (id: string) => {
      const p = scopes?.projects.find((x) => x.id === id);
      const first = p ? sortEnvironments(p.environments, (e) => e.name)[0] : undefined;
      update({ project: id || null, env: first?.name || null, cluster: p?.cluster || null, namespace: null, target: null, container: null });
    },
    setEnvironment: (name: string) => update({ env: name || null, namespace: null, target: null, container: null }),
    // Picking a namespace that belongs to a project environment selects that environment too.
    setNamespace: (ns: string) => {
      const owner = namespaces.find((n) => n.name === ns);
      const p = owner?.project ? scopes?.projects.find((x) => x.name === owner.project) : undefined;
      if (p && owner?.environment) update({ project: p.id, env: owner.environment, namespace: null, target: null, container: null });
      else update({ project: null, env: null, namespace: ns || null, target: null, container: null });
    },
    setTarget: (value: string) => update({ target: value === 'all' ? null : value, container: null }),
    setContainer: (value: string) => update({ container: value === 'all' ? null : value }),
    selectPod: (pod: string) => update({ target: `pod:${pod}`, container: null }),
  };

  return {
    scopes,
    cluster,
    project,
    environment,
    namespace,
    namespaces,
    pods,
    podsLoading,
    metricsAvailable,
    workloads,
    target,
    selectedPods,
    container,
    containers,
    error,
    reloadPods,
    ...actions,
  };
}

export type ObservabilityScope = ReturnType<typeof useObservabilityScope>;
