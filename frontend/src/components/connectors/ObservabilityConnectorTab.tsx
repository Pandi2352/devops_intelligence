import React, { useCallback, useEffect, useState } from 'react';
import { Activity, CheckCircle2, ExternalLink, Plus, Radar, RefreshCw } from 'lucide-react';
import { DataColumn } from '../common/DataTable';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Dropdown } from '../common/Dropdown';
import { ConnectorListView } from './ConnectorListView';
import { ConnectorStatusCell } from './ConnectorStatus';
import { ConnectorRowActions, DefaultBadge } from './ConnectorRowActions';
import { ObservabilityConnectorModal } from './ObservabilityConnectorModal';
import { ObservabilityLogo, ObservabilityLogoTile } from './ObservabilityLogos';
import { ConnectorTabProps, useConnectorTab } from './useConnectorTab';
import { useListQuery, SortOption } from '../../hooks/useListQuery';
import { useToast } from '../../context/ToastContext';
import { clusterApi } from '../../api/clusterApi';
import { getApiErrorMessage } from '../../api/client';
import { DiscoveredService, ObservabilityConnector, ObservabilityKind, observabilityApi } from '../../api/observabilityApi';
import { Cluster } from '../../types';

const KIND_LABEL: Record<ObservabilityKind, string> = { prometheus: 'Prometheus', grafana: 'Grafana', loki: 'Loki' };
const KIND_USE: Record<ObservabilityKind, string> = { prometheus: 'Metrics', grafana: 'Dashboards', loki: 'Log history' };

const connectorStatus = (c: ObservabilityConnector) => (c.isActive ? c.status : 'Disabled');

// Status filter doubles as a kind filter: both are useful and the toolbar has one dropdown.
const STATUS_OPTIONS = ['Connected', 'Error', 'Unknown', 'Disabled'].map((s) => ({ value: s, label: s }));

