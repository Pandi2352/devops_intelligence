import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Box, ExternalLink, Network, Plus, RefreshCw, RotateCw, Trash2 } from 'lucide-react';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { EmptyState } from '../common/EmptyState';
import { FormField } from '../common/Form';
import { IconAction } from './ConnectorRowActions';
import { DnsTunnelModal } from './DnsTunnelModal';
import { selectClass, tunnelStatusClass } from './dnsHelpers';
import { dnsApi, CloudflareTunnel, DnsConnector } from '../../api/dnsApi';
import { getApiErrorMessage, getApiErrorStatus } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { formatDateTime, formatRelativeTime } from '../../utils/format';

interface DnsTunnelsSectionProps {
  connectors: DnsConnector[];
  connectorsLoading: boolean;
  canManage: boolean;
}

const TunnelCard: React.FC<{
  tunnel: CloudflareTunnel;
  connectorName: string;
  canManage: boolean;
  onRedeploy: () => void;
  onDelete: () => void;
}> = ({ tunnel: t, connectorName, canManage, onRedeploy, onDelete }) => {
  const readyPods = t.pods.filter((p) => p.ready).length;
  const restarts = t.pods.reduce((sum, p) => sum + p.restarts, 0);
  const reasons = [...new Set(t.pods.map((p) => p.reason).filter(Boolean))];
  const podsOk = t.pods.length > 0 && readyPods === t.pods.length;
  return (
    <li className="bg-white border border-slate-200 rounded-md p-3.5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Network size={14} className="text-orange-500 shrink-0" aria-hidden />
            <span className="font-semibold text-sm text-slate-900 font-mono truncate">{t.name}</span>
            <span
              className={`inline-flex px-1.5 py-0.5 rounded border text-[11px] font-semibold ${tunnelStatusClass(t.status)}`}
              title={t.lastCheckedAt ? `Checked ${formatDateTime(t.lastCheckedAt)}` : 'Cloudflare tunnel status'}
            >
              {t.status || 'unknown'}
            </span>
            {!t.deployed && (
              <span className="inline-flex px-1.5 py-0.5 rounded border text-[11px] font-semibold bg-slate-100 text-slate-600 border-slate-200" title="cloudflared has not been deployed to the cluster">
                not deployed
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            <span className="font-mono">{t.clusterName}</span> / <span className="font-mono">{t.namespace}</span> · {connectorName} ·{' '}
            <span className="font-mono" title="Cloudflare tunnel ID">
              {t.tunnelId.slice(0, 8)}…
            </span>
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-1.5 shrink-0">
            <IconAction label={`Redeploy tunnel ${t.name}`} onClick={onRedeploy} icon={<RotateCw size={14} />} />
            <IconAction label={`Delete tunnel ${t.name}`} onClick={onDelete} icon={<Trash2 size={14} />} tone="danger" />
          </div>
        )}
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Connections</dt>
          <dd className={`font-semibold ${t.connections ? 'text-slate-900' : 'text-slate-500'}`}>{t.connections}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">cloudflared pods</dt>
          <dd className="space-y-0.5">
            <span className={`inline-flex items-center gap-1 font-semibold ${podsOk ? 'text-emerald-700' : t.pods.length ? 'text-amber-700' : 'text-slate-500'}`}>
              <Box size={12} aria-hidden />
              {readyPods}/{t.pods.length || t.replicas} ready
            </span>
            {restarts > 0 && <div className="text-[11px] text-slate-500">{restarts} restarts</div>}
            {reasons.map((r) => (
              <div key={r} className="text-[11px] font-mono text-rose-700">
                {r}
              </div>
            ))}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Routes</dt>
          <dd>
            {t.routes.length ? (
              <ul className="space-y-0.5">
                {t.routes.map((r) => (
                  <li key={r.hostname} className="flex items-center gap-1.5 min-w-0">
                    <a
                      href={`https://${r.hostname}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-sky-700 hover:underline truncate"
                      title={`Open https://${r.hostname}`}
                    >
                      {r.hostname}
                      <ExternalLink size={11} className="shrink-0" aria-hidden />
                    </a>
                    <span className="text-[11px] text-slate-500 truncate">
                      {r.project}/{r.environment}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-slate-500">No hostnames yet. Set a public hostname on a project environment and pick this tunnel.</span>
            )}
          </dd>
        </div>
      </dl>

      {t.lastError && (
        <div className="flex items-start gap-1.5 p-2 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-[11px]" role="alert">
          <AlertTriangle size={13} className="shrink-0 mt-px" aria-hidden />
          <span className="break-words">{t.lastError}</span>
        </div>
      )}

      <div className="text-[11px] text-slate-500">
        Created{t.createdBy ? ` by ${t.createdBy}` : ''}{' '}
        {t.createdAt && <span title={formatDateTime(t.createdAt)}>{formatRelativeTime(t.createdAt)}</span>} · {t.replicas} replica{t.replicas === 1 ? '' : 's'}
      </div>
    </li>
  );
};

export const DnsTunnelsSection: React.FC<DnsTunnelsSectionProps> = ({ connectors, connectorsLoading, canManage }) => {
  const toast = useToast();
  const [tunnels, setTunnels] = useState<CloudflareTunnel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [redeployTarget, setRedeployTarget] = useState<CloudflareTunnel | null>(null);
  const [redeployReplicas, setRedeployReplicas] = useState(1);
  const [isRedeploying, setIsRedeploying] = useState(false);
  const [redeployError, setRedeployError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<CloudflareTunnel | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [forceDelete, setForceDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setTunnels(await dnsApi.tunnels());
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load tunnels'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const connectorName = (id: string) => connectors.find((c) => c._id === id)?.name ?? 'unknown connector';
  const hasUsableConnector = connectors.some((c) => c.isActive && c.accountId);

  const openRedeploy = (t: CloudflareTunnel) => {
    setRedeployTarget(t);
    setRedeployReplicas(Math.min(3, Math.max(1, t.replicas || 1)));
    setRedeployError(null);
  };

  const confirmRedeploy = async () => {
    if (!redeployTarget) return;
    setIsRedeploying(true);
    setRedeployError(null);
    try {
      const res = await dnsApi.redeployTunnel(redeployTarget._id, redeployReplicas);
      toast.success(res.message || `Tunnel ${redeployTarget.name} redeployed`);
      setRedeployTarget(null);
      load();
    } catch (err) {
      setRedeployError(getApiErrorMessage(err, 'Redeploy failed'));
    } finally {
      setIsRedeploying(false);
    }
  };

  const openDelete = (t: CloudflareTunnel) => {
    setDeleteTarget(t);
    setDeleteError(null);
    setForceDelete(false);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await dnsApi.deleteTunnel(deleteTarget._id, forceDelete);
      toast.success(res.message || `Tunnel ${deleteTarget.name} deleted`);
      setTunnels((prev) => prev.filter((t) => t._id !== deleteTarget._id));
      setDeleteTarget(null);
      load();
    } catch (err) {
      // 409 = hostnames still route through this tunnel; show them and allow a forced delete.
      if (getApiErrorStatus(err) === 409) {
        setDeleteError(`${getApiErrorMessage(err)}. Deleting anyway means those hostnames stop working until they are moved to another tunnel or a DNS record.`);
        setForceDelete(true);
      } else {
        setDeleteError(getApiErrorMessage(err, 'Delete failed'));
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const createDisabledReason = !hasUsableConnector ? 'Add the Account ID to an active Cloudflare connector first' : undefined;

  const renderBody = () => {
    if (!connectors.length && !connectorsLoading) {
      return (
        <EmptyState
          icon={<Network size={22} />}
          title="No Cloudflare connector yet"
          description='Tunnels need a Cloudflare connector with an Account ID. Use "Add Cloudflare" above, then come back here.'
        />
      );
    }
    if (error) {
      return (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
          {error}
        </div>
      );
    }
    if (isLoading && !tunnels.length) {
      return (
        <ul className="space-y-2.5" aria-busy="true" aria-label="Loading tunnels">
          {[0, 1].map((i) => (
            <li key={i} className="bg-white border border-slate-200 rounded-md p-3.5 space-y-2.5 animate-pulse">
              <div className="h-4 w-48 bg-slate-200 rounded" />
              <div className="h-3 w-72 bg-slate-100 rounded" />
              <div className="grid grid-cols-4 gap-3">
                {[0, 1, 2, 3].map((j) => (
                  <div key={j} className="h-6 bg-slate-100 rounded" />
                ))}
              </div>
            </li>
          ))}
        </ul>
      );
    }
    if (!tunnels.length) {
      return (
        <EmptyState
          icon={<Network size={22} />}
          title="No tunnels yet"
          description="Create a tunnel for a cluster, then give project environments a public hostname that routes through it."
          action={
            canManage ? (
              <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreating(true)} disabled={!hasUsableConnector} title={createDisabledReason}>
                Create tunnel
              </Button>
            ) : undefined
          }
        />
      );
    }
    return (
      <ul className="space-y-2.5">
        {tunnels.map((t) => (
          <TunnelCard
            key={t._id}
            tunnel={t}
            connectorName={connectorName(t.connectorId)}
            canManage={canManage}
            onRedeploy={() => openRedeploy(t)}
            onDelete={() => openDelete(t)}
          />
        ))}
      </ul>
    );
  };

  return (
    <section className="space-y-3 pt-2" aria-labelledby="cf-tunnels-heading">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 id="cf-tunnels-heading" className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Network size={15} className="text-orange-500" aria-hidden />
            Cloudflare Tunnels
          </h2>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            A tunnel connects your cluster outwards to Cloudflare, so environments get public https hostnames without a public IP or open ports — ideal
            for minikube. DevOps Intelligence creates the tunnel, runs cloudflared in the cluster (namespace cloudflared) and keeps its routes in sync
            with the hostnames set on project environments.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />}
            onClick={load}
            disabled={isLoading}
            title={isLoading ? 'Checking tunnel status…' : 'Refresh live status'}
          >
            Refresh
          </Button>
          {canManage && connectors.length > 0 && (
            <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreating(true)} disabled={!hasUsableConnector} title={createDisabledReason}>
              Create tunnel
            </Button>
          )}
        </div>
      </div>

      {renderBody()}

      {creating && (
        <DnsTunnelModal
          connectors={connectors}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      {redeployTarget && (
        <Modal
          isOpen
          onClose={() => setRedeployTarget(null)}
          preventClose={isRedeploying}
          maxWidth="sm"
          title={`Redeploy ${redeployTarget.name}?`}
          icon={
            <div className="w-9 h-9 rounded-md flex items-center justify-center border bg-orange-50 border-orange-200 text-orange-600">
              <RotateCw size={18} />
            </div>
          }
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setRedeployTarget(null)} disabled={isRedeploying}>
                Cancel
              </Button>
              <Button type="button" onClick={confirmRedeploy} isLoading={isRedeploying}>
                Redeploy
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-xs text-slate-700">
            <p>
              Re-applies cloudflared in <span className="font-mono">{redeployTarget.clusterName}</span> /{' '}
              <span className="font-mono">{redeployTarget.namespace}</span> with a fresh tunnel token and resyncs its routes. Hostnames may blip for a
              few seconds while pods restart.
            </p>
            <FormField id="tunnel-redeploy-replicas" label="Replicas" hint="Number of cloudflared pods (1–3)">
              <select
                id="tunnel-redeploy-replicas"
                className={selectClass}
                value={redeployReplicas}
                onChange={(e) => setRedeployReplicas(Number(e.target.value))}
                disabled={isRedeploying}
              >
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </FormField>
            {redeployError && (
              <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800" role="alert">
                {redeployError}
              </div>
            )}
          </div>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete tunnel?"
        message={
          <>
            <strong className="font-semibold font-mono">{deleteTarget?.name}</strong> will be deleted in Cloudflare and cloudflared removed from{' '}
            <span className="font-mono">{deleteTarget?.clusterName}</span>.
            {deleteTarget && deleteTarget.routes.length > 0 && (
              <> {deleteTarget.routes.length} hostname{deleteTarget.routes.length === 1 ? '' : 's'} currently route through it.</>
            )}
          </>
        }
        confirmLabel={forceDelete ? 'Delete anyway' : 'Delete tunnel'}
        isLoading={isDeleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => !isDeleting && setDeleteTarget(null)}
      />
    </section>
  );
};
