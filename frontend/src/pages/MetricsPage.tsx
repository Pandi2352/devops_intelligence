import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, BarChart3, ChevronDown, ChevronRight, FileText, Play, RefreshCw } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Button } from '../components/common/Button';
import { Dropdown } from '../components/common/Dropdown';
import { TextArea } from '../components/common/Form';
import { DataTable, DataColumn } from '../components/common/DataTable';
import { Pagination } from '../components/common/Pagination';
import { usePagination } from '../hooks/usePagination';
import { ScopeBar } from '../components/observability/ScopeBar';
import { MetricsPanel } from '../components/observability/MetricsPanel';
import { LineChart } from '../components/observability/LineChart';
import { useObservabilityScope } from '../hooks/useObservabilityScope';
import { useAuth } from '../context/AuthContext';
import { MetricSeries, PodInfo, observabilityApi } from '../api/observabilityApi';
import { getApiErrorMessage } from '../api/client';
import { TIME_RANGES, TONE_CLASS, formatBytes, formatCores, podTone } from '../utils/observability';
import { formatRelativeTime } from '../utils/format';

const PromQLExplorer: React.FC<{ namespace: string }> = ({ namespace }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(`sum by (pod) (container_memory_working_set_bytes{namespace="${namespace || 'default'}"})`);
  const [range, setRange] = useState('1h');
  const [series, setSeries] = useState<MetricSeries[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const run = async () => {
    setIsRunning(true);
    setError(null);
    try {
      setSeries((await observabilityApi.query(query, range)).series);
    } catch (err) {
      setSeries(null);
      setError(getApiErrorMessage(err, 'Query failed'));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center gap-2 px-4 py-3 text-left cursor-pointer">
        {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
        <span className="text-sm font-semibold text-slate-900">PromQL explorer</span>
        <span className="text-[11px] text-slate-500">Run any Prometheus query (DevOps / Super Admin)</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <TextArea
            mono
            rows={3}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="PromQL query"
            placeholder={`e.g. sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="${namespace}"}[5m]))`}
          />
          <div className="flex items-center gap-2">
            <Dropdown size="sm" ariaLabel="Range" value={range} onChange={setRange} options={TIME_RANGES} />
            <Button size="sm" leftIcon={<Play size={13} />} onClick={run} isLoading={isRunning} disabled={!query.trim()}>
              Run
            </Button>
          </div>
          {error && (
            <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2" role="alert">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
          {series && (series.length ? <LineChart series={series} unit="count" height={220} /> : <p className="text-xs text-slate-500">The query returned no series.</p>)}
        </div>
      )}
    </section>
  );
};

export const MetricsPage: React.FC = () => {
  const scope = useObservabilityScope();
  const [params] = useSearchParams();
  const { hasRole } = useAuth();
  const canExplore = hasRole(['superadmin', 'devops']);

  const logsLink = (pod: string) => {
    const next = new URLSearchParams(params);
    next.set('target', `pod:${pod}`);
    next.delete('container');
    if (!next.get('namespace') && !next.get('env')) next.set('namespace', scope.namespace);
    return `/logs?${next}`;
  };

  const columns: DataColumn<PodInfo>[] = [
    {
      key: 'name',
      header: 'Pod',
      render: (p) => (
        <div className="min-w-[180px]">
          <div className="font-mono text-xs text-slate-900">{p.name}</div>
          {p.problem && <div className="text-[11px] text-rose-700 max-w-[360px] truncate" title={p.problem}>{p.problem}</div>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (p) => (
        <span className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-semibold ${TONE_CLASS[podTone(p.status, p.readyCount === p.containerCount)]}`}>{p.status}</span>
      ),
    },
    { key: 'ready', header: 'Ready', render: (p) => <span className="font-mono text-xs">{p.ready}</span> },
    { key: 'restarts', header: 'Restarts', render: (p) => <span className={`font-mono text-xs ${p.restarts ? 'text-amber-700 font-semibold' : ''}`}>{p.restarts}</span> },
    { key: 'cpu', header: 'CPU', render: (p) => <span className="font-mono text-xs">{formatCores(p.usage?.cpuCores)}</span> },
    { key: 'mem', header: 'Memory', render: (p) => <span className="font-mono text-xs">{formatBytes(p.usage?.memoryBytes)}</span> },
    { key: 'age', header: 'Age', render: (p) => <span className="text-xs text-slate-600">{formatRelativeTime(p.createdAt)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      headerClassName: 'text-right',
      className: 'text-right',
      render: (p) => (
        <div className="inline-flex items-center gap-1">
          <Link to={logsLink(p.name)} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold text-sky-700 hover:bg-sky-50">
            <FileText size={12} /> Logs
          </Link>
          <Button size="sm" variant={scope.selectedPods.length === 1 && scope.selectedPods[0] === p.name ? 'primary' : 'ghost'} leftIcon={<BarChart3 size={12} />} onClick={() => scope.selectPod(p.name)}>
            Metrics
          </Button>
        </div>
      ),
    },
  ];

  const tablePods = scope.selectedPods.length ? (scope.pods || []).filter((p) => scope.selectedPods.includes(p.name)) : scope.pods || [];
  const podPager = usePagination(tablePods, 10, `${scope.cluster}|${scope.namespace}|${scope.target}`);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Metrics"
        description="CPU, memory, network and restarts per pod from Prometheus, with live usage from metrics-server. Pick a project environment or any namespace."
      />

      <ScopeBar scope={scope} showContainer={false} />

      {scope.error && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2" role="alert">
          <AlertTriangle size={15} /> {scope.error}
        </div>
      )}

      {!scope.namespace ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
          <BarChart3 size={22} className="mx-auto text-slate-400 mb-2" />
          <p className="text-sm font-semibold text-slate-800">Pick what to measure</p>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            Choose a project and environment (for example kubeorbit-demo → staging) or pick any namespace. Then narrow down to a workload or a single pod.
          </p>
        </div>
      ) : (
        <>
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Pods in <span className="font-mono">{scope.namespace}</span>
              </h2>
              <Button size="sm" variant="secondary" leftIcon={<RefreshCw size={13} className={scope.podsLoading ? 'animate-spin' : ''} />} onClick={scope.reloadPods} disabled={scope.podsLoading}>
                Refresh
              </Button>
            </div>
            <DataTable
              caption="Pods"
              columns={columns}
              rows={podPager.pageItems}
              rowKey={(p) => p.name}
              isLoading={scope.podsLoading && !scope.pods}
              empty={<p className="text-xs text-slate-500 py-2">No pods in this namespace.</p>}
              footer={
                podPager.total > 0 ? (
                  <Pagination
                    page={podPager.page}
                    pageSize={podPager.pageSize}
                    total={podPager.total}
                    onPageChange={podPager.setPage}
                    onPageSizeChange={podPager.setPageSize}
                    itemLabel="pods"
                  />
                ) : undefined
              }
            />
          </section>

          <MetricsPanel namespace={scope.namespace} pods={scope.selectedPods} cluster={scope.cluster} />

          {canExplore && <PromQLExplorer namespace={scope.namespace} />}
        </>
      )}
    </div>
  );
};
