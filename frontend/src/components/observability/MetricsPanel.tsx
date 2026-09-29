import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, BarChart3, Cpu, ExternalLink, MemoryStick, RefreshCw } from 'lucide-react';
import { Button } from '../common/Button';
import { Dropdown } from '../common/Dropdown';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { LineChart } from './LineChart';
import { MetricPanel, MetricsRange, UsageResult, observabilityApi } from '../../api/observabilityApi';
import { getApiErrorMessage, getApiErrorStatus } from '../../api/client';
import { TIME_RANGES, formatBytes, formatCores, formatMetric } from '../../utils/observability';

interface MetricsPanelProps {
  namespace: string;
  pods?: string[];
  compact?: boolean;
  cluster?: string;
}

// Rates and usage add up across pods/routes; latency and percentages show the worst series instead.
const currentTotal = (p: MetricPanel) => {
  const last = p.series.map((s) => s.points.at(-1)?.[1] || 0);
  return p.aggregate === 'max' ? Math.max(0, ...last) : last.reduce((sum, v) => sum + v, 0);
};

const SECTIONS: { group: MetricPanel['group']; title: string; hint: string }[] = [
  { group: 'app', title: 'Application', hint: 'from the app’s /metrics (http_request_duration_seconds), scraped via a ServiceMonitor' },
  { group: 'resources', title: 'Containers', hint: 'CPU, memory and restarts from Kubernetes (cAdvisor, kube-state-metrics)' },
];

