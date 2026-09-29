import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Check, Copy, ExternalLink, KeyRound, Plus, Radar, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { DataColumn } from '../common/DataTable';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Dropdown } from '../common/Dropdown';
import { ConnectorListView } from './ConnectorListView';
import { ConnectorLogoTile } from './ConnectorLogos';
import { ConnectorStatusCell } from './ConnectorStatus';
import { ConnectorRowActions, DefaultBadge } from './ConnectorRowActions';
import { SonarConnectorModal } from './SonarConnectorModal';
import { ConnectorTabProps, useConnectorTab } from './useConnectorTab';
import { useListQuery, SortOption } from '../../hooks/useListQuery';
import { clusterApi } from '../../api/clusterApi';
import { getApiErrorMessage } from '../../api/client';
import { DiscoveredSonar, SonarConnector, TrivyClusterStatus, securityApi, sonarStatus } from '../../api/securityApi';
import { Cluster } from '../../types';

const STATUS_OPTIONS = ['Connected', 'Error', 'Unknown', 'Disabled'].map((s) => ({ value: s, label: s }));

const SORT_OPTIONS: SortOption<SonarConnector>[] = [
  { value: 'name', label: 'Name A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
  { value: 'name-desc', label: 'Name Z–A', compare: (a, b) => b.name.localeCompare(a.name) },
  { value: 'recent', label: 'Recently updated', compare: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') },
  { value: 'status', label: 'Status', compare: (a, b) => sonarStatus(a).localeCompare(sonarStatus(b)) },
];

const serviceLabel = (c: { namespace: string; service: string; port: number }) => `${c.namespace}/${c.service}:${c.port}`;

// Where the "Open SonarQube" link goes: the browser URL, or the direct URL when DevOps Intelligence uses one.
const browserUrl = (c: SonarConnector) => c.publicUrl || (c.access === 'url' ? c.url : '');

const TRIVY_INSTALL = `helm repo add aqua https://aquasecurity.github.io/helm-charts/
helm install trivy-operator aqua/trivy-operator -n trivy-system --create-namespace -f devops-demo/platform/trivy-operator-values.yaml`;

// ---------------------------------------------------------------- copyable code

const CodeBlock: React.FC<{ code: string; label: string }> = ({ code, label }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the commands are still visible */
    }
  };
  return (
    <div className="relative">
      <pre className="p-2.5 pr-10 rounded-md bg-slate-900 text-slate-100 text-[11px] font-mono leading-relaxed overflow-x-auto whitespace-pre">{code}</pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : `Copy ${label}`}
        title={copied ? 'Copied' : `Copy ${label}`}
        className="absolute top-1.5 right-1.5 h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 cursor-pointer"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
};

// ---------------------------------------------------------------- discover

interface DiscoverModalProps {
  onClose: () => void;
  onPick: (service: DiscoveredSonar) => void;
}

