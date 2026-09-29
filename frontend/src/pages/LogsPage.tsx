import React, { useMemo, useState } from 'react';
import { AlertTriangle, Info, Layers, RefreshCw, ScrollText } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { ScopeBar } from '../components/observability/ScopeBar';
import { LogViewer } from '../components/observability/LogViewer';
import { PodDetailsModal, StatusPill } from '../components/observability/PodDetailsModal';
import { useObservabilityScope } from '../hooks/useObservabilityScope';
import { sortEnvironments } from '../utils/project';
import { formatRelativeTime } from '../utils/format';
import { formatBytes, formatCores, podTone } from '../utils/observability';

export const LogsPage: React.FC = () => {
  const scope = useObservabilityScope();
  const [details, setDetails] = useState<string | null>(null);

  const problems = useMemo(() => (scope.pods || []).filter((p) => podTone(p.status, p.readyCount === p.containerCount) === 'bad' || p.problem), [scope.pods]);
  const projectsWithEnvs = (scope.scopes?.projects || []).filter((p) => p.environments.length);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Logs"
        description="Live and previous-run logs for any pod: pick a project environment or a namespace, then one pod, a whole deployment or every pod."
      />

      <ScopeBar scope={scope} />

      {scope.error && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2" role="alert">
          <AlertTriangle size={14} /> {scope.error}
        </div>
      )}

      {!scope.namespace ? (
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-md bg-sky-50 text-sky-700">
              <ScrollText size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Where do you want to look?</h2>
              <p className="text-xs text-slate-500">Jump straight to a project environment, or pick any namespace above.</p>
            </div>
          </div>
          {projectsWithEnvs.map((p) => (
            <div key={p.id}>
              <div className="text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                <Layers size={13} className="text-slate-400" /> {p.name}
              </div>
              <div className="flex flex-wrap gap-2">
                {sortEnvironments(p.environments, (e) => e.name).map((e) => (
                  <button
                    key={e.name}
                    type="button"
                    onClick={() => {
                      scope.setProject(p.id);
                      scope.setEnvironment(e.name);
                    }}
                    className="px-3 py-2 rounded-md border border-slate-200 hover:border-sky-400 hover:bg-sky-50 text-left"
                  >
                    <div className="text-xs font-semibold font-mono text-slate-900">{e.name}</div>
                    <div className="text-[11px] font-mono text-slate-500">{e.namespace}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-4 items-start">
          <aside className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
              <span className="text-xs font-semibold text-slate-700">
                Pods <span className="text-slate-400 font-normal">in {scope.namespace}</span>
              </span>
              <button type="button" onClick={scope.reloadPods} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Refresh pods">
                <RefreshCw size={13} className={scope.podsLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            {problems.length > 0 && (
              <div className="px-3 py-2 bg-rose-50 border-b border-rose-100 text-[11px] text-rose-800">
                <strong>{problems.length}</strong> pod{problems.length === 1 ? '' : 's'} need attention
              </div>
            )}
            <ul className="max-h-[62vh] overflow-auto divide-y divide-slate-100">
              <li>
                <button
                  type="button"
                  onClick={() => scope.setTarget('all')}
                  className={`w-full text-left px-3 py-2 text-xs ${scope.target === 'all' ? 'bg-sky-50 text-sky-800 font-semibold' : 'hover:bg-slate-50 text-slate-700'}`}
                >
                  All pods ({scope.pods?.length ?? 0})
                </button>
              </li>
              {scope.workloads.map((w) => {
                const value = `wl:${w.kind}/${w.name}`;
                return (
                  <li key={value}>
                    <button
                      type="button"
                      onClick={() => scope.setTarget(value)}
                      className={`w-full text-left px-3 py-2 text-xs ${scope.target === value ? 'bg-sky-50 text-sky-800 font-semibold' : 'hover:bg-slate-50 text-slate-700'}`}
                    >
                      <span className="font-mono">{w.name}</span>
                      <span className="text-slate-400"> · {w.kind} · {w.pods} pods</span>
                    </button>
                  </li>
                );
              })}
              {(scope.pods || []).map((p) => {
                const active = scope.target === `pod:${p.name}`;
                return (
                  <li key={p.name} className={active ? 'bg-sky-50' : 'hover:bg-slate-50'}>
                    <div className="flex items-start gap-1 px-3 py-2">
                      <button type="button" onClick={() => scope.selectPod(p.name)} className="flex-1 min-w-0 text-left">
                        <div className={`text-xs font-mono truncate ${active ? 'text-sky-800 font-semibold' : 'text-slate-800'}`} title={p.name}>
                          {p.name}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <StatusPill status={p.status} ready={p.readyCount === p.containerCount} />
                          <span className="text-[11px] text-slate-500">{p.ready}</span>
                          {p.restarts > 0 && <span className="text-[11px] font-semibold text-amber-700">↻ {p.restarts}</span>}
                          <span className="text-[11px] text-slate-400">{formatRelativeTime(p.createdAt)}</span>
                        </div>
                        {p.usage && (
                          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                            {formatCores(p.usage.cpuCores)} · {formatBytes(p.usage.memoryBytes)}
                          </div>
                        )}
                        {p.problem && <div className="text-[11px] text-rose-700 mt-1 line-clamp-2">{p.problem}</div>}
                      </button>
                      <button type="button" onClick={() => setDetails(p.name)} className="p-1 text-slate-400 hover:text-sky-700" aria-label={`Details for ${p.name}`} title="Pod details">
                        <Info size={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
              {scope.pods && scope.pods.length === 0 && <li className="px-3 py-4 text-xs text-slate-500">No pods in this namespace.</li>}
            </ul>
          </aside>

          <LogViewer
            cluster={scope.cluster}
            namespace={scope.namespace}
            pods={scope.target === 'all' ? [] : scope.selectedPods}
            container={scope.container}
            lokiAvailable={Boolean(scope.scopes?.sources.loki)}
            height="h-[62vh]"
          />
        </div>
      )}

      {details && <PodDetailsModal cluster={scope.cluster} namespace={scope.namespace} pod={details} onClose={() => setDetails(null)} />}
    </div>
  );
};
