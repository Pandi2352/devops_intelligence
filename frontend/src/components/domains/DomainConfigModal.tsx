import React, { useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { FormField, SegmentedControl, TextInput, Toggle } from '../common/Form';
import { EnvDns, EnvDnsInput, ProjectDns, envDnsApi } from '../../api/dnsApi';
import { getApiErrorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { HOSTNAME_RE, suggestSubdomain } from './domainMeta';

const selectClass =
  'w-full px-3 py-2 rounded-md bg-white border border-slate-300 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:border-sky-500 focus:ring-sky-100 cursor-pointer';

// Longest zone the hostname belongs to ("" when none).
const zoneOf = (hostname: string, zones: string[]) =>
  zones
    .filter((z) => hostname === z || hostname.endsWith(`.${z}`))
    .sort((a, b) => b.length - a.length)[0] || '';

interface DomainConfigModalProps {
  projectId: string;
  projectName: string;
  data: ProjectDns;
  env: EnvDns;
  onClose: () => void;
  onSaved: () => void;
}

export const DomainConfigModal: React.FC<DomainConfigModalProps> = ({ projectId, projectName, data, env, onClose, onSaved }) => {
  const toast = useToast();
  const dns = env.dns;
  const connectors = data.connectors;
  const initialConnector = dns?.connectorId || connectors.find((c) => c.isDefault)?.id || connectors[0]?.id || '';
  const [connectorId, setConnectorId] = useState(initialConnector);
  const connector = connectors.find((c) => c.id === connectorId);
  const zoneNames = useMemo(() => (connector?.zones || []).map((z) => z.name), [connector]);

  const [hostname, setHostname] = useState(() => {
    if (dns?.hostname) return dns.hostname;
    const first = connectors.find((c) => c.id === initialConnector)?.zones[0]?.name;
    const sub = suggestSubdomain(projectName, env.env);
    return first ? `${sub}.${first}` : '';
  });
  const [mode, setMode] = useState<'record' | 'tunnel'>(dns?.mode || 'record');
  const [target, setTarget] = useState(dns?.target || '');
  const [service, setService] = useState(dns?.service || '');
  const [port, setPort] = useState(dns?.port ? String(dns.port) : '');
  const [proxied, setProxied] = useState(dns ? dns.proxied : true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const tunnels = data.tunnels.filter((t) => t.connectorId === connectorId && t.clusterName === data.cluster);
  const [tunnelId, setTunnelId] = useState(dns?.tunnelId || tunnels[0]?.id || '');
  const tunnelOk = tunnels.length > 0;

  const host = hostname.trim().toLowerCase();
  const zone = zoneOf(host, zoneNames);
  const sub = zone ? (host === zone ? '' : host.slice(0, -(zone.length + 1))) : '';

  const changeZone = (z: string) => {
    if (!z) return;
    const s = zone ? sub : suggestSubdomain(projectName, env.env);
    setHostname(s ? `${s}.${z}` : z);
  };
  const changeSub = (s: string) => {
    const clean = s.trim().toLowerCase();
    setHostname(clean ? `${clean}.${zone}` : zone);
  };
  const changeConnector = (id: string) => {
    setConnectorId(id);
    const zs = connectors.find((c) => c.id === id)?.zones.map((z) => z.name) || [];
    if (zs.length && !zoneOf(host, zs)) setHostname(`${sub || suggestSubdomain(projectName, env.env)}.${zs[0]}`);
    const ts = data.tunnels.filter((t) => t.connectorId === id && t.clusterName === data.cluster);
    setTunnelId(ts[0]?.id || '');
    if (!ts.length) setMode('record');
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (!HOSTNAME_RE.test(host)) next.hostname = 'Enter a full hostname such as app.example.com';
    else if (zoneNames.length && !zone) next.hostname = `The hostname must end with one of: ${zoneNames.join(', ')}`;
    if (mode === 'record' && target.trim() && (/\s/.test(target.trim()) || target.includes('://') || target.includes('/')))
      next.target = 'Enter an IP address or a hostname, without https:// or a path';
    if (mode === 'tunnel' && !tunnelId) next.tunnel = 'Pick a tunnel';
    if (port.trim()) {
      const n = Number(port);
      if (!Number.isInteger(n) || n < 1 || n > 65535) next.port = 'Port must be a number from 1 to 65535';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setServerError(null);
    const payload: EnvDnsInput = {
      hostname: host,
      connectorId: connectorId || undefined,
      mode,
      target: mode === 'record' ? target.trim() : undefined,
      tunnelId: mode === 'tunnel' ? tunnelId : undefined,
      service: service.trim() || undefined,
      port: port.trim() ? Number(port) : undefined,
      proxied: mode === 'tunnel' ? true : proxied,
    };
    try {
      const res = await envDnsApi.configure(projectId, env.env, payload);
      toast.success(res.message || `Hostname of ${env.env} saved`);
      onSaved();
    } catch (err) {
      setServerError(getApiErrorMessage(err, 'Could not save the hostname'));
    } finally {
      setSaving(false);
    }
  };

  const formId = `domain-form-${env.env}`;

  return (
    <Modal
      isOpen
      onClose={onClose}
      preventClose={saving}
      icon={<Globe size={18} className="text-sky-600" />}
      title={dns ? `Edit hostname of ${env.env}` : `Set a hostname for ${env.env}`}
      subtitle="Saving stores the setting. Press Apply DNS afterwards to create the Cloudflare record."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} isLoading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={save} className="space-y-4" noValidate>
        {connectors.length > 1 && (
          <FormField id="dns-connector" label="Cloudflare connector">
            <select id="dns-connector" className={selectClass} value={connectorId} onChange={(e) => changeConnector(e.target.value)}>
              {connectors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </FormField>
        )}

        {zoneNames.length > 0 && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
            <FormField id="dns-sub" label="Subdomain">
              <TextInput
                id="dns-sub"
                mono
                value={sub}
                disabled={!zone}
                onChange={(e) => changeSub(e.target.value)}
                placeholder={suggestSubdomain(projectName, env.env)}
              />
            </FormField>
            <span className="pb-2 text-slate-400 font-mono">.</span>
            <FormField id="dns-zone" label="Domain (zone)">
              <select id="dns-zone" className={selectClass} value={zone} onChange={(e) => changeZone(e.target.value)}>
                {!zone && <option value="">Pick a domain</option>}
                {connector?.zones.map((z) => (
                  <option key={z.id} value={z.name}>
                    {z.name}
                    {z.status && z.status !== 'active' ? ` (${z.status})` : ''}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
        )}

        <FormField
          id="dns-hostname"
          label="Hostname"
          required
          error={errors.hostname}
          hint={zoneNames.length ? 'Built from the fields above; you can also type it in full.' : 'The Cloudflare account has no domain yet: type the full hostname.'}
        >
          <TextInput
            id="dns-hostname"
            mono
            value={hostname}
            invalid={Boolean(errors.hostname)}
            onChange={(e) => setHostname(e.target.value)}
            placeholder={`${suggestSubdomain(projectName, env.env)}.example.com`}
            autoComplete="off"
          />
        </FormField>

        <div>
          <span className="block text-xs font-semibold text-slate-700 mb-1">How traffic reaches the environment</span>
          <SegmentedControl
            name={`dns-mode-${env.env}`}
            value={mode}
            onChange={(v) => {
              if (v === 'tunnel' && !tunnelOk) return;
              setMode(v);
            }}
            options={[
              { value: 'record', label: 'DNS record', description: 'Points to your own IP or hostname, or to the Ingress address.' },
              {
                value: 'tunnel',
                label: 'Cloudflare Tunnel',
                description: tunnelOk ? 'No public IP needed.' : `Unavailable: no tunnel for ${data.cluster || 'this cluster'} yet.`,
              },
            ]}
          />
          {!tunnelOk && (
            <p className="mt-1 text-[11px] text-slate-500">To use a tunnel, a DevOps admin creates one in Connectors → DNS → Tunnels.</p>
          )}
        </div>

        {mode === 'record' ? (
          <>
            <FormField id="dns-target" label="Target" error={errors.target} hint="An IP address gives an A/AAAA record, a hostname gives a CNAME.">
              <TextInput
                id="dns-target"
                mono
                value={target}
                invalid={Boolean(errors.target)}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="Leave empty to use the Ingress address, or e.g. 203.0.113.10 / lb.example.net"
              />
            </FormField>
            <Toggle
              id="dns-proxied"
              checked={proxied}
              onChange={setProxied}
              label="Proxy through Cloudflare"
              description="Orange cloud: Cloudflare serves HTTPS and hides the origin address."
            />
          </>
        ) : (
          <FormField id="dns-tunnel" label="Tunnel" error={errors.tunnel} hint="Tunnel hostnames are always proxied through Cloudflare.">
            <select id="dns-tunnel" className={selectClass} value={tunnelId} onChange={(e) => setTunnelId(e.target.value)}>
              {!tunnelId && <option value="">Pick a tunnel</option>}
              {tunnels.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.status || 'unknown'})
                </option>
              ))}
            </select>
          </FormField>
        )}

        <details className="rounded-md border border-slate-200 px-3 py-2" open={Boolean(errors.port || dns?.service || dns?.port)}>
          <summary className="text-xs font-semibold text-slate-700 cursor-pointer">Advanced: service and port</summary>
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_120px] gap-2">
            <FormField id="dns-service" label="Service" hint="Empty = the service found in the namespace.">
              <TextInput id="dns-service" mono value={service} onChange={(e) => setService(e.target.value)} placeholder="e.g. demo-api" />
            </FormField>
            <FormField id="dns-port" label="Port" error={errors.port}>
              <TextInput
                id="dns-port"
                mono
                inputMode="numeric"
                value={port}
                invalid={Boolean(errors.port)}
                onChange={(e) => setPort(e.target.value)}
                placeholder="e.g. 8080"
              />
            </FormField>
          </div>
        </details>

        {serverError && (
          <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
            {serverError}
          </div>
        )}
      </form>
    </Modal>
  );
};