const DiscoverModal: React.FC<DiscoverModalProps> = ({ onClose, onPick }) => {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [cluster, setCluster] = useState('');
  const [services, setServices] = useState<DiscoveredSonar[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    clusterApi
      .getAll()
      .then((list) => {
        setClusters(list);
        const preferred = list.find((c) => c.isDefault) || list[0];
        if (preferred) setCluster(preferred.name);
        else setServices([]);
      })
      .catch((err) => {
        setServices([]);
        setError(getApiErrorMessage(err, 'Could not load clusters'));
      });
  }, []);

  const scan = useCallback(async () => {
    if (!cluster) return;
    setServices(null);
    setError(null);
    try {
      setServices((await securityApi.discoverSonar(cluster)).services);
    } catch (err) {
      setServices([]);
      setError(getApiErrorMessage(err, 'Could not scan the cluster'));
    }
  }, [cluster]);

  useEffect(() => {
    scan();
  }, [scan]);

  return (
    <Modal
      isOpen
      onClose={onClose}
      maxWidth="lg"
      icon={<Radar size={18} />}
      title="Discover SonarQube in cluster"
      subtitle="Finds SonarQube services. DevOps Intelligence reaches them through the cluster's service proxy, so no port-forward is needed."
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
          <Button
            variant="secondary"
            onClick={scan}
            disabled={!cluster || services === null}
            title={!cluster ? 'Pick a cluster first' : services === null ? 'Scanning…' : undefined}
            leftIcon={<RefreshCw size={13} />}
          >
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
            {cluster ? (
              <>
                No SonarQube service found on {cluster}. Run <span className="font-mono">kubectl apply -f devops-demo/platform/sonarqube.yaml</span> or add a
                connector by URL.
              </>
            ) : (
              'Add a Kubernetes cluster connector first.'
            )}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-md">
            {services.map((s) => (
              <li key={serviceLabel(s)} className="flex items-center gap-3 px-3 py-2.5">
                <ConnectorLogoTile kind="security" size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-800">{s.suggestedName}</div>
                  <div className="text-[11px] font-mono text-slate-600 truncate">{serviceLabel(s)}</div>
                </div>
                {s.alreadyAdded ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                    <CheckCircle2 size={13} /> Added
                  </span>
                ) : (
                  <Button size="sm" leftIcon={<Plus size={13} />} onClick={() => onPick(s)}>
                    Add
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-slate-500">Add opens the connector form with the service filled in; you still need a SonarQube token.</p>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------- Trivy Operator

const TrivyCard: React.FC<{ status: TrivyClusterStatus }> = ({ status: t }) => (
  <li className="bg-white border border-slate-200 rounded-md p-3.5 space-y-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="font-semibold text-sm text-slate-900 font-mono truncate">{t.cluster}</div>
        <div className="text-[11px] text-slate-500">Trivy Operator{t.namespace ? ` · namespace ${t.namespace}` : ''}</div>
      </div>
      {t.installed ? (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-semibold bg-emerald-50 text-emerald-700 border-emerald-200">
          <CheckCircle2 size={12} aria-hidden /> Installed
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-semibold bg-slate-100 text-slate-600 border-slate-200">
          <XCircle size={12} aria-hidden /> Not installed
        </span>
      )}
    </div>

    {t.installed && (
      <dl className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Ready</dt>
          <dd className={`font-semibold ${t.ready ? 'text-emerald-700' : 'text-amber-700'}`}>{t.ready ? 'Yes' : 'Not ready'}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Version</dt>
          <dd className="font-mono text-slate-800">{t.version || '—'}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Image reports</dt>
          <dd className="font-semibold text-slate-900">{t.reports}</dd>
        </div>
      </dl>
    )}

    {t.error && (
      <p className="text-[11px] text-rose-700 leading-snug" role="alert">
        {t.error}
      </p>
    )}

    {!t.installed && (
      <div className="space-y-1.5">
        <div className="text-[11px] text-slate-600">Install it on this cluster:</div>
        <CodeBlock code={TRIVY_INSTALL} label="Trivy Operator install commands" />
      </div>
    )}
  </li>
);

const TrivySection: React.FC = () => {
  const [clusters, setClusters] = useState<TrivyClusterStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setClusters(await securityApi.trivy());
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load Trivy Operator status'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="space-y-3 pt-2" aria-labelledby="trivy-heading">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 id="trivy-heading" className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck size={15} className="text-emerald-600" aria-hidden />
            Trivy Operator
          </h2>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            Trivy Operator scans the images running in each cluster for known vulnerabilities. No credentials needed: DevOps Intelligence reads the
            reports Trivy stores in the cluster.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={load}
          disabled={isLoading}
          title={isLoading ? 'Loading…' : undefined}
          leftIcon={<RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />}
          className="h-8 shrink-0"
        >
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
          {error}
        </div>
      ) : isLoading && !clusters.length ? (
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-2.5" aria-busy="true" aria-label="Loading Trivy Operator status">
          {[0, 1].map((i) => (
            <li key={i} className="bg-white border border-slate-200 rounded-md p-3.5 space-y-2.5 animate-pulse">
              <div className="h-4 w-40 bg-slate-200 rounded" />
              <div className="h-3 w-64 bg-slate-100 rounded" />
            </li>
          ))}
        </ul>
      ) : !clusters.length ? (
        <div className="p-3 rounded-md border border-slate-200 bg-white text-xs text-slate-600">
          No clusters yet. Add a Kubernetes cluster connector to see its Trivy Operator status.
        </div>
      ) : (
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          {clusters.map((t) => (
            <TrivyCard key={t.cluster} status={t} />
          ))}
        </ul>
      )}
    </section>
  );
};

// ---------------------------------------------------------------- help

const SonarHelp: React.FC = () => (
  <details className="group rounded-md border border-emerald-200 bg-emerald-50/60 text-xs">
    <summary className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer font-semibold text-slate-800 select-none">
      <ShieldCheck size={14} className="text-emerald-600" aria-hidden />
      Run SonarQube locally
    </summary>
    <div className="px-3.5 pb-3 space-y-2 text-slate-700">
      <ol className="pl-4.5 space-y-1.5 list-decimal">
        <li>
          Deploy it: <span className="font-mono">kubectl apply -f devops-demo/platform/sonarqube.yaml</span>
        </li>
        <li>
          Open the UI: <span className="font-mono">kubectl -n sonarqube port-forward svc/sonarqube 9000:9000</span>, then{' '}
          <span className="font-mono">http://localhost:9000</span>. First login is <span className="font-mono">admin</span> /{' '}
          <span className="font-mono">admin</span>; you are asked to change it.
        </li>
        <li>
          Create a token: My Account → Security → Generate token, type <strong>User token</strong>.
        </li>
        <li>
          Add SonarQube → Through the cluster → cluster <span className="font-mono">minikube</span>, namespace{' '}
          <span className="font-mono">sonarqube</span>, service <span className="font-mono">sonarqube</span>, port{' '}
          <span className="font-mono">9000</span>. Browser URL <span className="font-mono">http://localhost:9000</span>.
        </li>
      </ol>
      <p className="text-[11px] text-slate-600 leading-relaxed">
        SonarQube Community Build is free. It analyses the main branch only; branch and merge request analysis needs a paid edition. SonarCloud
        (free for public repositories) also works: choose access URL <span className="font-mono">https://sonarcloud.io</span> and fill in your
        organization.
      </p>
    </div>
  </details>
);

// ---------------------------------------------------------------- tab

export const SecurityConnectorTab: React.FC<ConnectorTabProps<SonarConnector>> = ({ collection, canManage }) => {
  const [discovering, setDiscovering] = useState(false);
  const [prefill, setPrefill] = useState<DiscoveredSonar | null>(null);
  const tab = useConnectorTab(collection, {
    testSaved: securityApi.testSavedSonar,
    setDefault: securityApi.setDefaultSonar,
    remove: (id, force) => securityApi.removeSonar(id, force),
  });

  const list = useListQuery(collection.items, {
    searchText: (c) => `${c.name} ${c.clusterName} ${serviceLabel(c)} ${c.url} ${c.publicUrl} ${c.organization} ${c.version}`,
    status: sonarStatus,
    sortOptions: SORT_OPTIONS,
    syncWithUrl: true,
  });

  const closeModal = () => {
    tab.closeModal();
    setPrefill(null);
  };

  const columns: DataColumn<SonarConnector>[] = [
    {
      key: 'connector',
      header: 'Connector',
      render: (c) => (
        <div className="flex items-center gap-3 min-w-[200px]">
          <ConnectorLogoTile kind="security" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-slate-900 truncate">{c.name}</span>
              {c.isDefault && <DefaultBadge />}
            </div>
            <div className="text-[11px] text-slate-500">SonarQube{c.organization ? ` · org ${c.organization}` : ''}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'access',
      header: 'Reached through',
      render: (c) =>
        c.access === 'service' ? (
          <div className="text-[11px] min-w-[180px]">
            <div className="text-slate-500">
              Through cluster <span className="font-mono text-slate-700">{c.clusterName}</span>
            </div>
            <div className="font-mono text-slate-800 break-all">{serviceLabel(c)}</div>
          </div>
        ) : (
          <div className="text-[11px] min-w-[160px]">
            <div className="font-mono text-slate-800 break-all">{c.url}</div>
            <div className="text-slate-500">direct URL</div>
          </div>
        ),
    },
    {
      key: 'version',
      header: 'Version',
      render: (c) => <span className="font-mono text-xs text-slate-700">{c.version || '—'}</span>,
    },
    {
      key: 'token',
      header: 'Token',
      render: (c) => (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-600">
          <KeyRound size={12} className="text-emerald-600" aria-hidden />
          {c.hasToken ? c.tokenHint || 'saved' : 'none'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => <ConnectorStatusCell status={sonarStatus(c)} checkedAt={c.lastTestedAt} error={c.lastError} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      headerClassName: 'text-right',
      className: 'text-right',
      render: (c) => {
        const href = browserUrl(c);
        return (
          <ConnectorRowActions
            name={c.name}
            isDefault={c.isDefault}
            isTesting={tab.testingId === c._id}
            canManage={canManage}
            onTest={() => tab.handleTest(c)}
            onEdit={() => tab.openEdit(c)}
            onSetDefault={() => tab.handleSetDefault(c)}
            onDelete={() => tab.requestDelete(c)}
            extra={
              href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open SonarQube ${c.name}`}
                  title={`Open SonarQube (${href})`}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:text-sky-700 hover:bg-sky-50 hover:border-sky-200"
                >
                  <ExternalLink size={14} />
                </a>
              ) : null
            }
          />
        );
      },
    },
  ];

  return (
    <>
      <SonarHelp />

      <section className="space-y-3" aria-labelledby="sonar-heading">
        <h2 id="sonar-heading" className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <ShieldCheck size={15} className="text-emerald-600" aria-hidden />
          SonarQube
        </h2>
        <ConnectorListView
          collection={collection}
          list={list}
          columns={columns}
          rowKey={(c) => c._id}
          sortOptions={SORT_OPTIONS}
          statusOptions={STATUS_OPTIONS}
          searchPlaceholder="Search by name, cluster, service or URL"
          itemLabel="SonarQube connectors"
          addLabel="Add SonarQube"
          canManage={canManage}
          onAdd={tab.openCreate}
          toolbarExtra={
            canManage && (
              <Button size="sm" variant="secondary" onClick={() => setDiscovering(true)} leftIcon={<Radar size={14} />} className="h-8">
                Discover in cluster
              </Button>
            )
          }
          emptyIcon={<ShieldCheck size={22} />}
          emptyTitle="No SonarQube connectors yet"
          emptyDescription="Connect SonarQube to show code quality and block releases that fail the quality gate. Discover in cluster finds a SonarQube running in your cluster."
        />
      </section>

      <TrivySection />

      {tab.modal && (
        <SonarConnectorModal
          connector={tab.modal.mode === 'edit' ? tab.modal.item : null}
          prefill={tab.modal.mode === 'create' ? prefill : null}
          isFirst={collection.items.length === 0}
          onClose={closeModal}
          onSaved={(item, message, ok) => {
            setPrefill(null);
            tab.handleSaved(item, message, ok);
          }}
        />
      )}

      {discovering && (
        <DiscoverModal
          onClose={() => setDiscovering(false)}
          onPick={(s) => {
            setDiscovering(false);
            setPrefill(s);
            tab.openCreate();
          }}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(tab.deleteTarget)}
        title="Delete SonarQube connector?"
        message={
          <>
            <strong className="font-semibold">{tab.deleteTarget?.name}</strong> and its saved token will be removed. Projects stop showing its
            quality gate; SonarQube itself is not touched.
          </>
        }
        confirmLabel={tab.forceDelete ? 'Delete anyway' : 'Delete connector'}
        isLoading={tab.isDeleting}
        error={tab.deleteError}
        onConfirm={tab.confirmDelete}
        onCancel={tab.cancelDelete}
      />
    </>
  );
};
