import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Copy, FileCode2, RefreshCw, ScrollText } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { ResourceDetail, observabilityApi } from '../../api/observabilityApi';
import { getApiErrorMessage } from '../../api/client';
import { formatRelativeTime, formatDateTime } from '../../utils/format';
import { TONE_CLASS, formatBytes, formatCores } from '../../utils/observability';
import { StatusPill } from './PodDetailsModal';

type Tab = 'overview' | 'yaml' | 'events';

interface ResourceDetailsModalProps {
  cluster?: string;
  kindKey: string; // e.g. "deployment"
  namespace: string;
  name: string;
  onClose: () => void;
  onOpenPod: (pod: string, namespace: string) => void;
}

const LOG_WORKLOADS = ['Deployment', 'StatefulSet', 'DaemonSet'];

export const ResourceDetailsModal: React.FC<ResourceDetailsModalProps> = ({ cluster, kindKey, namespace, name, onClose, onOpenPod }) => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<ResourceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await observabilityApi.resource(kindKey, namespace, name, cluster));
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load the resource'));
    } finally {
      setLoading(false);
    }
  }, [kindKey, namespace, name, cluster]);

  useEffect(() => {
    load();
  }, [load]);

  const logsParams = (target: string) => new URLSearchParams({ ...(cluster ? { cluster } : {}), namespace, target }).toString();
  const workloadLogs = data && LOG_WORKLOADS.includes(data.kind) ? `/logs?${logsParams(`wl:${data.kind}/${name}`)}` : null;
  const warnings = data?.events.filter((e) => e.type === 'Warning').length || 0;

  return (
    <Modal
      isOpen
      onClose={onClose}
      maxWidth="xl"
      icon={<FileCode2 size={18} />}
      title={<span className="font-mono">{name}</span>}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span>{data?.kind || kindKey}</span>
          {namespace && <span className="font-mono">{namespace}</span>}
          {data && <span className={`px-1.5 py-0.5 rounded border text-[11px] font-semibold ${TONE_CLASS[data.row.tone]}`}>{data.row.status}</span>}
        </span>
      }
      footer={
        <>
          {workloadLogs && (
            <Button
              variant="secondary"
              className="mr-auto"
              leftIcon={<ScrollText size={13} />}
              onClick={() => {
                onClose();
                navigate(workloadLogs);
              }}
            >
              Logs of all {data?.pods.length} pods
            </Button>
          )}
          <Button variant="secondary" leftIcon={<RefreshCw size={13} />} onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="flex gap-1 border-b border-slate-200 -mt-1 mb-3" role="tablist">
        {(['overview', 'yaml', 'events'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px capitalize ${tab === t ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {t === 'yaml' ? 'YAML' : t}
            {t === 'events' && warnings > 0 && <span className="ml-1.5 px-1.5 rounded-full bg-amber-100 text-amber-800 text-[10px]">{warnings}</span>}
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
      ) : !data ? null : tab === 'overview' ? (
        <div className="space-y-4">
          {Object.keys(data.row.cols).length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-md border border-slate-200 p-3">
              {Object.entries(data.row.cols).map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">{k.replace(/([A-Z])/g, ' $1')}</div>
                  <div className="text-xs font-mono text-slate-800 break-all">{String(v) || '—'}</div>
                </div>
              ))}
            </div>
          )}
          {data.pods.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-700 mb-1.5">Pods ({data.pods.length})</h3>
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {data.pods.map((p) => (
                  <li key={p.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <button type="button" onClick={() => onOpenPod(p.name, p.namespace)} className="font-mono text-xs text-sky-700 hover:underline">
                      {p.name}
                    </button>
                    <StatusPill status={p.status} ready={p.readyCount === p.containerCount} />
                    <span className="text-[11px] text-slate-500">{p.ready}</span>
                    {p.restarts > 0 && <span className="text-[11px] font-semibold text-amber-700">↻ {p.restarts}</span>}
                    {p.usage && (
                      <span className="text-[11px] font-mono text-slate-500">
                        {formatCores(p.usage.cpuCores)} · {formatBytes(p.usage.memoryBytes)}
                      </span>
                    )}
                    <span className="text-[11px] text-slate-400">{formatRelativeTime(p.createdAt)}</span>
                    <Link to={`/logs?${logsParams(`pod:${p.name}`)}`} onClick={onClose} className="ml-auto text-[11px] text-sky-700 hover:underline inline-flex items-center gap-1">
                      <ScrollText size={12} /> Logs
                    </Link>
                    {p.problem && <div className="basis-full text-[11px] text-rose-700">{p.problem}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.events.filter((e) => e.type === 'Warning').slice(0, 3).map((e, i) => (
            <div key={i} className="p-2.5 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <strong>{e.reason}</strong> {e.message} <span className="text-amber-700">({formatRelativeTime(e.lastSeen)})</span>
            </div>
          ))}
        </div>
      ) : tab === 'yaml' ? (
        <div className="relative">
          <Button size="sm" variant="secondary" className="absolute right-2 top-2" leftIcon={<Copy size={12} />} onClick={() => navigator.clipboard?.writeText(data.yaml)}>
            Copy
          </Button>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-slate-950 text-slate-200 text-[12px] leading-[1.5] font-mono p-3">{data.yaml}</pre>
        </div>
      ) : data.events.length ? (
        <ul className="divide-y divide-slate-100">
          {data.events.map((e, i) => (
            <li key={i} className="py-2 flex gap-3 text-xs">
              <span className={`shrink-0 w-16 font-semibold ${e.type === 'Warning' ? 'text-amber-700' : 'text-slate-500'}`}>{e.type}</span>
              <div className="min-w-0">
                <span className="font-semibold text-slate-800">{e.reason}</span>
                {e.count > 1 && <span className="ml-1.5 text-slate-500">×{e.count}</span>}
                <span className="ml-2 text-slate-400" title={formatDateTime(e.lastSeen)}>
                  {formatRelativeTime(e.lastSeen)}
                </span>
                <div className="text-slate-600 break-words">{e.message}</div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-500 py-4">No recent events. Kubernetes keeps events for about an hour.</p>
      )}
    </Modal>
  );
};
