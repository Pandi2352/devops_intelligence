import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, OctagonX, RefreshCw, RotateCcw, RotateCw, Workflow } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Pagination } from '../common/Pagination';
import { usePagination } from '../../hooks/usePagination';
import { argoAppsApi, ArgoAppDetail, ArgoDiffItem, ArgoEvent, ArgoTreeNode } from '../../api/argoAppsApi';
import { getApiErrorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import { HealthPill, OperationPill, SyncPill } from './ArgoStatus';
import { clusterLabel, commitUrl, repoShortName } from '../../utils/argo';

type Tab = 'overview' | 'resources' | 'diff' | 'history' | 'events';

interface AppDetailsModalProps {
  name: string;
  canManage: boolean;
  onClose: () => void;
  onSync: (app: ArgoAppDetail) => void;
  onChanged: () => void;
}

const POLL_MS = 4000;

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2 py-1.5 border-b border-slate-100 last:border-b-0">
    <dt className="text-[11px] text-slate-500">{label}</dt>
    <dd className="text-xs text-slate-800 min-w-0 break-words">{children}</dd>
  </div>
);

const Loading: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500">
    <Loader2 size={14} className="animate-spin" /> {label}
  </div>
);

const ErrorBox: React.FC<{ message: string }> = ({ message }) => (
  <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs">{message}</div>
);

// ---------------------------------------------------------------- Resources (tree)
const HEALTH_DOT: Record<string, string> = {
  Healthy: 'bg-emerald-500',
  Progressing: 'bg-sky-500',
  Degraded: 'bg-rose-500',
  Suspended: 'bg-slate-400',
  Missing: 'bg-slate-300',
};

