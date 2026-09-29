import React from 'react';
import { Terminal, Workflow } from 'lucide-react';
import { DataColumn } from '../common/DataTable';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ConnectorListView } from './ConnectorListView';
import { ConnectorLogoTile } from './ConnectorLogos';
import { ConnectorStatusCell } from './ConnectorStatus';
import { ConnectorRowActions, DefaultBadge } from './ConnectorRowActions';
import { ArgoConnectorModal } from './ArgoConnectorModal';
import { ConnectorTabProps, useConnectorTab } from './useConnectorTab';
import { useListQuery, SortOption } from '../../hooks/useListQuery';
import { argoApi } from '../../api/argoApi';
import { ArgoIntegration } from '../../types';

const STATUS_OPTIONS = ['Connected', 'Error', 'Disconnected'].map((s) => ({ value: s, label: s }));

const SORT_OPTIONS: SortOption<ArgoIntegration>[] = [
  { value: 'name', label: 'Name A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
  { value: 'name-desc', label: 'Name Z–A', compare: (a, b) => b.name.localeCompare(a.name) },
  { value: 'recent', label: 'Recently updated', compare: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') },
  { value: 'status', label: 'Status', compare: (a, b) => a.status.localeCompare(b.status) },
];

const authSummary = (a: ArgoIntegration) => {
  if (a.authType === 'password') return `User ${a.username || 'admin'}`;
  if (a.authType === 'none') return 'Anonymous';
  return a.hasToken ? `Token ${a.tokenHint || ''}` : 'Token (missing)';
};

export const ArgoConnectorTab: React.FC<ConnectorTabProps<ArgoIntegration>> = ({ collection, canManage }) => {
  const tab = useConnectorTab(collection, {
    testSaved: argoApi.testSaved,
    setDefault: argoApi.setDefaultConnector,
    remove: (id) => argoApi.deleteConnector(id),
  });

  const list = useListQuery(collection.items, {
    searchText: (a) => `${a.name} ${a.serverUrl} ${a.username || ''}`,
    status: (a) => a.status,
    sortOptions: SORT_OPTIONS,
    syncWithUrl: true,
  });

  const columns: DataColumn<ArgoIntegration>[] = [
    {
      key: 'instance',
      header: 'Instance',
      render: (a) => (
        <div className="flex items-center gap-3 min-w-[200px]">
          <ConnectorLogoTile kind="argocd" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-slate-900 truncate">{a.name}</span>
              {a.isDefault && <DefaultBadge />}
            </div>
            <a
              href={a.serverUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-slate-500 hover:text-sky-700 hover:underline font-mono"
            >
              {a.serverUrl}
            </a>
          </div>
        </div>
      ),
    },
    {
      key: 'auth',
      header: 'Authentication',
      render: (a) => (
        <div className="space-y-0.5">
          <div className="font-mono text-[11px] text-slate-700">{authSummary(a)}</div>
          {a.insecure && <div className="text-[11px] text-amber-700">TLS verification off</div>}
        </div>
      ),
    },
    {
      key: 'version',
      header: 'Version',
      render: (a) => <span className="font-mono text-[11px] text-slate-700">{a.version && a.version !== 'unknown' ? a.version : '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (a) => <ConnectorStatusCell status={a.status} checkedAt={a.lastPingAt} error={a.lastError} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      headerClassName: 'text-right',
      className: 'text-right',
      render: (a) => (
        <ConnectorRowActions
          name={a.name}
          isDefault={a.isDefault}
          isTesting={tab.testingId === a._id}
          canManage={canManage}
          onTest={() => tab.handleTest(a)}
          onEdit={() => tab.openEdit(a)}
          onSetDefault={() => tab.handleSetDefault(a)}
          onDelete={() => tab.requestDelete(a)}
        />
      ),
    },
  ];

  return (
    <>
      <details className="group rounded-md border border-sky-200 bg-sky-50 text-xs">
        <summary className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer font-semibold text-slate-800 select-none">
          <Terminal size={14} className="text-sky-600" aria-hidden />
          Running ArgoCD inside Minikube?
        </summary>
        <div className="px-3.5 pb-3 space-y-2 text-slate-700">
          <p>Expose the API server locally, then add it here with server URL https://localhost:8080 and TLS verification off:</p>
          <code className="block px-2 py-1.5 rounded bg-white border border-sky-200 font-mono text-[11px] text-sky-900 overflow-x-auto">
            kubectl port-forward svc/argocd-server -n argocd 8080:443
          </code>
          <p>Initial admin password:</p>
          <code className="block px-2 py-1.5 rounded bg-white border border-sky-200 font-mono text-[11px] text-sky-900 overflow-x-auto">
            kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{'{'}.data.password{'}'}" | base64 -d
          </code>
        </div>
      </details>

      <ConnectorListView
        collection={collection}
        list={list}
        columns={columns}
        rowKey={(a) => String(a._id || a.id)}
        sortOptions={SORT_OPTIONS}
        statusOptions={STATUS_OPTIONS}
        searchPlaceholder="Search by name or server URL"
        itemLabel="ArgoCD instances"
        addLabel="Add ArgoCD"
        canManage={canManage}
        onAdd={tab.openCreate}
        emptyIcon={<Workflow size={22} />}
        emptyTitle="No ArgoCD instances"
        emptyDescription="Connect an ArgoCD API server to list and sync GitOps applications."
      />

      {tab.modal && (
        <ArgoConnectorModal
          connector={tab.modal.mode === 'edit' ? tab.modal.item : null}
          isFirst={collection.items.length === 0}
          onClose={tab.closeModal}
          onSaved={tab.handleSaved}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(tab.deleteTarget)}
        title="Delete ArgoCD instance?"
        message={
          <>
            <strong className="font-semibold">{tab.deleteTarget?.name}</strong> and its saved credentials will be removed. Applications
            in ArgoCD are not affected.
          </>
        }
        confirmLabel="Delete instance"
        isLoading={tab.isDeleting}
        error={tab.deleteError}
        onConfirm={tab.confirmDelete}
        onCancel={tab.cancelDelete}
      />
    </>
  );
};
