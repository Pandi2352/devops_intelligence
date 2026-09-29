import axios from 'axios';
import https from 'https';
import { IObservabilityIntegration, ObservabilityKind } from '../models/ObservabilityIntegration.js';
import { ObservabilityIntegration } from '../models/ObservabilityIntegration.js';
import { resolveClients } from '../controllers/clusterController.js';
import { kubeRequest } from '../utils/kubeRaw.js';

type Query = Record<string, string | number | undefined>;

export type ConnectionFields = Pick<
  IObservabilityIntegration,
  'kind' | 'access' | 'clusterName' | 'namespace' | 'service' | 'port' | 'scheme' | 'url' | 'authType' | 'username' | 'password' | 'token' | 'insecure'
>;

const authHeaders = (c: ConnectionFields): Record<string, string> => {
  if (c.authType === 'bearer' && c.token) return { Authorization: `Bearer ${c.token}` };
  if (c.authType === 'basic' && c.username) return { Authorization: `Basic ${Buffer.from(`${c.username}:${c.password || ''}`).toString('base64')}` };
  return {};
};

// GET a path on Prometheus / Loki / Grafana, either through the cluster's service proxy or directly.
export const observabilityGet = async <T = any>(c: ConnectionFields, path: string, query: Query = {}, timeoutMs = 20000): Promise<T> => {
  if (c.access === 'service') {
    if (!c.clusterName || !c.namespace || !c.service || !c.port) throw new Error('Cluster, namespace, service and port are required');
    const { kc } = await resolveClients(c.clusterName);
    const proxy = `/api/v1/namespaces/${encodeURIComponent(c.namespace)}/services/${c.scheme || 'http'}:${encodeURIComponent(c.service)}:${c.port}/proxy`;
    return kubeRequest<T>(kc, `${proxy}${path}`, { query, headers: authHeaders(c), timeoutMs });
  }
  if (!c.url) throw new Error('URL is required');
  const res = await axios.get<T>(`${c.url.replace(/\/+$/, '')}${path}`, {
    params: query,
    headers: authHeaders(c),
    timeout: timeoutMs,
    httpsAgent: c.insecure ? new https.Agent({ rejectUnauthorized: false }) : undefined,
  });
  return res.data;
};

// Returns the server version, or throws with a readable reason.
export const probeObservability = async (c: ConnectionFields): Promise<{ version: string; message: string }> => {
  if (c.kind === 'prometheus') {
    const r: any = await observabilityGet(c, '/api/v1/status/buildinfo');
    const version = r?.data?.version || 'unknown';
    const targets: any = await observabilityGet(c, '/api/v1/query', { query: 'count(up == 1)' }).catch(() => null);
    const up = targets?.data?.result?.[0]?.value?.[1];
    return { version, message: `Prometheus ${version}${up ? `, ${up} targets up` : ''}` };
  }
  if (c.kind === 'loki') {
    const r: any = await observabilityGet(c, '/loki/api/v1/status/buildinfo').catch(async () => {
      const ready = await observabilityGet(c, '/ready');
      return { version: String(ready).trim() === 'ready' ? 'ready' : 'unknown' };
    });
    const version = r?.version || 'unknown';
    return { version, message: `Loki ${version}` };
  }
  const r: any = await observabilityGet(c, '/api/health');
  if (!r?.version && !r?.database) throw new Error('This does not look like Grafana (no /api/health)');
  return { version: r.version || 'unknown', message: `Grafana ${r.version || ''} (database ${r.database || 'unknown'})` };
};

export const defaultConnector = async (kind: ObservabilityKind) =>
  (await ObservabilityIntegration.findOne({ kind, isActive: true, isDefault: true })) ||
  (await ObservabilityIntegration.findOne({ kind, isActive: true }).sort({ createdAt: 1 }));

// ---------------------------------------------------------------- discovery

export interface DiscoveredService {
  kind: ObservabilityKind;
  clusterName: string;
  namespace: string;
  service: string;
  port: number;
  suggestedName: string;
  alreadyAdded: boolean;
}

const PICK: Record<ObservabilityKind, { name: RegExp; skip: RegExp; ports: number[] }> = {
  prometheus: { name: /prometheus/, skip: /operator|alertmanager|node-exporter|state-metrics|operated|pushgateway|adapter|blackbox/, ports: [9090] },
  grafana: { name: /grafana/, skip: /agent|image-renderer/, ports: [80, 3000] },
  loki: { name: /loki/, skip: /headless|memberlist|canary|chunks-cache|results-cache/, ports: [3100, 80] },
};

// Finds Prometheus / Grafana / Loki services in a cluster so they can be added with one click.
export const discoverObservability = async (clusterName: string): Promise<DiscoveredService[]> => {
  const { core } = await resolveClients(clusterName);
  const services = await core.listServiceForAllNamespaces();
  const existing = await ObservabilityIntegration.find({ access: 'service', clusterName });
  const found: DiscoveredService[] = [];

  for (const svc of services.items) {
    const name = svc.metadata?.name || '';
    const namespace = svc.metadata?.namespace || '';
    const appLabel = `${svc.metadata?.labels?.['app.kubernetes.io/name'] || ''} ${svc.metadata?.labels?.app || ''}`.toLowerCase();
    for (const kind of Object.keys(PICK) as ObservabilityKind[]) {
      const rule = PICK[kind];
      if (!(rule.name.test(name) || rule.name.test(appLabel)) || rule.skip.test(name)) continue;
      // Loki gateway (nginx) listens on 80; the single binary on 3100.
      if (kind === 'loki' && /gateway/.test(name) === false && !(svc.spec?.ports || []).some((p) => p.port === 3100)) continue;
      const port = (svc.spec?.ports || []).find((p) => rule.ports.includes(p.port))?.port;
      if (!port) continue;
      found.push({
        kind,
        clusterName,
        namespace,
        service: name,
        port,
        suggestedName: `${kind === 'prometheus' ? 'Prometheus' : kind === 'grafana' ? 'Grafana' : 'Loki'} (${clusterName})`,
        alreadyAdded: existing.some((e) => e.namespace === namespace && e.service === name && e.port === port),
      });
    }
  }
  return found;
};