const ResourceTree: React.FC<{ name: string; app: ArgoAppDetail }> = ({ name, app }) => {
  const [nodes, setNodes] = useState<ArgoTreeNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    argoAppsApi
      .tree(name)
      .then(setNodes)
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load the resource tree')));
  }, [name]);

  const syncStatus = useMemo(() => new Map(app.resources.map((r) => [`${r.kind}/${r.name}`, r.status])), [app.resources]);

  if (error) return <ErrorBox message={error} />;
  if (!nodes) return <Loading label="Loading resource tree…" />;
  if (nodes.length === 0) return <p className="text-xs text-slate-500 py-6 text-center">ArgoCD manages no live resources for this app.</p>;

  const byUid = new Map(nodes.map((n) => [n.uid, n]));
  const children = new Map<string, ArgoTreeNode[]>();
  const roots: ArgoTreeNode[] = [];
  for (const n of nodes) {
    const parent = n.parents.find((p) => byUid.has(p));
    if (parent) children.set(parent, [...(children.get(parent) || []), n]);
    else roots.push(n);
  }
  const order = ['Namespace', 'ConfigMap', 'Secret', 'Service', 'Deployment', 'StatefulSet', 'DaemonSet', 'Ingress', 'PodDisruptionBudget'];
  roots.sort((a, b) => (order.indexOf(a.kind) + 1 || 99) - (order.indexOf(b.kind) + 1 || 99) || a.name.localeCompare(b.name));

  const render = (node: ArgoTreeNode, depth: number): React.ReactNode => {
    const kids = (children.get(node.uid) || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const sync = syncStatus.get(`${node.kind}/${node.name}`);
    return (
      <li key={node.uid}>
        <div className="flex items-start gap-2 py-1.5 border-b border-slate-100" style={{ paddingLeft: depth * 18 }}>
          <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${HEALTH_DOT[node.health] || 'bg-slate-200'}`} title={node.health || 'no health'} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="px-1 rounded bg-slate-100 text-[10px] font-semibold text-slate-600">{node.kind}</span>
              <span className="font-mono text-xs text-slate-900 break-all">{node.name}</span>
              {node.health && <span className="text-[10px] text-slate-500">{node.health}</span>}
              {sync && sync !== 'Synced' && <span className="text-[10px] font-semibold text-amber-700">{sync}</span>}
            </div>
            {(node.info.length > 0 || node.healthMessage) && (
              <div className="flex gap-x-3 gap-y-0.5 flex-wrap text-[10px] text-slate-500">
                {node.info.map((i) => (
                  <span key={i.name}>
                    {i.name}: <span className="text-slate-700">{i.value}</span>
                  </span>
                ))}
                {node.healthMessage && <span className="text-rose-700">{node.healthMessage}</span>}
              </div>
            )}
            {node.images.length > 0 && (
              <div className="font-mono text-[10px] text-slate-500 truncate" title={node.images.join(', ')}>
                {node.images.join(', ')}
              </div>
            )}
          </div>
          {node.createdAt && <span className="text-[10px] text-slate-400 shrink-0">{formatRelativeTime(node.createdAt)}</span>}
        </div>
        {kids.length > 0 && <ul>{kids.map((k) => render(k, depth + 1))}</ul>}
      </li>
    );
  };

  return <ul aria-label="Resource tree">{roots.map((r) => render(r, 0))}</ul>;
};

// ---------------------------------------------------------------- Diff
const DIFF_STATE: Record<ArgoDiffItem['state'], { label: string; cls: string }> = {
  modified: { label: 'Differs from Git', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  missing: { label: 'Missing in cluster', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  extra: { label: 'Not in Git (will be pruned)', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  'in-sync': { label: 'In sync', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

const DiffView: React.FC<{ name: string }> = ({ name }) => {
  const [items, setItems] = useState<ArgoDiffItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    argoAppsApi
      .diff(name)
      .then(setItems)
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load the diff')));
  }, [name]);

  const all = items || [];
  const changed = all.filter((i) => i.state !== 'in-sync');
  const visible = showAll ? all : changed;
  const pager = usePagination(visible, 10, showAll);

  if (error) return <ErrorBox message={error} />;
  if (!items) return <Loading label="Comparing Git with the cluster…" />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-600">
          {changed.length === 0 ? (
            <span className="text-emerald-700 font-semibold">All {items.length} resources match Git.</span>
          ) : (
            <>
              <strong className="text-amber-800">{changed.length}</strong> of {items.length} resources differ.{' '}
              <span className="text-rose-700">− cluster</span> / <span className="text-emerald-700">+ Git</span>
            </>
          )}
        </span>
        <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show in-sync resources
        </label>
      </div>
      {pager.pageItems.map((item) => (
        <div key={`${item.kind}/${item.namespace}/${item.name}`} className="border border-slate-200 rounded-md overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
            <span className="text-xs">
              <span className="font-semibold text-slate-700">{item.kind}</span> <span className="font-mono text-slate-900">{item.name}</span>
            </span>
            <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${DIFF_STATE[item.state].cls}`}>{DIFF_STATE[item.state].label}</span>
          </div>
          {item.diff.length > 0 && (
            <pre className="max-h-72 overflow-auto text-[11px] leading-5 font-mono custom-scrollbar">
              {item.diff.map((line, i) =>
                line.type === '…' ? (
                  <div key={i} className="px-3 text-slate-400 bg-slate-50 select-none">
                    {line.text || '⋯'}
                  </div>
                ) : (
                  <div
                    key={i}
                    className={`px-3 whitespace-pre ${
                      line.type === '+' ? 'bg-emerald-50 text-emerald-900' : line.type === '-' ? 'bg-rose-50 text-rose-900' : 'text-slate-600'
                    }`}
                  >
                    <span className="select-none text-slate-400 mr-2">{line.type}</span>
                    {line.text}
                  </div>
                )
              )}
            </pre>
          )}
        </div>
      ))}
      {pager.total > pager.pageSize && (
        <Pagination compact page={pager.page} pageSize={pager.pageSize} total={pager.total} onPageChange={pager.setPage} itemLabel="resources" />
      )}
    </div>
  );
};

