import React, { useState } from 'react';
import { RefreshCw, Server } from 'lucide-react';
import { DataColumn } from '../common/DataTable';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Button } from '../common/Button';
import { ConnectorListView } from './ConnectorListView';
import { ConnectorLogoTile } from './ConnectorLogos';
import { ConnectorStatusCell } from './ConnectorStatus';
import { ConnectorRowActions, DefaultBadge } from './ConnectorRowActions';
import { ClusterConnectorModal } from './ClusterConnectorModal';
import { ConnectorTabProps, useConnectorTab } from './useConnectorTab';
import { useListQuery, SortOption } from '../../hooks/useListQuery';
import { useToast } from '../../context/ToastContext';
import { clusterApi } from '../../api/clusterApi';
import { getApiErrorMessage } from '../../api/client';
import { Cluster } from '../../types';
import { hostFromUrl } from '../../utils/format';

const TYPE_LABEL: Record<string, string> = {
  minikube: 'Minikube',
  local: 'Local',
  eks: 'AWS EKS',
  gke: 'Google GKE',
  aks: 'Azure AKS',
  baremetal: 'Bare metal',
};

const AUTH_LABEL: Record<string, string> = {
  context: 'Kubeconfig context',
  kubeconfig: 'Kubeconfig file',
  token: 'Bearer token',
};

const STATUS_OPTIONS = ['Healthy', 'Degraded', 'Offline', 'Connecting'].map((s) => ({ value: s, label: s }));

const SORT_OPTIONS: SortOption<Cluster>[] = [
  { value: 'name', label: 'Name A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
  { value: 'name-desc', label: 'Name Z–A', compare: (a, b) => b.name.localeCompare(a.name) },
  { value: 'recent', label: 'Recently updated', compare: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') },
  { value: 'status', label: 'Status', compare: (a, b) => a.status.localeCompare(b.status) },
  { value: 'nodes', label: 'Most nodes', compare: (a, b) => (b.nodeCount || 0) - (a.nodeCount || 0) },
];

export const ClusterConnectorTab: React.FC<ConnectorTabProps<Cluster>> = ({ collection, canManage }) => {
  const toast = useToast();
  const [isSyncing, setIsSyncing] = useState(false);
  const tab = useConnectorTab(collection, {
    testSaved: clusterApi.testSaved,
    setDefault: clusterApi.setDefault,
    remove: clusterApi.delete,
  });

  const list = useListQuery(collection.items, {
    searchText: (c) => `${c.name} ${c.contextName} ${c.serverUrl} ${c.type} ${c.description || ''}`,
    status: (c) => c.status,
    sortOptions: SORT_OPTIONS,
    syncWithUrl: true,
  });

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const synced = await clusterApi.syncKubeconfig();
      collection.setItems(synced);
      toast.success(`Synced ${synced.length} cluster(s) from the server's kubeconfig`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Kubeconfig sync failed'));
    } finally {
      setIsSyncing(false);
    }
  };

  const columns: DataColumn<Cluster>[] = [
    {
      key: 'cluster',
      header: 'Cluster',
      render: (c) => (
        <div className="flex items-center gap-3 min-w-[200px]">
          <ConnectorLogoTile kind="clusters" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-slate-900 font-mono truncate">{c.name}</span>
              {c.isDefault && <DefaultBadge />}
            </div>
            <div className="text-[11px] text-slate-500 truncate max-w-[260px]" title={c.description || c.contextName}>
              {c.description || `${TYPE_LABEL[c.type] || c.type}${c.contextName && c.contextName !== c.name ? ` · ${c.contextName}` : ''}`}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'auth',
      header: 'Connection',
      render: (c) => (
        <div className="space-y-0.5">
          <div className="text-slate-800">{AUTH_LABEL[c.authType || 'context']}</div>
          <div className="text-[11px] text-slate-500 font-mono truncate max-w-[220px]" title={c.serverUrl}>
            {hostFromUrl(c.serverUrl) || '—'}
          </div>
          {c.source === 'kubeconfig' && (
            <span className="inline-block px-1.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
              Discovered
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'capacity',
      header: 'Nodes · Version',
      render: (c) => (
        <div className="font-mono text-[11px] text-slate-700 space-y-0.5">
          <div>{c.status === 'Healthy' ? `${c.nodeCount} node${c.nodeCount === 1 ? '' : 's'}` : '—'}</div>
          <div className="text-slate-500">{c.version && c.version !== 'unknown' ? c.version : '—'}</div>
        </div>
      ),
    },
    {
      key: 'namespaces',
      header: 'Namespaces',
      render: (c) => <span className="font-mono text-slate-700">{c.namespaces?.length || 0}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => <ConnectorStatusCell status={c.status} checkedAt={c.lastTestedAt || c.lastSyncedAt} error={c.lastError} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      headerClassName: 'text-right',
      className: 'text-right',
      render: (c) => (
        <ConnectorRowActions
          name={c.name}
          isDefault={c.isDefault}
          isTesting={tab.testingId === c._id}
          canManage={canManage}
          onTest={() => tab.handleTest(c)}
          onEdit={() => tab.openEdit(c)}
          onSetDefault={() => tab.handleSetDefault(c)}
          onDelete={() => tab.requestDelete(c)}
        />
      ),
    },
  ];

  return (
    <>
      <ConnectorListView
        collection={collection}
        list={list}
        columns={columns}
        rowKey={(c) => c._id || c.name}
        sortOptions={SORT_OPTIONS}
        statusOptions={STATUS_OPTIONS}
        searchPlaceholder="Search by name, context or server"
        itemLabel="clusters"
        addLabel="Add cluster"
        canManage={canManage}
        onAdd={tab.openCreate}
        toolbarExtra={
          canManage && (
            <Button
              size="sm"
              variant="secondary"
              className="h-8"
              onClick={handleSync}
              isLoading={isSyncing}
              leftIcon={<RefreshCw size={13} />}
              title="Import and re-check every context in the server's ~/.kube/config"
            >
              Sync kubeconfig
            </Button>
          )
        }
        emptyIcon={<Server size={22} />}
        emptyTitle="No clusters connected"
        emptyDescription="Sync contexts from the server's kubeconfig (e.g. minikube), or add a cluster with a kubeconfig file or a ServiceAccount token."
      />

      {tab.modal && (
        <ClusterConnectorModal
          connector={tab.modal.mode === 'edit' ? tab.modal.item : null}
          isFirst={collection.items.length === 0}
          onClose={tab.closeModal}
          onSaved={tab.handleSaved}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(tab.deleteTarget)}
        title="Remove cluster?"
        message={
          <>
            <strong className="font-mono font-semibold">{tab.deleteTarget?.name}</strong> and its saved credentials will be removed
            from KubeOrbit. The cluster itself is not affected.
            {tab.deleteTarget?.source === 'kubeconfig' && (
              <span className="block mt-2 text-xs text-slate-500">
                It is still in the server's kubeconfig, so it will come back on the next sync.
              </span>
            )}
          </>
        }
        confirmLabel={tab.forceDelete ? 'Remove anyway' : 'Remove cluster'}
        isLoading={tab.isDeleting}
        error={tab.deleteError}
        onConfirm={tab.confirmDelete}
        onCancel={tab.cancelDelete}
      />
    </>
  );
};
