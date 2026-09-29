import axios from 'axios';
import { isIP } from 'node:net';
import { DnsIntegration, IDnsIntegration } from '../models/DnsIntegration.js';
import { CloudflareTunnel, ICloudflareTunnel } from '../models/CloudflareTunnel.js';
import { IArgoAppMapping, IEnvDns, IProject, Project } from '../models/Project.js';
import { envNameOf } from './access.js';
import { CloudflareRecord, CloudflareZone, listZones, putTunnelIngress, tunnelTarget, TunnelIngressRule } from './cloudflareClient.js';
import { environmentService, ingressAddress } from './cloudflared.js';

export const MANAGED_MARK = 'DevOps Intelligence';
export const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
export const ADDRESS_TYPES = ['A', 'AAAA', 'CNAME'];

// ---------------------------------------------------------------- connectors and zones

export const activeConnector = async (id?: string): Promise<IDnsIntegration | null> => {
  if (id) return DnsIntegration.findOne({ _id: id, isActive: true }).catch(() => null);
  return (await DnsIntegration.findOne({ isActive: true, isDefault: true })) || DnsIntegration.findOne({ isActive: true }).sort({ createdAt: 1 });
};

// Zones change rarely; one lookup per connector per minute is plenty.
const zoneCache = new Map<string, { at: number; zones: CloudflareZone[] }>();
export const cachedZones = async (c: IDnsIntegration, fresh = false): Promise<CloudflareZone[]> => {
  const key = String(c._id);
  const hit = zoneCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.zones;
  const zones = await listZones(c);
  zoneCache.set(key, { at: Date.now(), zones });
  return zones;
};
export const forgetZones = (connectorId: string) => zoneCache.delete(connectorId);

export const clusterOf = (project: IProject) => project.kubernetesMappings?.[0]?.clusterName || 'minikube';
export const envApp = (project: IProject, env: string) => (project.argoApps || []).find((a) => envNameOf(a) === env);

// ---------------------------------------------------------------- what the record should be

export interface ExpectedRecord {
  type: 'A' | 'AAAA' | 'CNAME';
  content: string;
  proxied: boolean;
  origin: string; // where the content came from, for people
}

export const recordTypeFor = (content: string): ExpectedRecord['type'] => (isIP(content) === 4 ? 'A' : isIP(content) === 6 ? 'AAAA' : 'CNAME');

// Works out the record an environment's hostname needs, or why it cannot be worked out yet.
export const expectedRecord = async (project: IProject, app: IArgoAppMapping, dns: IEnvDns): Promise<{ expected?: ExpectedRecord; problem?: string; tunnel?: ICloudflareTunnel | null }> => {
  if (dns.mode === 'tunnel') {
    const tunnel = await CloudflareTunnel.findOne({ tunnelId: dns.tunnelId });
    if (!tunnel) return { problem: 'The tunnel this hostname uses no longer exists. Pick another tunnel.', tunnel: null };
    return { expected: { type: 'CNAME', content: tunnelTarget(tunnel.tunnelId), proxied: true, origin: `tunnel ${tunnel.name}` }, tunnel };
  }
  if (dns.target) return { expected: { type: recordTypeFor(dns.target), content: dns.target, proxied: dns.proxied, origin: 'address you set' } };
  const found = await ingressAddress(clusterOf(project), app.targetNamespace, dns.hostname).catch(() => ({ ingress: '', address: '' }));
  if (found.address) return { expected: { type: recordTypeFor(found.address), content: found.address, proxied: dns.proxied, origin: `Ingress ${found.ingress}` } };
  return {
    problem: found.ingress
      ? `Ingress ${found.ingress} serves ${dns.hostname} but has no external address yet. Set a target address, or use a tunnel.`
      : `No Ingress in ${app.targetNamespace} serves ${dns.hostname}. Set a target address, or use a tunnel (works without a public IP).`,
  };
};

export type DnsState = 'ok' | 'missing' | 'mismatch' | 'needs-target' | 'error' | 'not-configured';

// Compares what Cloudflare has for the hostname with what it should be.
export const compareRecords = (expected: ExpectedRecord | undefined, actual: CloudflareRecord[]): { state: DnsState; message: string } => {
  const address = actual.filter((r) => ADDRESS_TYPES.includes(r.type));
  if (!expected) return { state: 'needs-target', message: '' };
  if (!address.length) return { state: 'missing', message: `No DNS record yet. Apply creates ${expected.type} → ${expected.content}.` };
  const exact = address.find((r) => r.type === expected.type && r.content.toLowerCase() === expected.content.toLowerCase());
  if (exact && address.length === 1 && exact.proxied === expected.proxied) return { state: 'ok', message: `${exact.type} → ${exact.content}${exact.proxied ? ' (proxied)' : ''}` };
  if (exact && address.length === 1) return { state: 'mismatch', message: `Points at the right place, but proxy is ${exact.proxied ? 'on' : 'off'} (should be ${expected.proxied ? 'on' : 'off'}).` };
  return {
    state: 'mismatch',
    message: `Points at ${address.map((r) => `${r.type} ${r.content}`).join(', ')}; should be ${expected.type} → ${expected.content}.`,
  };
};

// Any HTTP answer counts as reachable; the status tells the rest.
export const checkReachable = async (url: string) => {
  const started = Date.now();
  try {
    const res = await axios.get(url, { timeout: 6000, maxRedirects: 0, validateStatus: () => true, responseType: 'text', transformResponse: (d) => d });
    return { ok: true, status: res.status, ms: Date.now() - started, error: '' };
  } catch (err: any) {
    const code = err?.code || '';
    const error = code === 'ENOTFOUND' ? 'Name does not resolve (yet)' : code === 'ECONNABORTED' || code === 'ETIMEDOUT' ? 'Timed out' : err?.message || 'Unreachable';
    return { ok: false, status: 0, ms: Date.now() - started, error };
  }
};

// ---------------------------------------------------------------- tunnel routes

// Every environment (any project) that is served through this tunnel.
export const tunnelRoutes = async (tunnelId: string) => {
  const projects = await Project.find({ 'argoApps.dns.tunnelId': tunnelId });
  const routes: { project: IProject; app: IArgoAppMapping; hostname: string }[] = [];
  for (const project of projects) {
    for (const app of project.argoApps || []) {
      if (app.dns?.mode === 'tunnel' && app.dns.tunnelId === tunnelId) routes.push({ project, app, hostname: app.dns.hostname });
    }
  }
  return routes;
};

// Rebuilds the tunnel's ingress rules from the environments that use it.
export const syncTunnelIngress = async (tunnel: ICloudflareTunnel) => {
  const connector = await DnsIntegration.findById(tunnel.connectorId);
  if (!connector) throw new Error('The DNS connector of this tunnel was deleted');
  const rules: TunnelIngressRule[] = [];
  for (const r of await tunnelRoutes(tunnel.tunnelId)) {
    const svc = await environmentService(clusterOf(r.project), r.app.targetNamespace, r.app.dns?.service, r.app.dns?.port).catch(() => null);
    if (svc) rules.push({ hostname: r.hostname, service: svc.url });
  }
  await putTunnelIngress(connector, tunnel.tunnelId, rules);
  return rules;
};
