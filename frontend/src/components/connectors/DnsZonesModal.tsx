import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, ListTree } from 'lucide-react';
import { Modal } from '../common/Modal';
import { ListToolbar } from '../common/ListToolbar';
import { DataTable, DataColumn } from '../common/DataTable';
import { Pagination } from '../common/Pagination';
import { ConnectorLogoTile } from './ConnectorLogos';
import { IconAction } from './ConnectorRowActions';
import { DnsRecordsModal } from './DnsRecordsModal';
import { useListQuery, SortOption } from '../../hooks/useListQuery';
import { dnsApi, DnsConnector, DnsZone } from '../../api/dnsApi';
import { getApiErrorMessage } from '../../api/client';
import { formatDateTime, formatRelativeTime } from '../../utils/format';

const SORT_OPTIONS: SortOption<DnsZone>[] = [
  { value: 'name', label: 'Name A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
  { value: 'name-desc', label: 'Name Z–A', compare: (a, b) => b.name.localeCompare(a.name) },
  { value: 'records', label: 'Most records', compare: (a, b) => (b.recordCount ?? 0) - (a.recordCount ?? 0) },
  { value: 'recent', label: 'Recently changed', compare: (a, b) => (b.modifiedOn || '').localeCompare(a.modifiedOn || '') },
];

const STATUS_OPTIONS = ['active', 'pending', 'moved', 'deactivated'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }));

const statusChip = (z: DnsZone) => {
  if (z.paused) return 'bg-slate-100 text-slate-700 border-slate-200';
  if (z.status === 'active') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (z.status === 'pending') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-rose-50 text-rose-700 border-rose-200';
};

export const DnsZonesModal: React.FC<{ connector: DnsConnector; canManage: boolean; onClose: () => void }> = ({ connector, canManage, onClose }) => {
  const [zones, setZones] = useState<DnsZone[]>([]);
  const [recordsZone, setRecordsZone] = useState<DnsZone | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setZones(await dnsApi.zones(connector._id));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load zones'));
    } finally {
      setIsLoading(false);
    }
  }, [connector._id]);

  useEffect(() => {
    load();
  }, [load]);

  const list = useListQuery(zones, {
    searchText: (z) => `${z.name} ${z.account} ${z.plan}`,
    status: (z) => z.status,
    sortOptions: SORT_OPTIONS,
    defaultPageSize: 10,
  });

  const columns: DataColumn<DnsZone>[] = [
    {
      key: 'zone',
      header: 'Zone',
      render: (z) => (
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => setRecordsZone(z)}
            className="font-semibold text-slate-900 font-mono hover:text-sky-700 hover:underline cursor-pointer text-left"
            title={`Show DNS records of ${z.name}`}
          >
            {z.name}
          </button>
          <div className="text-[11px] text-slate-500">{[z.account, z.plan].filter(Boolean).join(' · ') || '—'}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (z) => (
        <span
          className={`inline-flex px-1.5 py-0.5 rounded border text-[11px] font-semibold ${statusChip(z)}`}
          title={z.status === 'pending' ? 'Point the domain at the Cloudflare name servers to activate it' : undefined}
        >
          {z.paused ? 'paused' : z.status}
        </span>
      ),
    },
    {
      key: 'records',
      header: 'DNS records',
      render: (z) => <span className="font-mono text-slate-800">{z.recordCount ?? '—'}</span>,
    },
    {
      key: 'ns',
      header: 'Name servers',
      render: (z) => <div className="font-mono text-[11px] text-slate-600 leading-snug">{z.nameServers.length ? z.nameServers.map((n) => <div key={n}>{n}</div>) : '—'}</div>,
    },
    {
      key: 'modified',
      header: 'Changed',
      render: (z) => (
        <span className="text-slate-600" title={formatDateTime(z.modifiedOn)}>
          {z.modifiedOn ? formatRelativeTime(z.modifiedOn) : '—'}
        </span>
      ),
    },
    {
      key: 'open',
      header: <span className="sr-only">Open</span>,
      headerClassName: 'text-right',
      className: 'text-right',
      render: (z) => (
        <div className="flex items-center justify-end gap-1.5">
        <IconAction label={`DNS records of ${z.name}`} onClick={() => setRecordsZone(z)} icon={<ListTree size={14} />} />
        <a
          href={`https://dash.cloudflare.com/${z.accountId}/${encodeURIComponent(z.name)}/dns/records`}
          target="_blank"
          rel="noreferrer"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:text-orange-600 hover:border-orange-200 hover:bg-orange-50"
          aria-label={`Open ${z.name} DNS in Cloudflare`}
          title="Open in Cloudflare"
        >
          <ExternalLink size={13} />
        </a>
        </div>
      ),
    },
  ];

  if (recordsZone) {
    return <DnsRecordsModal connector={connector} zone={recordsZone} canManage={canManage} onBack={() => setRecordsZone(null)} onClose={onClose} />;
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      maxWidth="xl"
      icon={<ConnectorLogoTile kind="dns" />}
      title={`Zones · ${connector.name}`}
      subtitle={connector.zones.length ? `Limited to ${connector.zones.join(', ')}` : 'Every zone this API token can see'}
    >
      <div className="space-y-3">
        <ListToolbar
          query={list.query}
          onQueryChange={list.setQuery}
          searchPlaceholder="Search zones"
          statusOptions={STATUS_OPTIONS}
          status={list.status}
          onStatusChange={list.setStatus}
          sortOptions={SORT_OPTIONS}
          sort={list.sort}
          onSortChange={list.setSort}
          onRefresh={load}
          isRefreshing={isLoading}
        />
        {error ? (
          <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
            {error}
          </div>
        ) : (
          <DataTable
            caption="Cloudflare zones"
            columns={columns}
            rows={list.pageItems}
            rowKey={(z) => z.id}
            isLoading={isLoading}
            empty={<span className="text-xs text-slate-500">{list.hasFilters ? 'No zones match your filters.' : 'This token cannot see any zones.'}</span>}
            footer={
              <Pagination
                page={list.page}
                pageSize={list.pageSize}
                total={list.filteredCount}
                onPageChange={list.setPage}
                onPageSizeChange={list.setPageSize}
                itemLabel="zones"
              />
            }
          />
        )}
      </div>
    </Modal>
  );
};