const SORT_OPTIONS: SortOption<ObservabilityConnector>[] = [
  { value: 'kind', label: 'Kind', compare: (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) },
  { value: 'name', label: 'Name A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
  { value: 'recent', label: 'Recently updated', compare: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') },
  { value: 'status', label: 'Status', compare: (a, b) => connectorStatus(a).localeCompare(connectorStatus(b)) },
];

const accessLabel = (c: ObservabilityConnector) =>
  c.access === 'service' ? `${c.namespace}/${c.service}:${c.port}` : c.url;

// ---------------------------------------------------------------- discover

interface DiscoverModalProps {
  onClose: () => void;
  onAdded: (connector: ObservabilityConnector, message: string) => void;
}

const DiscoverModal: React.FC<DiscoverModalProps> = ({ onClose, onAdded }) => {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [cluster, setCluster] = useState('');
  const [services, setServices] = useState<DiscoveredService[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingKey, setAddingKey] = useState<string | null>(null);

  useEffect(() => {
    clusterApi
      .getAll()
      .then((list) => {
        setClusters(list);
        const preferred = list.find((c) => c.isDefault) || list[0];
        if (preferred) setCluster(preferred.name);
      })
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load clusters')));
  }, []);

  const scan = useCallback(async () => {
    if (!cluster) return;
    setServices(null);
    setError(null);
    try {
      setServices((await observabilityApi.discover(cluster)).services);
    } catch (err) {
      setServices([]);
      setError(getApiErrorMessage(err, 'Could not scan the cluster'));
    }
  }, [cluster]);

  useEffect(() => {
    scan();
  }, [scan]);

  const keyOf = (s: DiscoveredService) => `${s.namespace}/${s.service}:${s.port}`;

  const add = async (s: DiscoveredService) => {
    setAddingKey(keyOf(s));
    setError(null);
    try {
      const res = await observabilityApi.create({
        name: s.suggestedName,
        kind: s.kind,
        access: 'service',
        clusterName: s.clusterName,
        namespace: s.namespace,
        service: s.service,
        port: s.port,
        scheme: 'http',
        publicUrl: s.kind === 'grafana' ? 'http://localhost:3000' : '',
      });
      setServices((prev) => (prev || []).map((x) => (keyOf(x) === keyOf(s) ? { ...x, alreadyAdded: true } : x)));
      onAdded(res.connector, res.message);
    } catch (err) {
      setError(getApiErrorMessage(err, `Could not add ${s.service}`));
    } finally {
      setAddingKey(null);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      preventClose={Boolean(addingKey)}
      maxWidth="lg"
      icon={<Radar size={18} />}
      title="Discover in cluster"
      subtitle="Finds Prometheus, Grafana and Loki services. DevOps Intelligence reaches them through the cluster's service proxy, so no port-forward is needed."
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="space-y-3">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <div className="text-xs font-semibold text-slate-700 mb-1">Cluster</div>
            <Dropdown
              fullWidth
              mono
              ariaLabel="Cluster"
              value={cluster}
              onChange={setCluster}
              options={clusters.map((c) => ({ value: c.name, label: c.name, sublabel: c.status }))}
              placeholder={clusters.length ? 'Select cluster' : 'No cluster connectors'}
            />
          </div>
          <Button variant="secondary" onClick={scan} disabled={!cluster || services === null} leftIcon={<RefreshCw size={13} />}>
            Scan again
          </Button>
        </div>

        {error && (
          <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
            {error}
          </div>
        )}

        {services === null ? (
          <div className="py-6 text-center text-xs text-slate-500">Scanning services on {cluster}…</div>
        ) : services.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500">
            No Prometheus, Grafana or Loki services found on {cluster}. Install kube-prometheus-stack or Loki, or add a connector by URL.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-md">
            {services.map((s) => (
              <li key={keyOf(s)} className="flex items-center gap-3 px-3 py-2.5">
                <ObservabilityLogoTile kind={s.kind} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-800">
                    {KIND_LABEL[s.kind]} <span className="font-normal text-slate-500">· {KIND_USE[s.kind]}</span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-600 truncate">{keyOf(s)}</div>
                </div>
                {s.alreadyAdded ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                    <CheckCircle2 size={13} /> Added
                  </span>
                ) : (
                  <Button size="sm" leftIcon={<Plus size={13} />} isLoading={addingKey === keyOf(s)} disabled={Boolean(addingKey)} onClick={() => add(s)}>
                    Add
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-slate-500">
          Grafana links open in your browser, so they use <span className="font-mono">http://localhost:3000</span>. Run{' '}
          <span className="font-mono">kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80</span> or edit the connector's browser URL.
        </p>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------- tab

export const ObservabilityConnectorTab: React.FC<ConnectorTabProps<ObservabilityConnector>> = ({ collection, canManage }) => {
  const toast = useToast();
  const [discovering, setDiscovering] = useState(false);
  const tab = useConnectorTab(collection, {
    testSaved: observabilityApi.testSaved,
    setDefault: (id) => observabilityApi.update(id, { isDefault: true }),
    remove: async (id) => {
      await observabilityApi.remove(id);
    },
  });

  const list = useListQuery(collection.items, {
    searchText: (c) => `${c.name} ${c.kind} ${KIND_LABEL[c.kind]} ${accessLabel(c)} ${c.clusterName} ${c.publicUrl}`,
    status: connectorStatus,
    sortOptions: SORT_OPTIONS,
    syncWithUrl: true,
  });

  const columns: DataColumn<ObservabilityConnector>[] = [
    {
      key: 'connector',
      header: 'Connector',
      render: (c) => (
        <div className="flex items-center gap-3 min-w-[200px]">
          <ObservabilityLogoTile kind={c.kind} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-slate-900 truncate">{c.name}</span>
              {c.isDefault && <DefaultBadge />}
            </div>
            <div className="text-[11px] text-slate-500">{KIND_USE[c.kind]}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Kind',
      render: (c) => (
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-700">
          <ObservabilityLogo kind={c.kind} size={14} />
          {KIND_LABEL[c.kind]}
        </span>
      ),
    },
    {
      key: 'access',
      header: 'Reached through',
      render: (c) =>
        c.access === 'service' ? (
          <div className="text-[11px] min-w-[180px]">
            <div className="font-mono text-slate-800 break-all">{accessLabel(c)}</div>
            <div className="text-slate-500">
              service proxy on <span className="font-mono">{c.clusterName}</span>
            </div>
          </div>
        ) : (
          <div className="text-[11px] min-w-[160px]">
            <div className="font-mono text-slate-800 break-all">{c.url}</div>
            <div className="text-slate-500">direct URL{c.insecure ? ' · TLS not verified' : ''}</div>
          </div>
        ),
    },
    {
      key: 'browser',
      header: 'Browser URL',
      render: (c) =>
        c.publicUrl ? (
          <a
            href={c.publicUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-mono text-sky-700 hover:underline"
          >
            {c.publicUrl}
            <ExternalLink size={11} aria-hidden />
          </a>
        ) : (
          <span className="text-[11px] text-slate-400">{c.kind === 'grafana' ? 'not set' : '—'}</span>
        ),
    },
    {
      key: 'version',
      header: 'Version',
      render: (c) => <span className="font-mono text-xs text-slate-700">{c.version || '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => <ConnectorStatusCell status={connectorStatus(c)} checkedAt={c.lastTestedAt} error={c.lastError} />,
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
        rowKey={(c) => c._id}
        sortOptions={SORT_OPTIONS}
        statusOptions={STATUS_OPTIONS}
        searchPlaceholder="Search by name, kind, service or URL"
        itemLabel="observability connectors"
        addLabel="Add connector"
        canManage={canManage}
        onAdd={tab.openCreate}
        toolbarExtra={
          canManage && (
            <Button size="sm" variant="secondary" onClick={() => setDiscovering(true)} leftIcon={<Radar size={14} />} className="h-8">
              Discover in cluster
            </Button>
          )
        }
        emptyIcon={<Activity size={22} />}
        emptyTitle="No observability connectors yet"
        emptyDescription="Add Prometheus for metrics, Loki for log history and Grafana for dashboards. Discover in cluster finds them for you."
      />

      {tab.modal && (
        <ObservabilityConnectorModal
          connector={tab.modal.mode === 'edit' ? tab.modal.item : null}
          onClose={tab.closeModal}
          onSaved={(item, message, ok) => tab.handleSaved(item, message, ok)}
        />
      )}

      {discovering && (
        <DiscoverModal
          onClose={() => setDiscovering(false)}
          onAdded={(item, message) => {
            collection.setItems((prev) => [item, ...prev.filter((p) => p._id !== item._id)]);
            if (item.status === 'Connected') toast.success(message);
            else toast.error(message);
            collection.reload();
          }}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(tab.deleteTarget)}
        title="Delete observability connector?"
        message={
          <>
            <strong className="font-semibold">{tab.deleteTarget?.name}</strong> and any saved credentials will be removed. The Logs and
            Metrics pages will stop using it; the service in the cluster is not touched.
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