const UsageBar: React.FC<{ icon: React.ReactNode; label: string; used: number; capacity?: number; format: (v: number) => string }> = ({
  icon,
  label,
  used,
  capacity,
  format,
}) => {
  const pct = capacity ? Math.min(100, (used / capacity) * 100) : 0;
  return (
    <div className="flex-1 min-w-[180px]">
      <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1">
        <span className="inline-flex items-center gap-1 font-semibold">
          {icon}
          {label}
        </span>
        <span className="font-mono">
          {format(used)}
          {capacity ? <span className="text-slate-400"> / {format(capacity)} ({pct.toFixed(pct < 1 ? 1 : 0)}%)</span> : null}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(pct, used > 0 ? 1 : 0)}%` }} />
      </div>
    </div>
  );
};

// Prometheus charts (CPU, memory, network, restarts, throttling) for a namespace or a set of pods.
export const MetricsPanel: React.FC<MetricsPanelProps> = ({ namespace, pods = [], compact = false, cluster }) => {
  const navigate = useNavigate();
  const [range, setRange] = useState('1h');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [data, setData] = useState<MetricsRange | null>(null);
  const [usage, setUsage] = useState<UsageResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{ message: string; noConnector: boolean } | null>(null);
  const podKey = pods.join(',');

  const load = useCallback(async () => {
    if (!namespace) return;
    setIsLoading(true);
    const selected = podKey ? podKey.split(',') : [];
    const [metrics, use] = await Promise.allSettled([observabilityApi.metrics(namespace, selected, range), observabilityApi.usage(namespace, cluster)]);
    if (metrics.status === 'fulfilled') {
      setData(metrics.value);
      setError(null);
    } else {
      setData(null);
      setError({ message: getApiErrorMessage(metrics.reason, 'Could not load metrics'), noConnector: getApiErrorStatus(metrics.reason) === 409 });
    }
    setUsage(use.status === 'fulfilled' ? use.value : null);
    setIsLoading(false);
  }, [namespace, podKey, range, cluster]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(load, 30000);
    return () => window.clearInterval(id);
  }, [autoRefresh, load]);

  const selectedUsage = (usage?.pods || []).filter((p) => p.namespace === namespace && (!pods.length || pods.includes(p.pod)));
  const usedCpu = selectedUsage.reduce((s, p) => s + p.cpuCores, 0);
  const usedMem = selectedUsage.reduce((s, p) => s + p.memoryBytes, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!compact && (
          <div className="flex items-center gap-2">
            <BarChart3 size={15} className="text-sky-600" />
            <h3 className="text-sm font-semibold text-slate-900">
              {pods.length === 1 ? `Pod ${pods[0]}` : pods.length ? `${pods.length} pods` : `All pods in ${namespace}`}
            </h3>
            {data?.source && <span className="text-[11px] text-slate-500">from {data.source}</span>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {data?.grafana && (
            <>
              <a
                href={data.grafana.pod || data.grafana.namespace}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline"
              >
                Open in Grafana <ExternalLink size={11} />
              </a>
            </>
          )}
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto-refresh 30s
          </label>
          <Dropdown size="sm" ariaLabel="Time range" value={range} onChange={setRange} options={TIME_RANGES} />
          <Button size="sm" variant="secondary" onClick={load} disabled={isLoading} aria-label="Refresh metrics">
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      {usage?.available && (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Current usage (metrics-server)</div>
          <div className="flex flex-wrap gap-5">
            <UsageBar icon={<Cpu size={12} />} label="CPU" used={usedCpu} capacity={usage.capacity?.cpuCores} format={formatCores} />
            <UsageBar icon={<MemoryStick size={12} />} label="Memory" used={usedMem} capacity={usage.capacity?.memoryBytes} format={formatBytes} />
          </div>
        </div>
      )}
      {usage && !usage.available && usage.message && <p className="text-[11px] text-slate-500">{usage.message}</p>}

      {error ? (
        <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-3" role="alert">
          <span className="flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            {error.message}
          </span>
          {error.noConnector && (
            <Button size="sm" variant="secondary" onClick={() => navigate('/connectors?tab=observability')}>
              Add Prometheus
            </Button>
          )}
        </div>
      ) : !data ? (
        <LoadingSpinner message="Querying Prometheus…" />
      ) : (
        <div className="space-y-4">
          {SECTIONS.map((section) => {
            const panels = data.panels.filter((p) => (p.group || 'resources') === section.group);
            if (!panels.length) return null;
            const noAppData = section.group === 'app' && panels.every((p) => !p.error && p.series.length === 0);
            return (
              <section key={section.group} className="space-y-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">{section.title}</h4>
                  <span className="text-[11px] text-slate-500">{section.hint}</span>
                </div>
                {noAppData ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-xs text-slate-600">
                    No request metrics for this selection. Either there was no traffic in this time range, or the app is not scraped yet:
                    it must expose <code className="font-mono">http_request_duration_seconds</code> on <code className="font-mono">/metrics</code> and have a
                    ServiceMonitor with the label <code className="font-mono">release: kube-prometheus-stack</code> (see the User Guide, Metrics).
                  </div>
                ) : (
                  <div className={`grid gap-3 ${compact ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 lg:grid-cols-2'}`}>
                    {panels.map((p) => {
                      const empty = !p.error && p.series.every((s) => s.points.length === 0);
                      return (
                        <div key={p.key} className="rounded-lg border border-slate-200 bg-white p-3 min-w-0">
                          <div className="flex items-baseline justify-between gap-2 mb-2">
                            <span className="text-xs font-semibold text-slate-800" title={p.query}>
                              {p.title}
                            </span>
                            {!empty && !p.error && (
                              <span className="text-xs font-mono text-slate-600">
                                {formatMetric(currentTotal(p), p.unit)}
                                {p.limit ? <span className="text-slate-400"> / limit {formatMetric(p.limit, p.unit)}</span> : null}
                              </span>
                            )}
                          </div>
                          {p.error ? (
                            <p className="text-[11px] text-rose-700">{p.error}</p>
                          ) : empty && p.key.startsWith('net') ? (
                            <div className="text-[11px] text-slate-400 border border-dashed border-slate-200 rounded-md flex items-center justify-center" style={{ height: compact ? 120 : 160 }}>
                              Not exported by this cluster&apos;s cAdvisor
                            </div>
                          ) : (
                            <LineChart series={p.series} unit={p.unit} limit={p.limit} height={compact ? 130 : 180} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
