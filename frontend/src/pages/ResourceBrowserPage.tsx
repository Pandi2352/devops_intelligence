import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronRight, Info, RefreshCw, ScrollText, Search } from 'lucide-react';
import { Dropdown, DropdownOption } from '../components/common/Dropdown';
import { Pagination } from '../components/common/Pagination';
import { usePagination } from '../hooks/usePagination';
import { PodDetailsModal, StatusPill } from '../components/observability/PodDetailsModal';
import { ResourceDetailsModal } from '../components/observability/ResourceDetailsModal';
import { NamespaceInfo, PodInfo, ResourceList, Scopes, observabilityApi } from '../api/observabilityApi';
import { getApiErrorMessage } from '../api/client';
import { formatRelativeTime } from '../utils/format';
import { TONE_CLASS, formatBytes, formatCores, podTone } from '../utils/observability';
import { sortEnvironments } from '../utils/project';

const GROUPS: { title: string; kinds: [string, string][] }[] = [
  { title: 'Cluster', kinds: [['node', 'Nodes'], ['namespace', 'Namespaces']] },
  {
    title: 'Workloads',
    kinds: [['pod', 'Pods'], ['deployment', 'Deployments'], ['statefulset', 'StatefulSets'], ['daemonset', 'DaemonSets'], ['replicaset', 'ReplicaSets'], ['job', 'Jobs'], ['cronjob', 'CronJobs'], ['horizontalpodautoscaler', 'Autoscalers (HPA)']],
  },
  { title: 'Config & Storage', kinds: [['configmap', 'ConfigMaps'], ['secret', 'Secrets'], ['persistentvolumeclaim', 'PersistentVolumeClaims'], ['storageclass', 'StorageClasses']] },
  { title: 'Networking', kinds: [['service', 'Services'], ['ingress', 'Ingresses'], ['endpoints', 'Endpoints'], ['networkpolicy', 'NetworkPolicies']] },
];
const CLUSTER_SCOPED = ['node', 'namespace', 'storageclass'];
const KIND_LABEL = Object.fromEntries(GROUPS.flatMap((g) => g.kinds));

type SortDir = 1 | -1;

