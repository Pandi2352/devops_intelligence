import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Info, Loader2, PlugZap, RefreshCw, RotateCw, Settings, Workflow, Zap } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Button } from '../components/common/Button';
import { Dropdown } from '../components/common/Dropdown';
import { DataTable, DataColumn } from '../components/common/DataTable';
import { ListToolbar } from '../components/common/ListToolbar';
import { Pagination } from '../components/common/Pagination';
import { EmptyState } from '../components/common/EmptyState';
import { HealthPill, OperationPill, SyncPill } from '../components/argocd/ArgoStatus';
import { clusterLabel, repoShortName } from '../utils/argo';
import { SyncDialog } from '../components/argocd/SyncDialog';
import { AppDetailsModal } from '../components/argocd/AppDetailsModal';
import { argoApi } from '../api/argoApi';
import { argoAppsApi, ArgoAppSummary, ArgoSyncOptions } from '../api/argoAppsApi';
import { getApiErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useListQuery, SortOption } from '../hooks/useListQuery';
import { ArgoIntegration } from '../types';
import { formatDateTime, formatRelativeTime } from '../utils/format';

const POLL_MS = 5000;

// One status per app for filtering and the summary tiles. Order matters: the first match wins.
const appState = (a: ArgoAppSummary) => {
  if (a.operation?.phase === 'Running') return 'syncing';
  if (a.conditions.some((c) => /Error/.test(c.type))) return 'error';
  if (a.health.status === 'Degraded' || a.health.status === 'Missing') return 'degraded';
  if (a.sync.status === 'OutOfSync') return 'outofsync';
  if (a.health.status === 'Progressing') return 'progressing';
  if (a.sync.status === 'Synced' && a.health.status === 'Healthy') return 'healthy';
  return 'unknown';
};

const STATUS_OPTIONS = [
  { value: 'healthy', label: 'Synced & healthy' },
  { value: 'outofsync', label: 'Out of sync' },
  { value: 'progressing', label: 'Progressing' },
  { value: 'syncing', label: 'Syncing now' },
  { value: 'degraded', label: 'Degraded / missing' },
  { value: 'error', label: 'Errors' },
  { value: 'unknown', label: 'Unknown' },
];

