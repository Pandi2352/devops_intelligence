import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { FormField, TextInput, Toggle } from '../common/Form';
import { ConnectorLogoTile } from './ConnectorLogos';
import { TUNNEL_NAME, defaultTunnelName, selectClass } from './dnsHelpers';
import { dnsApi, DnsConnector, TunnelStep } from '../../api/dnsApi';
import { clusterApi } from '../../api/clusterApi';
import { getApiErrorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Cluster } from '../../types';

interface DnsTunnelModalProps {
  connectors: DnsConnector[];
  onClose: () => void;
  onCreated: () => void;
}

type Errors = Partial<Record<'connector' | 'cluster' | 'name', string>>;

export const DnsTunnelModal: React.FC<DnsTunnelModalProps> = ({ connectors, onClose, onCreated }) => {
  const toast = useToast();
  const active = useMemo(() => connectors.filter((c) => c.isActive), [connectors]);
  const usable = active.filter((c) => c.accountId);
  const [connectorId, setConnectorId] = useState(() => (usable.find((c) => c.isDefault) ?? usable[0])?._id ?? '');
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [clustersLoading, setClustersLoading] = useState(true);
  const [clustersError, setClustersError] = useState<string | null>(null);
  const [clusterName, setClusterName] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [replicas, setReplicas] = useState(1);
  const [deploy, setDeploy] = useState(true);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [result, setResult] = useState<{ message: string; steps: TunnelStep[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    clusterApi
      .getAll()
      .then((list) => {
        if (cancelled) return;
        setClusters(list);
        const first = list.find((c) => c.isDefault) ?? list[0];
        if (first) setClusterName((prev) => prev || first.name);
      })
      .catch((err) => !cancelled && setClustersError(getApiErrorMessage(err, 'Could not load clusters')))
      .finally(() => !cancelled && setClustersLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveName = nameTouched ? name : clusterName ? defaultTunnelName(clusterName) : '';

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e: Errors = {};
    if (!connectorId) e.connector = 'Pick a Cloudflare connector with an Account ID';
    if (!clusterName) e.cluster = 'Pick the cluster that will run cloudflared';
    if (!TUNNEL_NAME.test(effectiveName)) e.name = 'Lowercase letters, digits and hyphens; 3–63 characters; no leading or trailing hyphen';
    setErrors(e);
    if (Object.keys(e).length) return;
    setIsSaving(true);
    setFormError(null);
    try {
      const res = await dnsApi.createTunnel({ connectorId, clusterName, name: effectiveName, replicas, deploy });
      setResult({ message: res.message, steps: res.steps ?? [] });
      if (res.steps?.some((s) => !s.ok)) toast.error(res.message || 'Tunnel created with problems');
      else toast.success(res.message || `Tunnel ${effectiveName} created`);
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Could not create the tunnel'));
    } finally {
      setIsSaving(false);
    }
  };

  const finish = () => {
    onCreated();
  };

  if (result) {
    return (
      <Modal
        isOpen
        onClose={finish}
        maxWidth="md"
        icon={<ConnectorLogoTile kind="dns" />}
        title="Tunnel created"
        subtitle={result.message}
        footer={<Button onClick={finish}>Done</Button>}
      >
        {result.steps.length ? (
          <ul className="space-y-2 text-xs">
            {result.steps.map((s, i) => (
              <li key={`${s.label}-${i}`} className="flex items-start gap-2">
                {s.ok ? (
                  <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-px" aria-label="Done" />
                ) : (
                  <XCircle size={15} className="text-rose-600 shrink-0 mt-px" aria-label="Failed" />
                )}
                <div className="min-w-0">
                  <div className={`font-semibold ${s.ok ? 'text-slate-800' : 'text-rose-800'}`}>{s.label}</div>
                  {s.detail && <div className="text-[11px] text-slate-500 break-words">{s.detail}</div>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-600">No step details were returned.</p>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      preventClose={isSaving}
      maxWidth="md"
      icon={<ConnectorLogoTile kind="dns" />}
      title="Create Cloudflare Tunnel"
      subtitle="Creates the tunnel in Cloudflare and runs cloudflared in the cluster (namespace cloudflared)"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" form="dns-tunnel-form" isLoading={isSaving}>
            Create tunnel
          </Button>
        </>
      }
    >
      <form id="dns-tunnel-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        <FormField
          id="tunnel-connector"
          label="Cloudflare connector"
          required
          error={errors.connector}
          hint={!usable.length ? 'No active connector has an Account ID yet. Edit a connector and add its Account ID first.' : undefined}
        >
          <select
            id="tunnel-connector"
            className={selectClass}
            value={connectorId}
            onChange={(e) => {
              setConnectorId(e.target.value);
              setErrors((p) => ({ ...p, connector: undefined }));
            }}
          >
            <option value="" disabled>
              Select a connector
            </option>
            {active.map((c) => (
              <option key={c._id} value={c._id} disabled={!c.accountId}>
                {c.name}
                {c.accountId ? '' : ' (add the Account ID to this connector first)'}
              </option>
            ))}
          </select>
        </FormField>

        <FormField id="tunnel-cluster" label="Cluster" required error={errors.cluster || clustersError || undefined} hint="cloudflared runs here and reaches your services from inside the cluster">
          <select
            id="tunnel-cluster"
            className={selectClass}
            value={clusterName}
            onChange={(e) => {
              setClusterName(e.target.value);
              setErrors((p) => ({ ...p, cluster: undefined }));
            }}
            disabled={clustersLoading || !clusters.length}
            title={clustersLoading ? 'Loading clusters…' : !clusters.length ? 'No clusters connected' : undefined}
          >
            <option value="" disabled>
              {clustersLoading ? 'Loading clusters…' : clusters.length ? 'Select a cluster' : 'No clusters connected'}
            </option>
            {clusters.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} · {c.status}
              </option>
            ))}
          </select>
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FormField
            id="tunnel-name"
            label="Tunnel name"
            required
            className="sm:col-span-2"
            error={errors.name}
            hint="Lowercase DNS label, 3–63 characters"
          >
            <TextInput
              id="tunnel-name"
              value={effectiveName}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value.toLowerCase());
                setErrors((p) => ({ ...p, name: undefined }));
              }}
              placeholder="di-minikube"
              invalid={Boolean(errors.name)}
              mono
              spellCheck={false}
              autoComplete="off"
              maxLength={63}
            />
          </FormField>
          <FormField id="tunnel-replicas" label="Replicas" hint="cloudflared pods">
            <select id="tunnel-replicas" className={selectClass} value={replicas} onChange={(e) => setReplicas(Number(e.target.value))}>
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <div className="p-3 rounded-md border border-slate-200 bg-slate-50">
          <Toggle
            id="tunnel-deploy"
            checked={deploy}
            onChange={setDeploy}
            label="Deploy cloudflared now"
            description="Off: only create the tunnel in Cloudflare; deploy it later with Redeploy."
          />
        </div>

        {formError && (
          <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
            {formError}
          </div>
        )}
      </form>
    </Modal>
  );
};
