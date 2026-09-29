import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Cloud, CloudOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { ListToolbar } from '../common/ListToolbar';
import { DataTable, DataColumn } from '../common/DataTable';
import { Pagination } from '../common/Pagination';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ConnectorLogoTile } from './ConnectorLogos';
import { IconAction } from './ConnectorRowActions';
import { DnsRecordModal } from './DnsRecordModal';
import { PROXIABLE_TYPES, relativeName, ttlLabel, typeChipClass } from './dnsHelpers';
import { useListQuery, SortOption } from '../../hooks/useListQuery';
import { dnsApi, DnsConnector, DnsRecord, DnsRecordType, DnsZone } from '../../api/dnsApi';
import { getApiErrorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';

const SORT_OPTIONS: SortOption<DnsRecord>[] = [
  { value: 'name', label: 'Name A–Z', compare: (a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type) },
  { value: 'name-desc', label: 'Name Z–A', compare: (a, b) => b.name.localeCompare(a.name) },
  { value: 'type', label: 'Type', compare: (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name) },
  { value: 'recent', label: 'Recently changed', compare: (a, b) => (b.modifiedOn || '').localeCompare(a.modifiedOn || '') },
];

interface DnsRecordsModalProps {
  connector: DnsConnector;
  zone: DnsZone;
  canManage: boolean;
  onBack: () => void;
  onClose: () => void;
}

const noop = () => undefined;

export const DnsRecordsModal: React.FC<DnsRecordsModalProps> = ({ connector, zone, canManage, onBack, onClose }) => {
  const toast = useToast();
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [editableTypes, setEditableTypes] = useState<DnsRecordType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ record: DnsRecord | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DnsRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await dnsApi.records(connector._id, zone.id);
      setRecords(res.records);
      setEditableTypes(res.editableTypes);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load DNS records'));
    } finally {
      setIsLoading(false);
    }
  }, [connector._id, zone.id]);

  useEffect(() => {
    load();
  }, [load]);

  const typeOptions = useMemo(() => [...new Set(records.map((r) => r.type))].sort().map((t) => ({ value: t, label: t })), [records]);

  const list = useListQuery(records, {
    searchText: (r) => `${r.name} ${r.content} ${r.comment} ${r.environment ?? ''}`,
    status: (r) => r.type,
    sortOptions: SORT_OPTIONS,
    defaultPageSize: 10,
  });

  const isEditable = (r: DnsRecord) => editableTypes.includes(r.type as DnsRecordType);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await dnsApi.deleteRecord(connector._id, zone.id, deleteTarget);
      toast.success(res.message || `Deleted ${deleteTarget.name}`);
      setDeleteTarget(null);
      load();
    } catch (err) {
      setDeleteError(getApiErrorMessage(err, 'Could not delete the record'));
    } finally {
      setIsDeleting(false);
    }
  };

  const columns: DataColumn<DnsRecord>[] = [
    {
      key: 'type',
      header: 'Type',
      render: (r) => <span className={`inline-flex px-1.5 py-0.5 rounded border text-[11px] font-mono font-semibold ${typeChipClass(r.type)}`}>{r.type}</span>,
    },
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <div className="min-w-[140px] max-w-[240px]">
          <div className="font-mono font-semibold text-slate-900 truncate" title={r.name}>
            {relativeName(r.name, zone.name)}
          </div>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {r.managed && (
              <span className="inline-flex px-1.5 py-px rounded text-[10px] font-semibold bg-sky-50 text-sky-800 border border-sky-200" title="Created or last changed by DevOps Intelligence">
                Managed
              </span>
            )}
            {r.environment && (
              <span className="inline-flex px-1.5 py-px rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200" title="Public hostname of this environment">
                {r.environment}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'content',
      header: 'Content',
      render: (r) => (
        <div className="font-mono text-[11px] text-slate-700 truncate max-w-[260px]" title={r.content}>
          {r.type === 'MX' && r.priority !== undefined && <span className="text-slate-400 mr-1">{r.priority}</span>}
          {r.content}
        </div>
      ),
    },
    {
      key: 'proxied',
      header: 'Proxy',
      render: (r) =>
        PROXIABLE_TYPES.includes(r.type) ? (
          r.proxied ? (
            <span className="inline-flex items-center gap-1 text-orange-600 font-semibold" title="Proxied: traffic goes through Cloudflare">
              <Cloud size={14} fill="currentColor" aria-hidden /> Proxied
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-slate-500" title="DNS only: resolves straight to the origin">
              <CloudOff size={14} aria-hidden /> DNS only
            </span>
          )
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: 'ttl',
      header: 'TTL',
      render: (r) => <span className="text-slate-600 whitespace-nowrap">{ttlLabel(r.ttl)}</span>,
    },
    {
      key: 'comment',
      header: 'Comment',
      render: (r) => (
        <div className="text-slate-600 truncate max-w-[180px]" title={r.comment || undefined}>
          {r.comment || <span className="text-slate-400">—</span>}
        </div>
      ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            headerClassName: 'text-right',
            className: 'text-right',
            render: (r: DnsRecord) =>
              isEditable(r) ? (
                <div className="flex items-center justify-end gap-1.5">
                  <IconAction label={`Edit ${r.type} record ${r.name}`} onClick={() => setEditing({ record: r })} icon={<Pencil size={14} />} />
                  <IconAction
                    label={`Delete ${r.type} record ${r.name}`}
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteTarget(r);
                    }}
                    icon={<Trash2 size={14} />}
                    tone="danger"
                  />
                </div>
              ) : (
                <span className="text-[11px] text-slate-400" title={`${r.type} records are read-only here; edit them in Cloudflare`}>
                  Read-only
                </span>
              ),
          } as DataColumn<DnsRecord>,
        ]
      : []),
  ];

  const childOpen = Boolean(editing || deleteTarget);

  return (
    <>
      <Modal
        isOpen
        onClose={childOpen ? noop : onClose}
        maxWidth="xl"
        icon={<ConnectorLogoTile kind="dns" />}
        title={
          <span>
            DNS records · <span className="font-mono">{zone.name}</span>
          </span>
        }
        subtitle={`${connector.name}${editableTypes.length ? ` · editable here: ${editableTypes.join(', ')}` : ''}`}
      >
        <div className="space-y-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900 cursor-pointer"
          >
            <ArrowLeft size={13} aria-hidden /> Zones
          </button>
          <ListToolbar
            query={list.query}
            onQueryChange={list.setQuery}
            searchPlaceholder="Search name, content or comment"
            statusOptions={typeOptions}
            status={list.status}
            onStatusChange={list.setStatus}
            sortOptions={SORT_OPTIONS}
            sort={list.sort}
            onSortChange={list.setSort}
            onRefresh={load}
            isRefreshing={isLoading}
            actions={
              canManage ? (
                <Button
                  size="sm"
                  leftIcon={<Plus size={14} />}
                  onClick={() => setEditing({ record: null })}
                  disabled={isLoading && !records.length}
                  title={isLoading && !records.length ? 'Loading records…' : undefined}
                >
                  Add record
                </Button>
              ) : undefined
            }
          />
          {error ? (
            <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
              {error}
            </div>
          ) : (
            <DataTable
              caption={`DNS records of ${zone.name}`}
              columns={columns}
              rows={list.pageItems}
              rowKey={(r) => r.id}
              isLoading={isLoading}
              empty={<span className="text-xs text-slate-500">{list.hasFilters ? 'No records match your filters.' : 'This zone has no DNS records yet.'}</span>}
              footer={
                <Pagination
                  page={list.page}
                  pageSize={list.pageSize}
                  total={list.filteredCount}
                  onPageChange={list.setPage}
                  onPageSizeChange={list.setPageSize}
                  itemLabel="records"
                />
              }
            />
          )}
        </div>
      </Modal>

      {editing && (
        <DnsRecordModal
          connectorId={connector._id}
          zone={zone}
          record={editing.record}
          editableTypes={editableTypes}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete DNS record?"
        message={
          <div className="space-y-2">
            <p>
              <span className="font-mono text-xs font-semibold">
                {deleteTarget?.type} {deleteTarget?.name}
              </span>{' '}
              → <span className="font-mono text-xs break-all">{deleteTarget?.content}</span> will be removed from Cloudflare.
            </p>
            {deleteTarget?.environment && (
              <p className="p-2.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                This is the public hostname of <strong className="font-semibold">{deleteTarget.environment}</strong>. That environment's URL will stop
                working until the record is recreated.
              </p>
            )}
          </div>
        }
        confirmLabel="Delete record"
        isLoading={isDeleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => !isDeleting && setDeleteTarget(null)}
      />
    </>
  );
};
