import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, Copy, ExternalLink, Globe, Loader2, Radio, Settings2, Square } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { ListToolbar } from '../components/common/ListToolbar';
import { DataTable, DataColumn } from '../components/common/DataTable';
import { Pagination } from '../components/common/Pagination';
import { useListQuery, SortOption } from '../hooks/useListQuery';
import { envDnsApi, publicUrlsApi, PublicUrlItem, PublicUrls } from '../api/dnsApi';
import { getApiErrorMessage } from '../api/client';
import { useToast } from '../context/ToastContext';
import { DNS_STATE_META, reachText } from '../components/domains/domainMeta';
import { formatDateTime, formatRelativeTime } from '../utils/format';

const DAY = 24 * 3600_000;

// One row per public address: an environment can have a hostname and a running preview at the same time.
interface Row {
  key: string;
  kind: 'hostname' | 'preview';
  item: PublicUrlItem;
  url: string;
  label: string; // Live / Points elsewhere / Preview …
  group: 'live' | 'attention' | 'preview';
  since?: string;
}

const toRows = (items: PublicUrlItem[]): Row[] =>
  items.flatMap((item) => {
    const rows: Row[] = [];
    if (item.dns) {
      rows.push({
        key: `${item.projectId}/${item.env}/host`,
        kind: 'hostname',
        item,
        url: item.publicUrl,
        label: DNS_STATE_META[item.state]?.label || item.state,
        group: item.state === 'ok' ? 'live' : 'attention',
        since: item.dns.updatedAt,
      });
    }
    if (item.preview.running) {
      rows.push({ key: `${item.projectId}/${item.env}/preview`, kind: 'preview', item, url: item.preview.url, label: 'Preview', group: 'preview', since: item.preview.startedAt });
    }
    return rows;
  });

const isOld = (r: Row) => r.kind === 'preview' && Boolean(r.since) && Date.now() - new Date(r.since!).getTime() > DAY;
const ORDER = { attention: 0, preview: 1, live: 2 };

const SORT_OPTIONS: SortOption<Row>[] = [
  { value: 'status', label: 'Needs attention first', compare: (a, b) => ORDER[a.group] - ORDER[b.group] || Number(isOld(b)) - Number(isOld(a)) },
  { value: 'project', label: 'Project A–Z', compare: (a, b) => a.item.projectName.localeCompare(b.item.projectName) || a.item.env.localeCompare(b.item.env) },
  { value: 'oldest', label: 'Oldest first', compare: (a, b) => (a.since || '').localeCompare(b.since || '') },
];

const STATUS_OPTIONS = [
  { value: 'attention', label: 'Needs attention' },
  { value: 'live', label: 'Live hostnames' },
  { value: 'preview', label: 'Running previews' },
];