// ---------------------------------------------------------------- History
const HistoryView: React.FC<{ app: ArgoAppDetail; canManage: boolean; onRolledBack: () => void }> = ({ app, canManage, onRolledBack }) => {
  const toast = useToast();
  const [target, setTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rollback = async () => {
    if (target === null) return;
    setBusy(true);
    setError(null);
    try {
      toast.success((await argoAppsApi.rollback(app.name, target)).message);
      setTarget(null);
      onRolledBack();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Rollback failed'));
    } finally {
      setBusy(false);
    }
  };

  const pager = usePagination(app.history, 10, app.name);

  if (app.history.length === 0) return <p className="text-xs text-slate-500 py-6 text-center">No syncs recorded yet.</p>;

  return (
    <>
      {app.autoSync.enabled && (
        <p className="mb-3 p-2.5 rounded-md border border-sky-200 bg-sky-50 text-sky-900 text-[11px]">
          Auto-sync is on, so ArgoCD rollback is disabled: it would re-apply Git immediately. Roll back through Git instead
          {app.kubeorbit ? ' (Environments → History)' : ''}.
        </p>
      )}
      <div className="overflow-x-auto border border-slate-200 rounded-md">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2">#</th>
              <th scope="col" className="px-3 py-2">Revision</th>
              <th scope="col" className="px-3 py-2">Deployed</th>
              <th scope="col" className="px-3 py-2">By</th>
              <th scope="col" className="px-3 py-2 text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pager.pageItems.map((h, i) => {
              const idx = (pager.page - 1) * pager.pageSize + i; // position in the full history: 0 = current
              return (
              <tr key={h.id}>
                <td className="px-3 py-2 text-slate-500">{h.id}</td>
                <td className="px-3 py-2">
                  <a href={commitUrl(app.source.repoURL, h.fullRevision)} target="_blank" rel="noreferrer" className="font-mono text-indigo-700 hover:underline">
                    {h.revision}
                  </a>
                  {idx === 0 && <span className="ml-1.5 px-1 rounded bg-emerald-600 text-white text-[10px] font-semibold">current</span>}
                </td>
                <td className="px-3 py-2 text-slate-600" title={formatDateTime(h.deployedAt)}>
                  {formatRelativeTime(h.deployedAt)}
                </td>
                <td className="px-3 py-2 text-slate-600">{h.by || '–'}</td>
                <td className="px-3 py-2 text-right">
                  {canManage && idx > 0 && !app.autoSync.enabled && (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setTarget(h.id);
                      }}
                      className="h-7 px-2 inline-flex items-center gap-1 rounded-md border border-slate-300 text-[11px] font-semibold text-slate-700 hover:bg-amber-50 cursor-pointer"
                    >
                      <RotateCcw size={12} aria-hidden /> Roll back
                    </button>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pager.total > pager.pageSize && (
        <Pagination compact className="mt-2" page={pager.page} pageSize={pager.pageSize} total={pager.total} onPageChange={pager.setPage} itemLabel="syncs" />
      )}
      <ConfirmDialog
        isOpen={target !== null}
        title={`Roll back ${app.name} to #${target}?`}
        confirmLabel="Roll back"
        isLoading={busy}
        error={error}
        onCancel={() => !busy && setTarget(null)}
        onConfirm={rollback}
        message="ArgoCD re-applies the manifests of that sync. Git is not changed, so the app shows OutOfSync until you sync or fix Git."
      />
    </>
  );
};

// ---------------------------------------------------------------- Events
const EventsView: React.FC<{ name: string }> = ({ name }) => {
  const [events, setEvents] = useState<ArgoEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warningsOnly, setWarningsOnly] = useState(false);

  useEffect(() => {
    argoAppsApi
      .events(name)
      .then(setEvents)
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load events')));
  }, [name]);

  const visible = warningsOnly ? (events || []).filter((e) => e.type === 'Warning') : events || [];
  const pager = usePagination(visible, 10, warningsOnly);

  if (error) return <ErrorBox message={error} />;
  if (!events) return <Loading label="Loading events…" />;

  return (
    <div className="space-y-2">
      <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
        <input type="checkbox" checked={warningsOnly} onChange={(e) => setWarningsOnly(e.target.checked)} /> Warnings only (
        {events.filter((e) => e.type === 'Warning').length})
      </label>
      {visible.length === 0 ? (
        <p className="text-xs text-slate-500 py-4 text-center">No events.</p>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-md">
          {pager.pageItems.map((e, i) => (
            <li key={i} className={`px-3 py-2 text-xs ${e.type === 'Warning' ? 'bg-amber-50/60' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">
                  {e.type === 'Warning' && <AlertTriangle size={12} className="inline text-amber-600 mr-1 -mt-0.5" aria-hidden />}
                  {e.reason}
                  {e.count > 1 && <span className="text-slate-500 font-normal"> ×{e.count}</span>}
                </span>
                <span className="text-[10px] text-slate-500 shrink-0" title={formatDateTime(e.time)}>
                  {formatRelativeTime(e.time)}
                </span>
              </div>
              <p className="text-slate-600 break-words">{e.message}</p>
              <p className="text-[10px] text-slate-400">
                {e.object}
                {e.source && ` · ${e.source}`}
              </p>
            </li>
          ))}
        </ul>
      )}
      {pager.total > pager.pageSize && (
        <Pagination compact page={pager.page} pageSize={pager.pageSize} total={pager.total} onPageChange={pager.setPage} itemLabel="events" />
      )}
    </div>
  );
};

// ---------------------------------------------------------------- Modal
export const AppDetailsModal: React.FC<AppDetailsModalProps> = ({ name, canManage, onClose, onSync, onChanged }) => {
  const toast = useToast();
  const [app, setApp] = useState<ArgoAppDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState<string | null>(null);
  const [tabKey, setTabKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setApp(await argoAppsApi.get(name));
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load the application'));
    }
  }, [name]);

  useEffect(() => {
    load();
  }, [load]);

  const running = app?.operation?.phase === 'Running' || app?.health.status === 'Progressing';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  const act = async (label: string, fn: () => Promise<{ message: string }>) => {
    setBusy(label);
    try {
      toast.success((await fn()).message);
      await load();
      setTabKey((k) => k + 1);
      onChanged();
    } catch (err) {
      toast.error(getApiErrorMessage(err, `${label} failed`));
    } finally {
      setBusy(null);
    }
  };

  const tabs: { id: Tab; label: string; badge?: number }[] = app
    ? [
        { id: 'overview', label: 'Overview' },
        { id: 'resources', label: 'Resources', badge: app.resources.length },
        { id: 'diff', label: 'Diff', badge: app.resourceCounts.outOfSync || undefined },
        { id: 'history', label: 'History', badge: app.history.length },
        { id: 'events', label: 'Events' },
      ]
    : [];

  return (
    <Modal
      isOpen
      onClose={onClose}
      maxWidth="xl"
      title={name}
      subtitle={app ? `${app.project} project · ${app.sourceType || 'manifests'} · ${clusterLabel(app.destination.server, app.destination.name)} / ${app.destination.namespace}` : 'ArgoCD application'}
      icon={
        <div className="w-9 h-9 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center">
          <Workflow size={18} />
        </div>
      }
    >
      {error ? (
        <ErrorBox message={error} />
      ) : !app ? (
        <Loading label="Asking ArgoCD…" />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <SyncPill status={app.sync.status} />
              <HealthPill status={app.health.status} message={app.health.message} />
              {app.operation && <OperationPill phase={app.operation.phase} />}
              <span className="text-[11px] text-slate-500">{app.autoSync.enabled ? 'Auto-sync' : 'Manual sync'}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button size="sm" variant="secondary" isLoading={busy === 'Refresh'} leftIcon={<RefreshCw size={12} />} onClick={() => act('Refresh', () => argoAppsApi.refresh(name, false))}>
                Refresh
              </Button>
              <Button size="sm" variant="secondary" isLoading={busy === 'Hard refresh'} onClick={() => act('Hard refresh', () => argoAppsApi.refresh(name, true))} title="Clear ArgoCD's manifest cache and re-read Git">
                Hard refresh
              </Button>
              {canManage && app.operation?.phase === 'Running' && (
                <Button size="sm" variant="danger" isLoading={busy === 'Terminate'} leftIcon={<OctagonX size={12} />} onClick={() => act('Terminate', () => argoAppsApi.terminate(name))}>
                  Terminate
                </Button>
              )}
              {canManage && (
                <Button size="sm" leftIcon={<RotateCw size={12} />} onClick={() => onSync(app)} disabled={app.operation?.phase === 'Running'}>
                  Sync
                </Button>
              )}
              <a href={app.argoUrl} target="_blank" rel="noreferrer" className="h-8 px-2.5 inline-flex items-center gap-1 rounded-md border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                ArgoCD <ExternalLink size={11} aria-hidden />
              </a>
            </div>
          </div>

          {app.conditions.length > 0 && (
            <div className="p-3 rounded-md border border-rose-200 bg-rose-50 text-rose-900 text-xs space-y-1" role="alert">
              {app.conditions.map((c, i) => (
                <p key={i} className="flex gap-1.5 break-words">
                  <AlertTriangle size={13} className="shrink-0 mt-px" aria-hidden />
                  <span className="min-w-0">
                    <strong>{c.type}</strong>: {c.message}
                  </span>
                </p>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 -mb-px border-b-2 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                  tab === t.id ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.label}
                {t.badge !== undefined && <span className="ml-1 px-1 rounded bg-slate-100 text-slate-600 text-[10px]">{t.badge}</span>}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <dl>
                <Field label="Repository">
                  <a href={app.source.repoURL.replace(/\.git$/, '')} target="_blank" rel="noreferrer" className="font-mono text-sky-700 hover:underline break-all">
                    {repoShortName(app.source.repoURL)}
                  </a>
                </Field>
                <Field label="Path / chart">
                  <span className="font-mono">{app.source.path || app.source.chart || '/'}</span>
                </Field>
                <Field label="Target revision">
                  <span className="font-mono">{app.source.targetRevision}</span>
                </Field>
                <Field label="Synced revision">
                  <a href={commitUrl(app.source.repoURL, app.history[0]?.fullRevision || '')} target="_blank" rel="noreferrer" className="font-mono text-indigo-700 hover:underline">
                    {app.sync.revision || '–'}
                  </a>
                </Field>
                <Field label="Destination">
                  {clusterLabel(app.destination.server, app.destination.name)} / <span className="font-mono">{app.destination.namespace}</span>
                </Field>
                <Field label="Sync policy">
                  {app.autoSync.enabled ? `Automatic${app.autoSync.prune ? ', prune' : ''}${app.autoSync.selfHeal ? ', self-heal' : ''}` : 'Manual'}
                </Field>
                <Field label="Sync options">
                  {app.syncOptions.length ? (
                    <span className="flex gap-1 flex-wrap">
                      {app.syncOptions.map((o) => (
                        <span key={o} className="px-1.5 rounded bg-slate-100 font-mono text-[10px]">
                          {o}
                        </span>
                      ))}
                    </span>
                  ) : (
                    '–'
                  )}
                </Field>
                {app.kubeorbit && (
                  <Field label="DevOps Intelligence">
                    {app.kubeorbit.project}
                    {app.kubeorbit.environment && ` · ${app.kubeorbit.environment}`}
                  </Field>
                )}
              </dl>
              <dl>
                <Field label="Images">
                  {app.images.length ? (
                    <span className="space-y-0.5 block">
                      {app.images.map((img) => (
                        <span key={img} className="block font-mono text-[11px] break-all">
                          {img}
                        </span>
                      ))}
                    </span>
                  ) : (
                    '–'
                  )}
                </Field>
                <Field label="Resources">
                  {app.resourceCounts.total} total
                  {app.resourceCounts.outOfSync > 0 && <span className="text-amber-700"> · {app.resourceCounts.outOfSync} out of sync</span>}
                  {app.resourceCounts.unhealthy > 0 && <span className="text-rose-700"> · {app.resourceCounts.unhealthy} unhealthy</span>}
                </Field>
                <Field label="Last sync">
                  {app.lastSync ? (
                    <span title={formatDateTime(app.lastSync.at)}>
                      {formatRelativeTime(app.lastSync.at)} by {app.lastSync.by || 'unknown'} ({app.lastSync.revision})
                    </span>
                  ) : (
                    'Never'
                  )}
                </Field>
                <Field label="Reconciled">{app.reconciledAt ? formatRelativeTime(app.reconciledAt) : '–'}</Field>
                <Field label="Created">{formatDateTime(app.createdAt)}</Field>
                {app.operationDetail && (
                  <Field label="Last operation">
                    <span className={app.operationDetail.phase === 'Succeeded' ? 'text-emerald-700' : app.operationDetail.phase === 'Running' ? 'text-sky-700' : 'text-rose-700'}>
                      {app.operationDetail.phase}
                    </span>{' '}
                    by {app.operationDetail.by || 'unknown'} · {formatRelativeTime(app.operationDetail.startedAt)}
                    {app.operationDetail.message && <span className="block text-[11px] text-slate-500">{app.operationDetail.message}</span>}
                    {app.operationDetail.results.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {app.operationDetail.results.map((r) => (
                          <li key={`${r.kind}/${r.name}`} className="text-[11px] text-slate-600 truncate" title={r.message}>
                            {r.kind} <span className="font-mono">{r.name}</span>: {r.message || r.status}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Field>
                )}
              </dl>
            </div>
          )}
          {tab === 'resources' && <ResourceTree key={tabKey} name={name} app={app} />}
          {tab === 'diff' && <DiffView key={tabKey} name={name} />}
          {tab === 'history' && (
            <HistoryView
              app={app}
              canManage={canManage}
              onRolledBack={() => {
                load();
                onChanged();
              }}
            />
          )}
          {tab === 'events' && <EventsView key={tabKey} name={name} />}
        </div>
      )}
    </Modal>
  );
};
