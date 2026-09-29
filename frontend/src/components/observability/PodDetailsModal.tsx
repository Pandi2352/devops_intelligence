import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Box, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Dropdown } from '../common/Dropdown';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { LogViewer } from './LogViewer';
import { MetricsPanel } from './MetricsPanel';
import { ContainerInfo, EventInfo, PodInfo, observabilityApi } from '../../api/observabilityApi';
import { getApiErrorMessage } from '../../api/client';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import { TONE_CLASS, formatBytes, formatCores, parseCpuQuantity, parseMemoryQuantity, podTone } from '../../utils/observability';

type Tab = 'overview' | 'logs' | 'events' | 'metrics' | 'yaml';

interface PodDetailsModalProps {
  cluster?: string;
  namespace: string;
  pod: string;
  initialTab?: Tab;
  onClose: () => void;
}

export const StatusPill: React.FC<{ status: string; ready?: boolean }> = ({ status, ready }) => (
  <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-semibold ${TONE_CLASS[podTone(status, ready)]}`}>{status}</span>
);

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0">
    <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">{label}</div>
    <div className="text-xs text-slate-800 font-mono truncate">{children || '—'}</div>
  </div>
);

// Usage against the limit (or request when there is no limit).
const UsageBar: React.FC<{ used?: number; request?: number; limit?: number; format: (n?: number) => string }> = ({ used, request, limit, format }) => {
  const max = limit || request;
  const pct = used !== undefined && max ? Math.min(100, (used / max) * 100) : undefined;
  return (
    <div>
      <div className="flex justify-between text-[11px] font-mono text-slate-700">
        <span>{format(used)}</span>
        <span className="text-slate-400">
          {request ? `req ${format(request)}` : 'no request'} · {limit ? `limit ${format(limit)}` : 'no limit'}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 mt-1 overflow-hidden">
        {pct !== undefined && <div className={`h-full ${pct > 90 ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
};

const ContainerCard: React.FC<{ c: ContainerInfo }> = ({ c }) => (
  <div className="rounded-md border border-slate-200 p-3 space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <Box size={14} className="text-slate-400" aria-hidden />
      <span className="font-mono text-sm font-semibold text-slate-900">{c.name}</span>
      {c.init && <span className="text-[10px] uppercase font-semibold text-slate-500 bg-slate-100 px-1.5 rounded">init</span>}
      <StatusPill status={c.reason || c.state} ready={c.ready || c.init} />
      {c.restartCount > 0 && <span className="text-[11px] font-semibold text-amber-700">{c.restartCount} restarts</span>}
      {c.startedAt && <span className="text-[11px] text-slate-500">started {formatRelativeTime(c.startedAt)}</span>}
    </div>
    <div className="text-[11px] font-mono text-slate-600 break-all">{c.image}</div>
    {c.message && <div className="text-[11px] text-rose-700">{c.message}</div>}
    {c.lastTermination && (
      <div className="text-[11px] text-slate-600">
        Last run ended: <strong className="text-slate-800">{c.lastTermination.reason || 'terminated'}</strong>, exit code{' '}
        <span className="font-mono">{c.lastTermination.exitCode}</span>
        {c.lastTermination.finishedAt && ` · ${formatRelativeTime(c.lastTermination.finishedAt)}`}
      </div>
    )}
    {!c.init && (
      <div className="grid sm:grid-cols-2 gap-3 pt-1">
        <div>
          <div className="text-[10px] uppercase font-semibold text-slate-500 mb-0.5">CPU</div>
          <UsageBar used={c.usage?.cpuCores} request={parseCpuQuantity(c.requests.cpu)} limit={parseCpuQuantity(c.limits.cpu)} format={formatCores} />
        </div>
        <div>
          <div className="text-[10px] uppercase font-semibold text-slate-500 mb-0.5">Memory</div>
          <UsageBar used={c.usage?.memoryBytes} request={parseMemoryQuantity(c.requests.memory)} limit={parseMemoryQuantity(c.limits.memory)} format={formatBytes} />
        </div>
      </div>
    )}
    {c.ports.length > 0 && <div className="text-[11px] text-slate-500">Ports: <span className="font-mono">{c.ports.join(', ')}</span></div>}
  </div>
);

const EventList: React.FC<{ events: EventInfo[] }> = ({ events }) =>
  events.length ? (
    <ul className="divide-y divide-slate-100">
      {events.map((e, i) => (
        <li key={`${e.reason}-${e.lastSeen}-${i}`} className="py-2 flex gap-3 text-xs">
          <span className={`shrink-0 w-16 font-semibold ${e.type === 'Warning' ? 'text-amber-700' : 'text-slate-500'}`}>{e.type}</span>
          <div className="min-w-0 flex-1">
            <div>
              <span className="font-semibold text-slate-800">{e.reason}</span>
              {e.count > 1 && <span className="ml-1.5 text-slate-500">×{e.count}</span>}
              <span className="ml-2 text-slate-400" title={formatDateTime(e.lastSeen)}>
                {formatRelativeTime(e.lastSeen)}
              </span>
            </div>
            <div className="text-slate-600 break-words">{e.message}</div>
          </div>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-xs text-slate-500 py-4">No events in the last hour. Kubernetes keeps events for about an hour.</p>
  );

export const PodDetailsModal: React.FC<PodDetailsModalProps> = ({ cluster, namespace, pod, initialTab = 'overview', onClose }) => {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [data, setData] = useState<{ pod: PodInfo; events: EventInfo[]; manifestYaml: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [container, setContainer] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await observabilityApi.pod(namespace, pod, cluster));
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load the pod'));
    } finally {
      setLoading(false);
    }
  }, [namespace, pod, cluster]);

  useEffect(() => {
    load();
  }, [load]);

  const p = data?.pod;
  const crashed = Boolean(p && p.restarts > 0 && p.containers.some((c) => c.lastTermination));
  const warnings = data?.events.filter((e) => e.type === 'Warning').length || 0;
  const mainContainers = p?.containers.filter((c) => !c.init) || [];
  const logsHref = `/logs?${new URLSearchParams({ ...(cluster ? { cluster } : {}), namespace, target: `pod:${pod}` })}`;

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'logs', label: 'Logs' },
    { key: 'events', label: 'Events', badge: warnings || undefined },
    { key: 'metrics', label: 'Metrics' },
    { key: 'yaml', label: 'YAML' },
  ];

  return (
    <Modal
      isOpen
      onClose={onClose}
      maxWidth="xl"
      icon={<Box size={18} />}
      title={<span className="font-mono">{pod}</span>}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{namespace}</span>
          {p && <StatusPill status={p.status} ready={p.readyCount === p.containerCount} />}
          {p?.project && (
            <Link to={`/projects/${p.projectId}`} className="text-sky-700 hover:underline">
              {p.project} · {p.environment}
            </Link>
          )}
        </span>
      }
      footer={
        <>
          <Link to={logsHref} onClick={onClose} className="mr-auto inline-flex items-center gap-1 text-xs text-sky-700 hover:underline">
            <ExternalLink size={12} /> Open in Logs page
          </Link>
          <Button variant="secondary" leftIcon={<RefreshCw size={13} />} onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="flex gap-1 border-b border-slate-200 -mt-1 mb-3 overflow-x-auto" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap ${
              tab === t.key ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
            {t.badge ? <span className="ml-1.5 px-1.5 rounded-full bg-amber-100 text-amber-800 text-[10px]">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-2.5 mb-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2" role="alert">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {loading && !data ? (
        <LoadingSpinner />
      ) : !p ? null : tab === 'overview' ? (
        <div className="space-y-4">
          {p.problem && (
            <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start justify-between gap-3">
              <span className="flex items-start gap-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                {p.problem}
              </span>
              <Button size="sm" variant="secondary" onClick={() => setTab('logs')}>
                {crashed ? 'Logs of the crash' : 'View logs'}
              </Button>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-md border border-slate-200 p-3">
            <Fact label="Ready">{p.ready}</Fact>
            <Fact label="Restarts">{p.restarts ? `${p.restarts} (last ${formatRelativeTime(p.lastRestartAt)})` : '0'}</Fact>
            <Fact label="Age">{formatRelativeTime(p.createdAt)}</Fact>
            <Fact label="Owner">{p.owner ? `${p.owner.kind}/${p.owner.name}` : '—'}</Fact>
            <Fact label="Node">{p.node}</Fact>
            <Fact label="Pod IP">{p.podIP}</Fact>
            <Fact label="QoS">{p.qosClass}</Fact>
            <Fact label="Usage">{p.usage ? `${formatCores(p.usage.cpuCores)} · ${formatBytes(p.usage.memoryBytes)}` : 'metrics-server n/a'}</Fact>
          </div>
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-700">Containers</h3>
            {p.containers.map((c) => (
              <ContainerCard key={`${c.init}-${c.name}`} c={c} />
            ))}
          </div>
          <div>
            <h3 className="text-xs font-semibold text-slate-700 mb-1">Conditions</h3>
            <div className="flex flex-wrap gap-1.5">
              {p.conditions.map((c) => (
                <span
                  key={c.type}
                  title={c.message || c.reason || ''}
                  className={`px-1.5 py-0.5 rounded border text-[11px] ${c.status === 'True' ? TONE_CLASS.ok : TONE_CLASS.warn}`}
                >
                  {c.type}
                </span>
              ))}
            </div>
          </div>
          {Object.keys(p.labels).length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-700 mb-1">Labels</h3>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(p.labels).map(([k, v]) => (
                  <span key={k} className="px-1.5 py-0.5 rounded bg-slate-100 text-[11px] font-mono text-slate-700">
                    {k}={v}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : tab === 'logs' ? (
        <div className="space-y-2">
          {mainContainers.length > 1 && (
            <Dropdown
              size="sm"
              mono
              ariaLabel="Container"
              value={container}
              onChange={setContainer}
              options={[{ value: 'all', label: 'All containers' }, ...mainContainers.map((c) => ({ value: c.name, label: c.name }))]}
            />
          )}
          <LogViewer cluster={cluster} namespace={namespace} pods={[pod]} container={container} height="h-[52vh]" defaultPrevious={crashed && p.status === 'CrashLoopBackOff'} compact />
        </div>
      ) : tab === 'events' ? (
        <EventList events={data.events} />
      ) : tab === 'metrics' ? (
        <MetricsPanel namespace={namespace} pods={[pod]} compact />
      ) : (
        <div className="relative">
          <Button size="sm" variant="secondary" className="absolute right-2 top-2" leftIcon={<Copy size={12} />} onClick={() => navigator.clipboard?.writeText(data.manifestYaml)}>
            Copy
          </Button>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-slate-950 text-slate-200 text-[12px] leading-[1.5] font-mono p-3">
            {data.manifestYaml}
          </pre>
        </div>
      )}
    </Modal>
  );
};