const SummaryTile: React.FC<{ label: string; value: number | string; hint?: string; tone?: 'default' | 'good' | 'warn' | 'bad'; isLoading: boolean }> = ({ label, value, hint, tone = 'default', isLoading }) => {
  const color = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : tone === 'bad' ? 'text-rose-700' : 'text-slate-900';
  return (
    <div className="p-3.5 rounded-md border border-slate-200 bg-white">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      {isLoading ? <div className="h-6 w-12 mt-1 rounded bg-slate-100 animate-pulse" /> : <div className={`text-xl font-bold ${color}`}>{value}</div>}
      {hint && !isLoading && <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
};

export const PublicUrlsPage: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<PublicUrls | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProbing, setIsProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);

  // Fast list first, then again with live reachability checks (those take a few seconds).
  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await publicUrlsApi.list(false));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load public URLs'));
      setIsLoading(false);
      return;
    }
    setIsLoading(false);
    setIsProbing(true);
    try {
      setData(await publicUrlsApi.list(true));
    } catch {
      /* keep the fast result */
    } finally {
      setIsProbing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => toRows(data?.items || []), [data]);
  const list = useListQuery(rows, {
    searchText: (r) => `${r.item.projectName} ${r.item.env} ${r.url} ${r.item.dns?.hostname || ''} ${r.item.preview.startedBy}`,
    status: (r) => r.group,
    sortOptions: SORT_OPTIONS,
    syncWithUrl: true,
  });

  const copy = async (r: Row) => {
    try {
      await navigator.clipboard.writeText(r.url);
      setCopied(r.key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error('Could not copy the link');
    }
  };

  const stop = async (r: Row) => {
    setStopping(r.key);
    try {
      const res = await envDnsApi.stopPreview(r.item.projectId, r.item.env);
      toast.success(res.message);
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, `Could not stop the preview of ${r.item.env}`));
    } finally {
      setStopping(null);
    }
  };

  const columns: DataColumn<Row>[] = [
    {
      key: 'where',
      header: 'Project · environment',
      render: (r) => (
        <div className="min-w-[150px]">
          <Link to={`/projects/${r.item.projectId}?tab=domains`} className="font-semibold text-slate-900 hover:text-sky-700 hover:underline">
            {r.item.projectName}
          </Link>
          <div className="text-[11px] font-mono text-slate-500">
            {r.item.env} · {r.item.namespace}
          </div>
        </div>
      ),
    },
    {
      key: 'address',
      header: 'Public address',
      render: (r) => (
        <div className="min-w-[220px] max-w-[360px]">
          <div className="flex items-center gap-1.5">
            {r.kind === 'preview' ? <Radio size={13} className="text-amber-600 shrink-0" aria-hidden /> : <Globe size={13} className="text-sky-600 shrink-0" aria-hidden />}
            {r.url ? (
              <a href={r.url} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-sky-700 hover:underline truncate" title={r.url}>
                {r.url.replace(/^https:\/\//, '')}
              </a>
            ) : (
              <span className="text-[12px] text-slate-500">Starting… {r.item.preview.reason && `(${r.item.preview.reason})`}</span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {r.kind === 'preview'
              ? 'Temporary quick tunnel (trycloudflare.com)'
              : r.item.dns?.mode === 'tunnel'
                ? `Tunnel ${r.item.tunnel?.name || ''}${r.item.tunnel ? ` · ${r.item.tunnel.status}` : ''}`
                : `DNS record → ${r.item.dns?.target || 'Ingress address'}`}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        if (r.kind === 'preview') {
          return (
            <div className="space-y-1 min-w-[130px]">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-semibold ${isOld(r) ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                {isOld(r) && <AlertTriangle size={11} aria-hidden />}
                {isOld(r) ? 'Preview open > 24 h' : r.item.preview.ready ? 'Preview running' : 'Preview starting'}
              </span>
              <div className="text-[11px] text-slate-500">Anyone with the link can open it</div>
            </div>
          );
        }
        const meta = DNS_STATE_META[r.item.state];
        return (
          <div className="space-y-1 min-w-[150px] max-w-[280px]">
            <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[11px] font-semibold ${meta?.chip || ''}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${meta?.dot || ''}`} aria-hidden />
              {meta?.label || r.item.state}
            </span>
            {r.item.state !== 'ok' && r.item.message && (
              <p className="text-[11px] text-slate-600 leading-snug line-clamp-2" title={r.item.message}>
                {r.item.message}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: 'reach',
      header: 'Answers',
      render: (r) => {
        const reach = r.kind === 'preview' ? r.item.preview.reachable : r.item.reachable;
        if (!reach) return isProbing ? <Loader2 size={13} className="animate-spin text-slate-400" aria-label="Checking" /> : <span className="text-slate-400">—</span>;
        return <span className={`text-[11px] font-mono ${reach.ok && reach.status < 500 ? 'text-emerald-700' : 'text-rose-700'}`}>{reachText(reach)}</span>;
      },
    },
    {
      key: 'since',
      header: 'Since',
      render: (r) => (
        <div className="text-[11px] text-slate-600 min-w-[110px]" title={formatDateTime(r.since)}>
          {r.since ? formatRelativeTime(r.since) : '—'}
          <div className="text-slate-400 truncate max-w-[160px]">{r.kind === 'preview' ? r.item.preview.startedBy : r.item.dns?.updatedBy}</div>
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      headerClassName: 'text-right',
      className: 'text-right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          {r.url && (
            <>
              <button
                type="button"
                onClick={() => copy(r)}
                className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:text-sky-700 hover:bg-sky-50"
                aria-label={`Copy ${r.url}`}
                title="Copy link"
              >
                {copied === r.key ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
              </button>
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:text-sky-700 hover:bg-sky-50"
                aria-label={`Open ${r.url}`}
                title="Open"
              >
                <ExternalLink size={13} />
              </a>
            </>
          )}
          {r.kind === 'preview' && (
            <button
              type="button"
              onClick={() => stop(r)}
              disabled={!r.item.canApply || stopping === r.key}
              title={r.item.canApply ? 'Stop the preview: the link stops working immediately' : 'Needs Build and Deploy on this environment'}
              className="h-7 px-2 inline-flex items-center gap-1 rounded-md border border-rose-200 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {stopping === r.key ? <Loader2 size={12} className="animate-spin" /> : <Square size={11} />}
              Stop
            </button>
          )}
          <Link
            to={`/projects/${r.item.projectId}?tab=domains`}
            className="h-7 px-2 inline-flex items-center gap-1 rounded-md border border-slate-200 text-[11px] font-semibold text-slate-600 hover:text-sky-700 hover:bg-sky-50"
            title={r.kind === 'hostname' && r.item.state !== 'ok' ? 'Fix it on the project Domains tab' : 'Manage on the project Domains tab'}
          >
            <Settings2 size={12} />
            {r.kind === 'hostname' && r.item.state !== 'ok' && r.item.canApply ? 'Fix' : 'Manage'}
          </Link>
        </div>
      ),
    },
  ];

  const s = data?.summary;
  const loadingTiles = isLoading && !data;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Public URLs"
        description="Everything reachable from the internet, across the projects you can see: public hostnames (Cloudflare DNS) and temporary preview links. Stop previews you no longer need."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryTile label="Public hostnames" value={s?.hostnames ?? 0} isLoading={loadingTiles} />
        <SummaryTile label="Live" value={s?.live ?? 0} tone={s && s.hostnames && s.live === s.hostnames ? 'good' : 'default'} isLoading={loadingTiles} />
        <SummaryTile label="Need attention" value={s?.needAttention ?? 0} tone={s?.needAttention ? 'bad' : 'default'} hint={s?.needAttention ? 'Missing, wrong or unreachable DNS' : undefined} isLoading={loadingTiles} />
        <SummaryTile
          label="Running previews"
          value={s?.previews ?? 0}
          tone={s?.oldPreviews ? 'bad' : s?.previews ? 'warn' : 'default'}
          hint={s?.oldPreviews ? `${s.oldPreviews} open for more than 24 h` : s?.previews ? 'Public to anyone with the link' : undefined}
          isLoading={loadingTiles}
        />
      </div>

      {data?.unreachableClusters?.length ? (
        <div className="p-3 rounded-md border border-amber-200 bg-amber-50 text-amber-900 text-xs flex items-start gap-2" role="status">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          Could not reach cluster {data.unreachableClusters.join(', ')}: previews there may be missing from this list.
        </div>
      ) : null}

      <ListToolbar
        query={list.query}
        onQueryChange={list.setQuery}
        searchPlaceholder="Search by project, environment, hostname or person"
        statusOptions={STATUS_OPTIONS}
        status={list.status}
        onStatusChange={list.setStatus}
        sortOptions={SORT_OPTIONS}
        sort={list.sort}
        onSortChange={list.setSort}
        onRefresh={load}
        isRefreshing={isLoading || isProbing}
      />

      {error ? (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
          {error}
        </div>
      ) : (
        <DataTable
          caption="Public URLs"
          columns={columns}
          rows={list.pageItems}
          rowKey={(r) => r.key}
          isLoading={isLoading && !data}
          empty={
            <div className="text-xs text-slate-500 space-y-1 py-2">
              {list.hasFilters ? (
                <p>Nothing matches your filters.</p>
              ) : (
                <>
                  <p>Nothing is public right now.</p>
                  <p>
                    Give an environment a hostname or start a preview on its project's <span className="font-semibold">Domains</span> tab.
                  </p>
                </>
              )}
            </div>
          }
          footer={
            <Pagination
              page={list.page}
              pageSize={list.pageSize}
              total={list.filteredCount}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
              itemLabel="addresses"
            />
          }
        />
      )}
    </div>
  );
};