const Th: React.FC<{ label: string; sortKey: string; sort: { key: string; dir: SortDir }; onSort: (k: string) => void; className?: string }> = ({
  label,
  sortKey,
  sort,
  onSort,
  className = '',
}) => (
  <th className={`py-2.5 px-3 ${className}`} aria-sort={sort.key === sortKey ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
    <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 uppercase hover:text-slate-800">
      {label}
      <span className="text-slate-300">{sort.key === sortKey ? (sort.dir === 1 ? '↑' : '↓') : '↕'}</span>
    </button>
  </th>
);

const EnvChip: React.FC<{ project?: string; environment?: string; projectId?: string }> = ({ project, environment, projectId }) =>
  project ? (
    <Link to={`/projects/${projectId}`} onClick={(e) => e.stopPropagation()} className="ml-1.5 px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-[10px] font-semibold text-sky-800 hover:bg-sky-100">
      {project} · {environment}
    </Link>
  ) : null;

export const ResourceBrowserPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const kind = params.get('kind') || 'pod';
  const namespace = params.get('namespace') || 'all';
  const query = params.get('q') || '';
  const onlyProblems = params.get('problems') === '1';

  const [scopes, setScopes] = useState<Scopes | null>(null);
  const [namespaces, setNamespaces] = useState<NamespaceInfo[]>([]);
  const [pods, setPods] = useState<PodInfo[]>([]);
  const [list, setList] = useState<ResourceList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jump, setJump] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: 'name', dir: 1 });
  const [podDetails, setPodDetails] = useState<{ name: string; namespace: string; tab?: 'overview' | 'logs' } | null>(null);
  const [resourceDetails, setResourceDetails] = useState<{ name: string; namespace: string } | null>(null);

  const cluster = params.get('cluster') || scopes?.clusters.find((c) => c.isDefault)?.name || scopes?.clusters[0]?.name || '';

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
    observabilityApi.scopes().then(setScopes).catch((err) => setError(getApiErrorMessage(err, 'Could not load clusters')));
  }, []);

  useEffect(() => {
    if (!cluster) return;
    observabilityApi
      .namespaces(cluster)
      .then((r) => setNamespaces(r.namespaces))
      .catch(() => setNamespaces([]));
  }, [cluster]);

  const load = useCallback(async () => {
    if (!cluster) return;
    setLoading(true);
    try {
      if (kind === 'pod') {
        const r = await observabilityApi.pods(namespace, cluster);
        setPods(r.pods);
        setList(null);
      } else {
        setList(await observabilityApi.resources(kind, CLUSTER_SCOPED.includes(kind) ? 'all' : namespace, cluster));
      }
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, `Could not list ${KIND_LABEL[kind] || kind}`));
    } finally {
      setLoading(false);
    }
  }, [cluster, kind, namespace]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  const onSort = (key: string) => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as SortDir) : 1 }));
  const needle = query.toLowerCase();

  const podRows = useMemo(() => {
    const rows = pods.filter(
      (p) =>
        (!needle || `${p.name} ${p.namespace} ${p.project || ''} ${p.environment || ''} ${p.node} ${p.status}`.toLowerCase().includes(needle)) &&
        (!onlyProblems || podTone(p.status, p.readyCount === p.containerCount) !== 'ok' || p.problem)
    );
    const val = (p: PodInfo): string | number =>
      sort.key === 'restarts' ? p.restarts : sort.key === 'cpu' ? p.usage?.cpuCores ?? -1 : sort.key === 'memory' ? p.usage?.memoryBytes ?? -1 : sort.key === 'age' ? p.createdAt || '' : sort.key === 'namespace' ? p.namespace : sort.key === 'status' ? p.status : p.name;
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
  }, [pods, needle, onlyProblems, sort]);

  const resourceRows = useMemo(() => {
    const rows = (list?.rows || []).filter(
      (r) =>
        (!needle || `${r.name} ${r.namespace} ${r.project || ''} ${Object.values(r.cols).join(' ')}`.toLowerCase().includes(needle)) &&
        (!onlyProblems || r.tone === 'bad' || r.tone === 'warn')
    );
    const val = (r: (typeof rows)[number]) => (sort.key === 'age' ? r.createdAt || '' : sort.key === 'namespace' ? r.namespace : sort.key === 'status' ? r.status : sort.key in r.cols ? r.cols[sort.key] : r.name);
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
  }, [list, needle, onlyProblems, sort]);

  // Paged after filtering and sorting; a new kind, namespace, search or filter starts at page 1 (auto-refresh keeps the page).
  const pageKey = `${cluster}|${kind}|${namespace}|${query}|${onlyProblems}`;
  const podPager = usePagination(podRows, 20, pageKey);
  const resourcePager = usePagination(resourceRows, 20, pageKey);

  const podStats = useMemo(() => {
    const bad = pods.filter((p) => podTone(p.status, p.readyCount === p.containerCount) === 'bad' || p.problem).length;
    return { total: pods.length, running: pods.filter((p) => p.status === 'Running').length, bad, restarts: pods.reduce((n, p) => n + p.restarts, 0) };
  }, [pods]);

  const envOptions: DropdownOption[] = [
    { value: '', label: 'Any project environment' },
    ...(scopes?.projects || []).flatMap((p) => sortEnvironments(p.environments, (e) => e.name).map((e) => ({ value: e.namespace, label: `${p.name} · ${e.name}`, sublabel: e.namespace }))),
  ];
  const nsOptions: DropdownOption[] = [
    { value: 'all', label: 'All namespaces' },
    ...namespaces.map((n) => ({ value: n.name, label: n.name, sublabel: n.project ? `${n.project} · ${n.environment}` : undefined })),
  ];
  const isClusterScoped = CLUSTER_SCOPED.includes(kind);
  const count = kind === 'pod' ? podRows.length : resourceRows.length;

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)] -m-5 bg-white border border-slate-200 rounded-md overflow-hidden text-xs">
      {/* top bar */}
      <div className="px-4 py-2 border-b border-slate-200 flex flex-wrap items-center gap-2 shrink-0">
        <span className="text-slate-500 font-medium">Resource Browser</span>
        <span className="text-slate-300">/</span>
        <Dropdown<string>
          ariaLabel="Cluster"
          size="sm"
          mono
          value={cluster}
          onChange={(c) => update({ cluster: c, namespace: null })}
          options={(scopes?.clusters || []).map((c) => ({ value: c.name, label: c.name, sublabel: c.status }))}
          placeholder={scopes ? 'No clusters connected' : 'Loading clusters…'}
          buttonClassName="font-bold min-w-[130px]"
        />
        <div className="flex-1" />
        <Dropdown<string>
          ariaLabel="Project environment"
          size="sm"
          value={namespaces.some((n) => n.name === namespace && n.project) ? namespace : ''}
          onChange={(ns) => update({ namespace: ns || null })}
          options={envOptions}
          placeholder="Any project environment"
          searchPlaceholder="Search project or environment"
          searchable
          menuMinWidth={260}
        />
        <Dropdown<string>
          ariaLabel="Namespace"
          size="sm"
          mono
          align="right"
          value={namespace}
          onChange={(ns) => update({ namespace: ns === 'all' ? null : ns })}
          options={nsOptions}
          placeholder="All namespaces"
          searchPlaceholder="Search namespaces"
          searchable
          disabled={isClusterScoped}
          menuMinWidth={280}
          buttonClassName="min-w-[170px]"
        />
        <label className="inline-flex items-center gap-1.5 text-slate-600 px-2">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto-refresh
        </label>
        <button onClick={load} className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md border border-slate-200" title="Refresh" aria-label="Refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* kinds */}
        <nav className="w-52 border-r border-slate-200 bg-slate-50/50 p-2.5 space-y-2 overflow-y-auto shrink-0" aria-label="Resource kinds">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2 text-slate-400" aria-hidden />
            <input
              placeholder="Jump to kind (e.g. Services)"
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              onKeyDown={(e) => {
                const hit = GROUPS.flatMap((g) => g.kinds).find(([, l]) => l.toLowerCase().includes(jump.toLowerCase()));
                if (e.key === 'Enter' && hit) {
                  update({ kind: hit[0] === 'pod' ? null : hit[0] });
                  setJump('');
                }
              }}
              aria-label="Jump to kind"
              className="w-full pl-7 pr-2 py-1 bg-white border border-slate-200 rounded-md text-[11px] focus:outline-none focus:border-sky-500"
            />
          </div>
          {GROUPS.map((g) => {
            const kinds = g.kinds.filter(([, label]) => !jump || label.toLowerCase().includes(jump.toLowerCase()));
            if (!kinds.length) return null;
            const open = !collapsed[g.title] || Boolean(jump);
            return (
              <div key={g.title}>
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [g.title]: !c[g.title] }))}
                  className="w-full flex items-center justify-between px-2 py-1 text-[11px] font-bold text-slate-700 uppercase tracking-wider hover:bg-slate-100 rounded-md"
                  aria-expanded={open}
                >
                  {g.title}
                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                {open && (
                  <div className="pl-2 mt-0.5 space-y-0.5 border-l-2 border-slate-200 ml-2">
                    {kinds.map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          update({ kind: key === 'pod' ? null : key });
                          setSort({ key: 'name', dir: 1 });
                        }}
                        className={`w-full text-left px-2 py-1 rounded-md ${kind === key ? 'bg-sky-100 text-sky-800 font-bold' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* table */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="p-3 border-b border-slate-200 flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-xs">
              <Search size={14} className="absolute left-2.5 top-2 text-slate-400" aria-hidden />
              <input
                placeholder={kind === 'pod' ? 'Search pods, namespaces, nodes or status' : `Search ${KIND_LABEL[kind] || kind} by name, namespace or value`}
                value={query}
                onChange={(e) => update({ q: e.target.value || null })}
                aria-label="Search"
                className="w-full pl-8 pr-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-sky-500"
              />
            </div>
            <label className="inline-flex items-center gap-1.5 text-slate-600">
              <input type="checkbox" checked={onlyProblems} onChange={(e) => update({ problems: e.target.checked ? '1' : null })} />
              Only unhealthy
            </label>
            {kind === 'pod' && (
              <div className="flex flex-wrap gap-3 text-[11px] text-slate-500 ml-auto">
                <span>
                  <strong className="text-slate-800">{podStats.total}</strong> pods
                </span>
                <span>
                  <strong className="text-emerald-700">{podStats.running}</strong> running
                </span>
                {podStats.bad > 0 && (
                  <button type="button" onClick={() => update({ problems: '1' })} className="text-rose-700 font-semibold hover:underline">
                    {podStats.bad} need attention
                  </button>
                )}
                <span>{podStats.restarts} restarts</span>
              </div>
            )}
            {kind !== 'pod' && <span className="ml-auto text-[11px] text-slate-500">{count} {KIND_LABEL[kind]}</span>}
          </div>

          {error && (
            <div className="m-3 p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-2" role="alert">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
          {list?.message && <div className="m-3 p-2.5 rounded-md bg-slate-50 border border-slate-200 text-slate-600">{list.message}</div>}

          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[10px] tracking-wider z-10">
                {kind === 'pod' ? (
                  <tr>
                    <Th label="Name" sortKey="name" sort={sort} onSort={onSort} />
                    <Th label="Namespace" sortKey="namespace" sort={sort} onSort={onSort} />
                    <th className="py-2.5 px-3 uppercase">Ready</th>
                    <Th label="Status" sortKey="status" sort={sort} onSort={onSort} />
                    <Th label="Restarts" sortKey="restarts" sort={sort} onSort={onSort} />
                    <Th label="CPU" sortKey="cpu" sort={sort} onSort={onSort} />
                    <Th label="Memory" sortKey="memory" sort={sort} onSort={onSort} />
                    <Th label="Age" sortKey="age" sort={sort} onSort={onSort} />
                    <th className="py-2.5 px-3 uppercase text-right">Actions</th>
                  </tr>
                ) : (
                  <tr>
                    <Th label="Name" sortKey="name" sort={sort} onSort={onSort} />
                    {!isClusterScoped && <Th label="Namespace" sortKey="namespace" sort={sort} onSort={onSort} />}
                    <Th label="Status" sortKey="status" sort={sort} onSort={onSort} />
                    {(list?.columns || []).map((c) => (
                      <Th key={c.key} label={c.label} sortKey={c.key} sort={sort} onSort={onSort} />
                    ))}
                    <Th label="Age" sortKey="age" sort={sort} onSort={onSort} />
                  </tr>
                )}
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && !count ? (
                  <tr>
                    <td colSpan={12} className="py-12 text-center text-slate-400">
                      Loading {KIND_LABEL[kind]} from {cluster}…
                    </td>
                  </tr>
                ) : !count ? (
                  <tr>
                    <td colSpan={12} className="py-12 text-center text-slate-400">
                      No {KIND_LABEL[kind]} {onlyProblems || query ? 'match the filters' : namespace !== 'all' && !isClusterScoped ? `in ${namespace}` : 'found'}.
                    </td>
                  </tr>
                ) : kind === 'pod' ? (
                  podPager.pageItems.map((p) => (
                    <tr key={`${p.namespace}/${p.name}`} onClick={() => setPodDetails({ name: p.name, namespace: p.namespace })} className="hover:bg-sky-50/50 cursor-pointer align-top">
                      <td className="py-2 px-3">
                        <div className="font-bold text-sky-700 font-mono">{p.name}</div>
                        {p.problem && <div className="text-[11px] text-rose-700 mt-0.5 max-w-md">{p.problem}</div>}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">
                        {p.namespace}
                        <EnvChip project={p.project} environment={p.environment} projectId={p.projectId} />
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-600">{p.ready}</td>
                      <td className="py-2 px-3">
                        <StatusPill status={p.status} ready={p.readyCount === p.containerCount} />
                      </td>
                      <td className="py-2 px-3 font-mono">
                        <span className={p.restarts ? 'text-amber-700 font-semibold' : 'text-slate-500'}>{p.restarts}</span>
                        {p.lastRestartAt && <div className="text-[10px] text-slate-400">{formatRelativeTime(p.lastRestartAt)}</div>}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-600">{p.usage ? formatCores(p.usage.cpuCores) : '—'}</td>
                      <td className="py-2 px-3 font-mono text-slate-600">{p.usage ? formatBytes(p.usage.memoryBytes) : '—'}</td>
                      <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{formatRelativeTime(p.createdAt)}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPodDetails({ name: p.name, namespace: p.namespace, tab: 'logs' });
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-sky-700 hover:bg-sky-100"
                        >
                          <ScrollText size={12} /> Logs
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPodDetails({ name: p.name, namespace: p.namespace });
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-slate-600 hover:bg-slate-100"
                        >
                          <Info size={12} /> Details
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  resourcePager.pageItems.map((r) => (
                    <tr key={`${r.namespace}/${r.name}`} onClick={() => setResourceDetails({ name: r.name, namespace: r.namespace })} className="hover:bg-sky-50/50 cursor-pointer">
                      <td className="py-2 px-3 font-bold text-sky-700 font-mono">
                        {r.name}
                        {kind === 'namespace' && <EnvChip project={r.project} environment={r.environment} projectId={r.projectId} />}
                      </td>
                      {!isClusterScoped && (
                        <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">
                          {r.namespace}
                          <EnvChip project={r.project} environment={r.environment} projectId={r.projectId} />
                        </td>
                      )}
                      <td className="py-2 px-3">
                        <span className={`inline-flex px-1.5 py-0.5 rounded border text-[11px] font-semibold ${TONE_CLASS[r.tone]}`}>{r.status}</span>
                      </td>
                      {(list?.columns || []).map((c) => (
                        <td key={c.key} className="py-2 px-3 font-mono text-slate-600 max-w-xs truncate" title={String(r.cols[c.key] ?? '')}>
                          {c.key === 'lastRun' && r.cols[c.key] ? formatRelativeTime(String(r.cols[c.key])) : String(r.cols[c.key] ?? '')}
                        </td>
                      ))}
                      <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{formatRelativeTime(r.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {count > 0 && (
            <div className="px-3 py-2 border-t border-slate-200 bg-white shrink-0">
              {kind === 'pod' ? (
                <Pagination
                  page={podPager.page}
                  pageSize={podPager.pageSize}
                  total={podPager.total}
                  onPageChange={podPager.setPage}
                  onPageSizeChange={podPager.setPageSize}
                  pageSizeOptions={[20, 50, 100]}
                  itemLabel="pods"
                />
              ) : (
                <Pagination
                  page={resourcePager.page}
                  pageSize={resourcePager.pageSize}
                  total={resourcePager.total}
                  onPageChange={resourcePager.setPage}
                  onPageSizeChange={resourcePager.setPageSize}
                  pageSizeOptions={[20, 50, 100]}
                  itemLabel={(KIND_LABEL[kind] || kind).toLowerCase()}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {podDetails && (
        <PodDetailsModal cluster={cluster} namespace={podDetails.namespace} pod={podDetails.name} initialTab={podDetails.tab} onClose={() => setPodDetails(null)} />
      )}
      {resourceDetails && (
        <ResourceDetailsModal
          cluster={cluster}
          kindKey={kind}
          namespace={resourceDetails.namespace}
          name={resourceDetails.name}
          onClose={() => setResourceDetails(null)}
          onOpenPod={(pod, ns) => {
            setResourceDetails(null);
            setPodDetails({ name: pod, namespace: ns });
          }}
        />
      )}
    </div>
  );
};
