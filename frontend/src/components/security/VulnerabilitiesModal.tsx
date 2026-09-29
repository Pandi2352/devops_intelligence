import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, ShieldAlert } from 'lucide-react';
import { Modal } from '../common/Modal';
import { ListToolbar } from '../common/ListToolbar';
import { DataTable, DataColumn } from '../common/DataTable';
import { Pagination } from '../common/Pagination';
import { useListQuery, SortOption } from '../../hooks/useListQuery';
import { ImageReport, Vulnerability, securityApi } from '../../api/securityApi';
import { getApiErrorMessage } from '../../api/client';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import { SEVERITIES, SEVERITY_META, severityMeta } from './securityMeta';
import { SeverityChip, SeverityCountChips } from './SecurityChips';

const SORT_OPTIONS: SortOption<Vulnerability>[] = [
  {
    value: 'severity',
    label: 'Severity',
    compare: (a, b) => severityMeta(a.severity).rank - severityMeta(b.severity).rank || (b.score ?? 0) - (a.score ?? 0),
  },
  { value: 'score', label: 'Score (high first)', compare: (a, b) => (b.score ?? -1) - (a.score ?? -1) },
  { value: 'package', label: 'Package A–Z', compare: (a, b) => a.package.localeCompare(b.package) },
  { value: 'id', label: 'CVE id', compare: (a, b) => a.id.localeCompare(b.id) },
];

const SEVERITY_OPTIONS = SEVERITIES.map((s) => ({ value: s, label: SEVERITY_META[s].label }));

interface VulnerabilitiesModalProps {
  projectId: string;
  env: string;
  report: ImageReport;
  onClose: () => void;
}

export const VulnerabilitiesModal: React.FC<VulnerabilitiesModalProps> = ({ projectId, env, report: initial, onClose }) => {
  const [report, setReport] = useState<ImageReport>(initial);
  const [vulns, setVulns] = useState<Vulnerability[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyFixable, setOnlyFixable] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await securityApi.vulnerabilities(projectId, env, initial.name);
      setReport(res.report || initial);
      setVulns(res.vulnerabilities || []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load the vulnerabilities'));
    } finally {
      setIsLoading(false);
    }
  }, [projectId, env, initial]);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(() => (onlyFixable ? vulns.filter((v) => v.fixed) : vulns), [vulns, onlyFixable]);

  const list = useListQuery(items, {
    searchText: (v) => `${v.id} ${v.package} ${v.title}`,
    status: (v) => (v.severity || 'UNKNOWN').toUpperCase(),
    sortOptions: SORT_OPTIONS,
    defaultPageSize: 20,
  });

  const columns: DataColumn<Vulnerability>[] = [
    { key: 'severity', header: 'Severity', render: (v) => <SeverityChip severity={v.severity} /> },
    {
      key: 'id',
      header: 'CVE',
      render: (v) =>
        v.link ? (
          <a href={v.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-sky-700 hover:underline whitespace-nowrap">
            {v.id} <ExternalLink size={10} aria-hidden />
          </a>
        ) : (
          <span className="font-mono whitespace-nowrap">{v.id}</span>
        ),
    },
    {
      key: 'package',
      header: 'Package',
      render: (v) => (
        <span className="font-mono text-slate-800 block max-w-[160px] truncate" title={v.target ? `${v.package} (${v.target})` : v.package}>
          {v.package}
        </span>
      ),
    },
    {
      key: 'version',
      header: 'Installed → fixed',
      render: (v) => (
        <span className="font-mono text-[11px] whitespace-nowrap">
          <span className="text-slate-700">{v.installed || '—'}</span>
          <span className="text-slate-400"> → </span>
          {v.fixed ? <span className="text-emerald-700 font-semibold">{v.fixed}</span> : <span className="text-slate-400">no fix</span>}
        </span>
      ),
    },
    { key: 'score', header: 'Score', render: (v) => <span className="font-mono">{v.score ?? '—'}</span> },
    {
      key: 'title',
      header: 'Title',
      render: (v) => (
        <span className="block max-w-[260px] truncate text-slate-600" title={v.title}>
          {v.title || '—'}
        </span>
      ),
    },
  ];

  const fixableCount = vulns.filter((v) => v.fixed).length;

  return (
    <Modal
      isOpen
      onClose={onClose}
      maxWidth="xl"
      icon={<ShieldAlert size={20} className="text-rose-600" />}
      title={`Vulnerabilities · ${report.container || report.workload}`}
      subtitle={
        <span className="font-mono break-all" title={report.image}>
          {report.image}
          {report.tag && !report.image.includes(report.tag) ? `:${report.tag}` : ''}
        </span>
      }
    >
      <div className="space-y-3">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-md bg-slate-50 border border-slate-100 p-2.5 text-[11px]">
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-wide text-slate-400">Workload</dt>
            <dd className="font-mono text-slate-700 truncate">
              {report.workloadKind ? `${report.workloadKind}/` : ''}
              {report.workload}
              {report.container ? ` · ${report.container}` : ''}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-wide text-slate-400">OS</dt>
            <dd className="font-mono text-slate-700 truncate">{report.os || '—'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-wide text-slate-400">Scanner</dt>
            <dd className="font-mono text-slate-700 truncate">{report.scanner || '—'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-wide text-slate-400">Scanned</dt>
            <dd className="text-slate-700" title={formatDateTime(report.scannedAt)}>
              {report.scannedAt ? formatRelativeTime(report.scannedAt) : '—'}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
          <SeverityCountChips counts={report.counts} />
          <span>
            · <strong className="text-slate-900">{report.fixable}</strong> fixable
          </span>
        </div>

        <ListToolbar
          query={list.query}
          onQueryChange={list.setQuery}
          searchPlaceholder="Search CVE, package or title"
          statusOptions={SEVERITY_OPTIONS}
          status={list.status}
          onStatusChange={list.setStatus}
          sortOptions={SORT_OPTIONS}
          sort={list.sort}
          onSortChange={list.setSort}
          onRefresh={load}
          isRefreshing={isLoading}
          actions={
            <label className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-700 cursor-pointer whitespace-nowrap">
              <input type="checkbox" checked={onlyFixable} onChange={(e) => setOnlyFixable(e.target.checked)} className="accent-sky-600" />
              Only fixable{vulns.length ? ` (${fixableCount})` : ''}
            </label>
          }
        />
        {error ? (
          <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
            {error}
          </div>
        ) : (
          <DataTable
            caption={`Vulnerabilities in ${report.image}`}
            columns={columns}
            rows={list.pageItems}
            rowKey={(v) => `${v.id}-${v.package}-${v.installed}-${v.target}`}
            isLoading={isLoading}
            empty={
              <span className="text-xs text-slate-500">
                {list.hasFilters || onlyFixable ? 'No vulnerabilities match your filters.' : 'Trivy found no vulnerabilities in this image.'}
              </span>
            }
            footer={
              <Pagination
                page={list.page}
                pageSize={list.pageSize}
                total={list.filteredCount}
                onPageChange={list.setPage}
                onPageSizeChange={list.setPageSize}
                itemLabel="vulnerabilities"
              />
            }
          />
        )}
      </div>
    </Modal>
  );
};