const SORT_OPTIONS: SortOption<ArgoAppSummary>[] = [
  { value: 'name', label: 'Name A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
  { value: 'recent', label: 'Last synced', compare: (a, b) => String(b.lastSync?.at || '').localeCompare(String(a.lastSync?.at || '')) },
  { value: 'attention', label: 'Needs attention first', compare: (a, b) => severity(b) - severity(a) || a.name.localeCompare(b.name) },
];

function severity(a: ArgoAppSummary) {
  return { error: 6, degraded: 5, syncing: 4, outofsync: 3, progressing: 2, unknown: 1, healthy: 0 }[appState(a)] ?? 0;
}

interface StatTileProps {
  label: string;
  value: number;
  tone: string;
  active: boolean;
  onClick: () => void;
}

const StatTile: React.FC<StatTileProps> = ({ label, value, tone, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`text-left p-3 rounded-md border bg-white cursor-pointer transition-colors ${active ? 'border-sky-500 ring-1 ring-sky-500' : 'border-slate-200 hover:border-slate-300'}`}
  >
    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
    <div className={`text-xl font-bold ${tone}`}>{value}</div>
  </button>
);

export const ArgoPage: React.FC = () => {
  const { hasRole } = useAuth();
  const toast = useToast();
  const canManage = hasRole(['superadmin', 'devops']);
  const [searchParams, setSearchParams] = useSearchParams();

  const [integration, setIntegration] = useState<ArgoIntegration | null>(null);
  const [apps, setApps] = useState<ArgoAppSummary[] | null>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [syncTarget, setSyncTarget] = useState<ArgoAppSummary | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const detailsName = searchParams.get('app');
  const kubeProject = searchParams.get('kproject') || '';

  const loadApps = useCallback(async (quiet = false) => {
    if (!quiet) setIsLoading(true);
    try {
      const res = await argoAppsApi.list();
      setApps(res.apps);
      setServerUrl(res.serverUrl);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not reach ArgoCD'));
      setApps((prev) => prev ?? []);
    } finally {
      if (!quiet) setIsLoading(false);
    }
  }, []);

  const testConnection = useCallback(async () => {
    setIsTesting(true);
    try {
      setIntegration(await argoApi.getStatus());
    } catch {
      setIntegration(null);
    } finally {
      setIsTesting(false);
    }
  }, []);

  useEffect(() => {
    loadApps();
    testConnection();
  }, [loadApps, testConnection]);

  const busy = useMemo(() => (apps || []).some((a) => a.operation?.phase === 'Running' || a.health.status === 'Progressing'), [apps]);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => loadApps(true), POLL_MS);
    return () => clearInterval(timer);
  }, [busy, loadApps]);

  const kubeProjects = useMemo(
    () => Array.from(new Set((apps || []).map((a) => a.kubeorbit?.project).filter(Boolean) as string[])).sort(),
    [apps]
  );
  const scoped = useMemo(
    () => (apps || []).filter((a) => !kubeProject || (kubeProject === '__none' ? !a.kubeorbit : a.kubeorbit?.project === kubeProject)),
    [apps, kubeProject]
  );

  const list = useListQuery(scoped, {
    searchText: (a) => `${a.name} ${a.project} ${a.source.repoURL} ${a.source.path} ${a.destination.namespace} ${a.kubeorbit?.project || ''}`,
    status: appState,
    sortOptions: SORT_OPTIONS,
    syncWithUrl: true,
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of scoped) c[appState(a)] = (c[appState(a)] || 0) + 1;
    return c;
  }, [scoped]);
  const errored = scoped.filter((a) => appState(a) === 'error');

  const openDetails = (name: string | null) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (name) next.set('app', name);
        else next.delete('app');
        return next;
      },
      { replace: true }
    );

  const setKubeProject = (value: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set('kproject', value);
        else next.delete('kproject');
        next.delete('page');
        return next;
      },
      { replace: true }
    );

  const runSync = async (options: ArgoSyncOptions) => {
    if (!syncTarget) return;
    setIsSyncing(true);
    try {
      toast.success((await argoAppsApi.sync(syncTarget.name, options)).message);
      setSyncTarget(null);
      await loadApps(true);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Sync failed'));
    } finally {
      setIsSyncing(false);
    }
  };

  const refreshApp = async (name: string) => {
    setRefreshing(name);
    try {
      await argoAppsApi.refresh(name, false);
      await loadApps(true);
      toast.info(`${name} refreshed from Git`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Refresh failed'));
    } finally {
      setRefreshing(null);
    }
  };

  const connected = integration?.status === 'Connected';

  const columns: DataColumn<ArgoAppSummary>[] = [
    {
      key: 'app',
      header: 'Application',
      render: (a) => (
        <div className="min-w-[180px]">
          <button type="button" onClick={() => openDetails(a.name)} className="font-mono font-semibold text-slate-900 hover:text-sky-700 hover:underline text-left cursor-pointer">
            {a.name}
          </button>
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5 text-[10px]">
            <span className="text-slate-500">{a.project}</span>
            {a.kubeorbit && (
              <Link
                to={`/environments?project=${a.kubeorbit.projectId}`}
                className="px-1.5 rounded bg-sky-50 border border-sky-200 text-sky-800 hover:underline"
                title="Open in Environments"
              >
                {a.kubeorbit.project}
                {a.kubeorbit.environment && ` · ${a.kubeorbit.environment}`}
              </Link>
            )}
          </div>
          {a.conditions.length > 0 && (
            <p className="mt-1 flex gap-1 text-[11px] text-rose-700 max-w-[320px]" title={a.conditions.map((c) => `${c.type}: ${c.message}`).join('\n')}>
              <AlertTriangle size={12} className="shrink-0 mt-px" aria-hidden />
              <span className="line-clamp-2">
                {a.conditions[0].type}: {a.conditions[0].message}
              </span>
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      render: (a) => (
        <div className="min-w-[180px] max-w-[260px]">
          <a href={a.source.repoURL.replace(/\.git$/, '')} target="_blank" rel="noreferrer" className="block font-mono text-[11px] text-sky-700 hover:underline truncate" title={a.source.repoURL}>
            {repoShortName(a.source.repoURL)}
          </a>
          <div className="text-[11px] text-slate-600 truncate" title={`${a.source.path || a.source.chart} @ ${a.source.targetRevision}`}>
            <span className="font-mono">{a.source.path || a.source.chart || '/'}</span> @ <span className="font-mono">{a.source.targetRevision}</span>
          </div>
          {a.sourceType && <span className="text-[10px] text-slate-400">{a.sourceType}</span>}
        </div>
      ),
    },
    {
      key: 'dest',
      header: 'Destination',
      render: (a) => (
        <div className="min-w-[140px]">
          <div className="font-mono text-[11px] text-slate-800">{a.destination.namespace || '–'}</div>
          <div className="text-[10px] text-slate-500">{clusterLabel(a.destination.server, a.destination.name)}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (a) => (
        <div className="space-y-1 min-w-[150px]">
          <div className="flex items-center gap-1 flex-wrap">
            <SyncPill status={a.sync.status} />
            <HealthPill status={a.health.status} message={a.health.message} />
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
            {a.operation && <OperationPill phase={a.operation.phase} />}
            {a.sync.revision && <span className="font-mono">{a.sync.revision}</span>}
            <span className="inline-flex items-center gap-0.5" title={a.autoSync.enabled ? `Auto-sync${a.autoSync.prune ? ', prune' : ''}${a.autoSync.selfHeal ? ', self-heal' : ''}` : 'Manual sync'}>
              {a.autoSync.enabled && <Zap size={10} className="text-amber-500" aria-hidden />}
              {a.autoSync.enabled ? 'auto' : 'manual'}
            </span>
            {a.resourceCounts.outOfSync > 0 && <span className="text-amber-700">{a.resourceCounts.outOfSync} drifted</span>}
          </div>
        </div>
      ),
    },
    {
      key: 'last',
      header: 'Last sync',
      render: (a) =>
        a.lastSync ? (
          <div className="min-w-[100px]" title={formatDateTime(a.lastSync.at)}>
            <div className="text-xs text-slate-800">{formatRelativeTime(a.lastSync.at)}</div>
            <div className="text-[10px] text-slate-500">{a.lastSync.by || 'unknown'}</div>
          </div>
        ) : (
          <span className="text-[11px] text-slate-400">never</span>
        ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      headerClassName: 'text-right',
      className: 'text-right',
      render: (a) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => openDetails(a.name)}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:text-sky-700 hover:bg-sky-50 cursor-pointer"
            aria-label={`Details of ${a.name}`}
            title="Details"
          >
            <Info size={14} />
          </button>
          <button
            type="button"
            onClick={() => refreshApp(a.name)}
            disabled={refreshing === a.name}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:text-sky-700 hover:bg-sky-50 cursor-pointer disabled:opacity-50"
            aria-label={`Refresh ${a.name}`}
            title="Refresh from Git"
          >
            <RefreshCw size={14} className={refreshing === a.name ? 'animate-spin' : ''} />
          </button>
          <a
            href={`${serverUrl}/applications/argocd/${a.name}`}
            target="_blank"
            rel="noreferrer"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:text-sky-700 hover:bg-sky-50"
            aria-label={`Open ${a.name} in ArgoCD`}
            title="Open in ArgoCD"
          >
            <ExternalLink size={13} />
          </a>
          {canManage && (
            <button
              type="button"
              onClick={() => setSyncTarget(a)}
              disabled={a.operation?.phase === 'Running'}
              className={`h-7 px-2.5 inline-flex items-center gap-1 rounded-md text-[11px] font-semibold cursor-pointer disabled:opacity-50 ${
                a.sync.status === 'OutOfSync' ? 'bg-sky-600 hover:bg-sky-700 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {a.operation?.phase === 'Running' ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />} Sync
            </button>
          )}
        </div>
      ),
    },
  ];

  const tiles = [
    { key: '', label: 'Applications', value: scoped.length, tone: 'text-slate-900' },
    { key: 'healthy', label: 'Synced & healthy', value: counts.healthy || 0, tone: 'text-emerald-700' },
    { key: 'outofsync', label: 'Out of sync', value: counts.outofsync || 0, tone: 'text-amber-700' },
    { key: 'syncing', label: 'Syncing / progressing', value: (counts.syncing || 0) + (counts.progressing || 0), tone: 'text-sky-700' },
    { key: 'degraded', label: 'Degraded', value: counts.degraded || 0, tone: 'text-rose-700' },
    { key: 'error', label: 'Errors', value: counts.error || 0, tone: 'text-rose-700' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="ArgoCD"
        description="Every GitOps application: where it comes from, where it deploys, whether the cluster matches Git, and what changed."
        actions={
          <Button variant="secondary" size="sm" className="h-8" onClick={() => loadApps()} isLoading={isLoading} leftIcon={<RefreshCw size={13} />}>
            Refresh
          </Button>
        }
      />

      <section aria-label="ArgoCD connection" className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 rounded-md border border-slate-200 bg-white">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center shrink-0">
            <Workflow size={18} aria-hidden />
          </div>
          <div className="min-w-0 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-900">{integration?.name || 'ArgoCD'}</span>
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${connected ? 'text-emerald-700' : 'text-rose-700'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-rose-500'}`} aria-hidden />
                {integration ? integration.status : 'Unknown'}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              <a href={integration?.serverUrl || serverUrl} target="_blank" rel="noreferrer" className="font-mono text-sky-700 hover:underline">
                {integration?.serverUrl || serverUrl || 'not configured'}
              </a>
              {integration?.version && integration.version !== 'unknown' && ` · ${integration.version}`}
              {integration?.authType === 'password' && integration.username && ` · signed in as ${integration.username}`}
              {integration?.lastPingAt && ` · checked ${formatRelativeTime(integration.lastPingAt).toLowerCase()}`}
            </div>
            {!connected && integration?.lastError && <div className="text-[11px] text-rose-700 break-words">{integration.lastError}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="secondary" size="sm" onClick={testConnection} isLoading={isTesting} leftIcon={<PlugZap size={13} />}>
            Test connection
          </Button>
          <Link to="/connectors?tab=argocd" className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            <Settings size={13} aria-hidden /> Manage connector
          </Link>
        </div>
      </section>

      {error && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3" role="alert">
          <span>{error}</span>
          <Button size="sm" variant="danger" onClick={() => loadApps()}>
            Retry
          </Button>
        </div>
      )}

      {apps && apps.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {tiles.map((t) => (
            <StatTile key={t.label} label={t.label} value={t.value} tone={t.tone} active={list.status === t.key && (t.key !== '' || !list.status)} onClick={() => list.setStatus(t.key)} />
          ))}
        </div>
      )}

      {errored.length > 0 && (
        <div className="p-3 rounded-md border border-rose-200 bg-rose-50 text-rose-900 text-xs space-y-1.5" role="alert">
          <div className="font-semibold flex items-center gap-1.5">
            <AlertTriangle size={14} aria-hidden /> {errored.length} application{errored.length === 1 ? '' : 's'} cannot be compared with Git
          </div>
          {errored.map((a) => (
            <div key={a.name} className="flex items-start justify-between gap-3">
              <span className="min-w-0 break-words">
                <span className="font-mono font-semibold">{a.name}</span>: {a.conditions[0]?.message}
              </span>
              <button type="button" onClick={() => openDetails(a.name)} className="shrink-0 text-rose-800 font-semibold underline cursor-pointer">
                View
              </button>
            </div>
          ))}
          {errored.some((a) => /authentication|Access denied|credentials/i.test(a.conditions.map((c) => c.message).join(' '))) && (
            <p className="text-[11px] text-rose-800">
              Git authentication failed: the repository credentials registered in ArgoCD are wrong or expired. Update them in ArgoCD (Settings → Repositories).
            </p>
          )}
        </div>
      )}

      {apps === null ? (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500">
          <Loader2 size={14} className="animate-spin" /> Asking ArgoCD for applications…
        </div>
      ) : apps.length === 0 && !error ? (
        <EmptyState
          icon={<Workflow size={24} />}
          title="No ArgoCD applications"
          description="Create an Application in ArgoCD (for example with kubectl apply -f argocd/<app>.yaml) and it appears here."
        />
      ) : (
        <div className="space-y-3">
          <ListToolbar
            query={list.query}
            onQueryChange={list.setQuery}
            searchPlaceholder="Search name, repo, path or namespace"
            statusOptions={STATUS_OPTIONS}
            status={list.status}
            onStatusChange={list.setStatus}
            sortOptions={SORT_OPTIONS}
            sort={list.sort}
            onSortChange={list.setSort}
            onRefresh={() => loadApps()}
            isRefreshing={isLoading}
            actions={
              kubeProjects.length > 0 && (
                <Dropdown<string>
                  ariaLabel="DevOps Intelligence project"
                  value={kubeProject}
                  onChange={setKubeProject}
                  align="right"
                  menuMinWidth={200}
                  buttonClassName="min-w-[160px]"
                  options={[
                    { value: '', label: 'All projects' },
                    ...kubeProjects.map((p) => ({ value: p, label: p })),
                    { value: '__none', label: 'Not in a DevOps Intelligence project' },
                  ]}
                />
              )
            }
          />
          <DataTable
            caption="ArgoCD applications"
            columns={columns}
            rows={list.pageItems}
            rowKey={(a) => a.name}
            isLoading={isLoading && apps.length === 0}
            empty={
              <div className="flex flex-col items-center gap-2 py-2 text-xs text-slate-500">
                No applications match your filters.
                <Button size="sm" variant="secondary" onClick={() => { list.clearFilters(); setKubeProject(''); }}>
                  Clear filters
                </Button>
              </div>
            }
            footer={
              <Pagination
                page={list.page}
                pageSize={list.pageSize}
                total={list.filteredCount}
                onPageChange={list.setPage}
                onPageSizeChange={list.setPageSize}
                itemLabel="applications"
              />
            }
          />
          {busy && (
            <p className="text-[11px] text-sky-700 flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" /> Updating every {POLL_MS / 1000}s while a sync is running
            </p>
          )}
        </div>
      )}

      {syncTarget && <SyncDialog app={syncTarget} isSyncing={isSyncing} onCancel={() => !isSyncing && setSyncTarget(null)} onConfirm={runSync} />}

      {detailsName && (
        <AppDetailsModal
          name={detailsName}
          canManage={canManage}
          onClose={() => openDetails(null)}
          onSync={(app) => setSyncTarget(app)}
          onChanged={() => loadApps(true)}
        />
      )}
    </div>
  );
};
