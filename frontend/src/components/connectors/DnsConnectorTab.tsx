import React, { useState } from 'react';
import { Cloud, Globe2, KeyRound, ListChecks } from 'lucide-react';
import { DataColumn } from '../common/DataTable';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ConnectorListView } from './ConnectorListView';
import { ConnectorLogoTile } from './ConnectorLogos';
import { ConnectorStatusCell } from './ConnectorStatus';
import { ConnectorRowActions, DefaultBadge, IconAction } from './ConnectorRowActions';
import { DnsConnectorModal } from './DnsConnectorModal';
import { DnsZonesModal } from './DnsZonesModal';
import { DnsTunnelsSection } from './DnsTunnelsSection';
import { ConnectorTabProps, useConnectorTab } from './useConnectorTab';
import { useListQuery, SortOption } from '../../hooks/useListQuery';
import { dnsApi, DnsConnector, dnsStatus } from '../../api/dnsApi';
import { formatDateTime } from '../../utils/format';


const STATUS_OPTIONS = ['Connected', 'Limited', 'Error', 'Unknown', 'Disabled'].map((s) => ({ value: s, label: s }));

const SORT_OPTIONS: SortOption<DnsConnector>[] = [
  { value: 'name', label: 'Name A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
  { value: 'name-desc', label: 'Name Z–A', compare: (a, b) => b.name.localeCompare(a.name) },
  { value: 'recent', label: 'Recently updated', compare: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') },
  { value: 'status', label: 'Status', compare: (a, b) => dnsStatus(a).localeCompare(dnsStatus(b)) },
];

// Warn a couple of weeks before a token stops working.
const expiresSoon = (d: DnsConnector) => d.tokenExpiresOn && new Date(d.tokenExpiresOn).getTime() - Date.now() < 14 * 86400_000;

export const DnsConnectorTab: React.FC<ConnectorTabProps<DnsConnector>> = ({ collection, canManage }) => {
  const [zonesFor, setZonesFor] = useState<DnsConnector | null>(null);
  const tab = useConnectorTab(collection, {
    testSaved: dnsApi.testSaved,
    setDefault: dnsApi.setDefault,
    remove: (id, force) => dnsApi.remove(id, force),
  });

  const list = useListQuery(collection.items, {
    searchText: (d) => `${d.name} ${d.zones.join(' ')} ${d.accountId}`,
    status: dnsStatus,
    sortOptions: SORT_OPTIONS,
    syncWithUrl: true,
  });

  const columns: DataColumn<DnsConnector>[] = [
    {
      key: 'connector',
      header: 'Connector',
      render: (d) => (
        <div className="flex items-center gap-3 min-w-[200px]">
          <ConnectorLogoTile kind="dns" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-slate-900 truncate">{d.name}</span>
              {d.isDefault && <DefaultBadge />}
            </div>
            <div className="text-[11px] text-slate-500">Cloudflare DNS{d.accountId ? ` · account ${d.accountId.slice(0, 8)}…` : ''}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'zones',
      header: 'Zones',
      render: (d) => (
        <div className="space-y-0.5 max-w-[260px]">
          <div className="inline-flex items-center gap-1 text-slate-800">
            <Globe2 size={12} className="text-orange-500" aria-hidden />
            <span className="font-semibold">{d.zoneCount}</span> visible
          </div>
          <div className="text-[11px] text-slate-500 font-mono truncate" title={d.zones.join(', ')}>
            {d.zones.length ? `limited to ${d.zones.join(', ')}` : 'all zones of the token'}
          </div>
        </div>
      ),
    },
    {
      key: 'token',
      header: 'Token',
      render: (d) => (
        <div className="space-y-0.5">
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-600">
            <KeyRound size={12} className="text-orange-500" aria-hidden />
            {d.tokenHint || '—'}
          </span>
          {d.tokenExpiresOn && (
            <div className={`text-[11px] ${expiresSoon(d) ? 'text-amber-700 font-semibold' : 'text-slate-500'}`} title={formatDateTime(d.tokenExpiresOn)}>
              Expires {d.tokenExpiresOn.slice(0, 10)}
            </div>
          )}
          {d.capabilities && (
            <div className="flex flex-wrap gap-1 pt-0.5" aria-label="What the token can read">
              {(
                [
                  ['Zones', d.capabilities.zoneRead],
                  ['DNS', d.capabilities.dnsRead],
                  ['Settings', d.capabilities.settingsRead],
                  ['Tunnels', d.capabilities.tunnelRead],
                ] as [string, boolean | null][]
              )
                .filter(([, v]) => v !== null)
                .map(([label, v]) => (
                  <span
                    key={label}
                    className={`px-1 rounded border text-[10px] font-semibold ${v ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700 line-through'}`}
                    title={v ? `The token can read ${label.toLowerCase()}` : `The token cannot read ${label.toLowerCase()}`}
                  >
                    {label}
                  </span>
                ))}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (d) => <ConnectorStatusCell status={dnsStatus(d)} checkedAt={d.lastTestedAt} error={d.lastError} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      headerClassName: 'text-right',
      className: 'text-right',
      render: (d) => (
        <ConnectorRowActions
          name={d.name}
          isDefault={d.isDefault}
          isTesting={tab.testingId === d._id}
          canManage={canManage}
          onTest={() => tab.handleTest(d)}
          onEdit={() => tab.openEdit(d)}
          onSetDefault={() => tab.handleSetDefault(d)}
          onDelete={() => tab.requestDelete(d)}
          extra={<IconAction label={`Browse zones and records for ${d.name}`} onClick={() => setZonesFor(d)} icon={<ListChecks size={14} />} disabled={!d.isActive} />}
        />
      ),
    },
  ];

  return (
    <>
      <details className="group rounded-md border border-orange-200 bg-orange-50/60 text-xs">
        <summary className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer font-semibold text-slate-800 select-none">
          <Cloud size={14} className="text-orange-500" aria-hidden />
          How to create a Cloudflare API token
        </summary>
        <ol className="px-3.5 pb-3 pl-8 space-y-1 text-slate-700 list-decimal">
          <li>Cloudflare dashboard → My Profile → API Tokens → Create Token.</li>
          <li>
            Use the <strong>Edit zone DNS</strong> template. Permissions: <span className="font-mono">Zone → Zone → Read</span> and{' '}
            <span className="font-mono">Zone → DNS → Edit</span>.
          </li>
          <li>Zone Resources: include only the domains DevOps Intelligence should manage.</li>
          <li>
            For tunnels: also <span className="font-mono">Account → Cloudflare Tunnel → Edit</span>, and fill in the Account ID.
          </li>
          <li>
            Account-owned tokens (starting with <span className="font-mono">cfat_</span>) always need the Account ID.
          </li>
          <li>Optional: set an expiry date and restrict the client IP to this server.</li>
          <li>Copy the token (Cloudflare shows it once) and paste it here. Never use the Global API Key.</li>
        </ol>
      </details>

      <ConnectorListView
        collection={collection}
        list={list}
        columns={columns}
        rowKey={(d) => d._id}
        sortOptions={SORT_OPTIONS}
        statusOptions={STATUS_OPTIONS}
        searchPlaceholder="Search by name, zone or account"
        itemLabel="DNS connectors"
        addLabel="Add Cloudflare"
        canManage={canManage}
        onAdd={tab.openCreate}
        emptyIcon={<Cloud size={22} />}
        emptyTitle="No DNS connectors yet"
        emptyDescription="Connect Cloudflare with a scoped API token to see your zones and, next, give each environment a real hostname."
      />

      {tab.modal && (
        <DnsConnectorModal
          connector={tab.modal.mode === 'edit' ? tab.modal.item : null}
          isFirst={collection.items.length === 0}
          onClose={tab.closeModal}
          onSaved={tab.handleSaved}
        />
      )}

      {zonesFor && <DnsZonesModal connector={zonesFor} canManage={canManage} onClose={() => setZonesFor(null)} />}

      <DnsTunnelsSection connectors={collection.items} connectorsLoading={collection.isLoading} canManage={canManage} />

      <ConfirmDialog
        isOpen={Boolean(tab.deleteTarget)}
        title="Delete DNS connector?"
        message={
          <>
            <strong className="font-semibold">{tab.deleteTarget?.name}</strong> and its saved API token will be removed. Your DNS records in
            Cloudflare are not changed. Revoke the token in Cloudflare too if it is no longer needed.
          </>
        }
        confirmLabel="Delete connector"
        isLoading={tab.isDeleting}
        error={tab.deleteError}
        onConfirm={tab.confirmDelete}
        onCancel={tab.cancelDelete}
      />
    </>
  );
};
