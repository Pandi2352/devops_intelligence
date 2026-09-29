import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, RefreshCw, Search } from 'lucide-react';
import { Button } from '../common/Button';
import { Dropdown } from '../common/Dropdown';
import { Pagination } from '../common/Pagination';
import { usePagination } from '../../hooks/usePagination';
import { getApiErrorMessage } from '../../api/client';
import { AuditEventItem, approvalApi } from '../../api/approvalApi';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import { ACTION_LABEL, OUTCOMES, OUTCOME_META, auditCsv, downloadText } from './approvalMeta';

interface AuditLogTableProps {
  /** Fixes the project (project page); otherwise a project filter is shown. */
  project?: string;
}

// Who did what, where and how it ended: every deploy action and every approval step.
export const AuditLogTable: React.FC<AuditLogTableProps> = ({ project }) => {
  const [events, setEvents] = useState<AuditEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState('');
  const [outcome, setOutcome] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEvents(await approvalApi.audit({ project, limit: 1000 }));
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load the audit log'));
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    load();
  }, [load]);

  const projects = useMemo(() => [...new Set(events.map((e) => e.project).filter(Boolean))].sort(), [events]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter(
      (e) =>
        (!projectFilter || e.project === projectFilter) &&
        (!outcome || e.outcome === outcome) &&
        (!needle || `${e.actor} ${e.actorName} ${e.action} ${e.environment} ${e.target} ${e.message}`.toLowerCase().includes(needle))
    );
  }, [events, projectFilter, outcome, query]);
  const paging = usePagination(filtered, 20, `${projectFilter}|${outcome}|${query}`);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by person, action, environment or message"
            aria-label="Search the audit log"
            className="w-full h-9 pl-8 pr-3 rounded-md border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
          />
        </div>
        {!project && (
          <Dropdown
            ariaLabel="Project"
            value={projectFilter}
            onChange={setProjectFilter}
            options={[{ value: '', label: 'All projects' }, ...projects.map((p) => ({ value: p, label: p }))]}
            placeholder="All projects"
          />
        )}
        <Dropdown
          ariaLabel="Outcome"
          value={outcome}
          onChange={setOutcome}
          options={[{ value: '', label: 'All outcomes' }, ...OUTCOMES.map((o) => ({ value: o, label: OUTCOME_META[o].label }))]}
          placeholder="All outcomes"
        />
        <div className="flex gap-2 ml-auto">
          <Button variant="secondary" size="sm" className="h-9" onClick={load} disabled={loading} aria-label="Refresh audit log">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-9"
            leftIcon={<Download size={13} />}
            disabled={!filtered.length}
            onClick={() => downloadText(`audit-${project || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`, auditCsv(filtered))}
          >
            Export CSV
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2" role="alert">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">Audit log</caption>
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="text-left font-semibold px-3 py-2">When</th>
              <th className="text-left font-semibold px-3 py-2">Who</th>
              <th className="text-left font-semibold px-3 py-2">Action</th>
              <th className="text-left font-semibold px-3 py-2">Where</th>
              <th className="text-left font-semibold px-3 py-2">Outcome</th>
              <th className="text-left font-semibold px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && !events.length ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                  Loading the audit log…
                </td>
              </tr>
            ) : !filtered.length ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                  {events.length ? 'No events match the filters.' : 'Nothing recorded yet. Deploys, syncs, merges and approval decisions appear here.'}
                </td>
              </tr>
            ) : (
              paging.pageItems.map((e) => {
                const meta = OUTCOME_META[e.outcome] || OUTCOME_META.changed;
                return (
                  <tr key={e._id} className="align-top hover:bg-slate-50/60">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600" title={formatDateTime(e.at)}>
                      {formatRelativeTime(e.at)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-slate-800">{e.actorName || e.actor}</div>
                      <div className="text-[10px] text-slate-400">{e.actorRole}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap font-semibold text-slate-800">
                      {ACTION_LABEL[e.action] || e.action}
                      {e.viaApproval && <span className="ml-1 text-[10px] font-normal text-sky-700">via approval</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-700">
                      {e.project || '—'}
                      {e.environment && <span className="text-slate-400"> · {e.environment}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] font-semibold ${meta.chip}`}>{meta.label}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600 max-w-md">
                      <div className="break-words">{e.message}</div>
                      {e.target && <div className="text-[10px] font-mono text-slate-400 truncate">{e.target}</div>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {filtered.length > paging.pageSize && (
        <Pagination page={paging.page} pageSize={paging.pageSize} total={paging.total} onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize} itemLabel="events" />
      )}
    </div>
  );
};
