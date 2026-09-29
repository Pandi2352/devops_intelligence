import api from './client';
import { ConnectionTestResult } from '../types';

export interface DnsConnector {
  _id: string;
  name: string;
  provider: 'cloudflare';
  accountId: string;
  zones: string[];
  hasToken: boolean;
  tokenHint: string;
  isDefault: boolean;
  isActive: boolean;
  status: 'Connected' | 'Limited' | 'Error' | 'Unknown';
  lastError: string;
  lastTestedAt?: string;
  tokenStatus: string;
  tokenExpiresOn?: string;
  zoneCount: number;
  dnsReadable: boolean;
  /** What the token may read (checked by Test; nothing is changed). */
  capabilities: TokenCapabilities | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TokenCapabilities {
  zoneRead: boolean;
  dnsRead: boolean;
  settingsRead: boolean;
  tunnelRead: boolean | null; // null = no Account ID to check with
}

export interface DnsConnectorInput {
  name: string;
  apiToken?: string;
  accountId?: string;
  zones: string[];
  isDefault?: boolean;
  isActive?: boolean;
}

export interface DnsZone {
  id: string;
  name: string;
  status: string;
  paused: boolean;
  plan: string;
  nameServers: string[];
  account: string;
  accountId: string;
  modifiedOn?: string;
  recordCount?: number;
}

export interface DnsSaveResponse {
  message: string;
  connector: DnsConnector;
  test: ConnectionTestResult;
}

export const dnsApi = {
  connectors: async (): Promise<DnsConnector[]> => (await api.get('/dns/connectors')).data.connectors,
  create: async (data: DnsConnectorInput): Promise<DnsSaveResponse> => (await api.post('/dns/connectors', data)).data,
  update: async (id: string, data: DnsConnectorInput): Promise<DnsSaveResponse> => (await api.put(`/dns/connectors/${id}`, data)).data,
  setDefault: async (id: string): Promise<DnsConnector> => (await api.put(`/dns/connectors/${id}/default`)).data.connector,
  remove: async (id: string, force = false): Promise<void> => {
    await api.delete(`/dns/connectors/${id}`, { params: force ? { force: 'true' } : {} });
  },
  test: async (data: Partial<DnsConnectorInput> & { id?: string }): Promise<ConnectionTestResult> => (await api.post('/dns/connectors/test', data)).data,
  testSaved: async (id: string): Promise<ConnectionTestResult & { connector: DnsConnector }> => (await api.post(`/dns/connectors/${id}/test`)).data,
  zones: async (id: string): Promise<DnsZone[]> => (await api.get(`/dns/connectors/${id}/zones`)).data.zones,
  zoneOverview: async (id: string, zoneId: string): Promise<ZoneOverview> => (await api.get(`/dns/connectors/${id}/zones/${zoneId}/overview`)).data,
  domains: async (probe = true): Promise<DomainsList> => (await api.get('/dns/domains', { params: probe ? {} : { probe: 0 } })).data,

  // Zone records (DevOps admins).
  records: async (id: string, zoneId: string): Promise<{ zone: DnsZone; editableTypes: DnsRecordType[]; records: DnsRecord[] }> =>
    (await api.get(`/dns/connectors/${id}/zones/${zoneId}/records`)).data,
  createRecord: async (id: string, zoneId: string, data: DnsRecordInput): Promise<{ message: string; record: DnsRecord }> =>
    (await api.post(`/dns/connectors/${id}/zones/${zoneId}/records`, data)).data,
  updateRecord: async (id: string, zoneId: string, recordId: string, data: DnsRecordInput): Promise<{ message: string; record: DnsRecord }> =>
    (await api.put(`/dns/connectors/${id}/zones/${zoneId}/records/${recordId}`, data)).data,
  deleteRecord: async (id: string, zoneId: string, record: Pick<DnsRecord, 'id' | 'name'>): Promise<{ message: string }> =>
    (await api.delete(`/dns/connectors/${id}/zones/${zoneId}/records/${record.id}`, { params: { name: record.name } })).data,

  // Cloudflare Tunnels (DevOps admins).
  tunnels: async (live = true): Promise<CloudflareTunnel[]> => (await api.get('/dns/tunnels', { params: live ? {} : { live: 0 } })).data.tunnels,
  createTunnel: async (data: { connectorId: string; clusterName: string; name?: string; replicas?: number; deploy?: boolean }): Promise<{ message: string; steps: TunnelStep[]; tunnel: CloudflareTunnel }> =>
    (await api.post('/dns/tunnels', data)).data,
  redeployTunnel: async (id: string, replicas?: number): Promise<{ message: string; tunnel: CloudflareTunnel }> =>
    (await api.post(`/dns/tunnels/${id}/deploy`, replicas ? { replicas } : {})).data,
  deleteTunnel: async (id: string, force = false): Promise<{ message: string }> => (await api.delete(`/dns/tunnels/${id}`, { params: force ? { force: 'true' } : {} })).data,
};

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX';

export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  proxiable: boolean;
  ttl: number; // 1 = auto
  priority?: number;
  comment: string;
  modifiedOn?: string;
  /** "project/env" when an environment's public hostname is this record. */
  environment?: string;
  /** Created or last changed by DevOps Intelligence. */
  managed?: boolean;
}

export interface DnsRecordInput {
  type: DnsRecordType;
  name: string; // "@", relative ("www") or full name
  content: string;
  proxied?: boolean;
  ttl?: number;
  priority?: number;
  comment?: string;
}

export interface TunnelStep {
  label: string;
  ok: boolean;
  detail: string;
}

export interface CloudflareTunnel {
  _id: string;
  name: string;
  tunnelId: string;
  connectorId: string;
  clusterName: string;
  namespace: string;
  replicas: number;
  deployed: boolean;
  status: string; // inactive / degraded / healthy / down
  connections: number;
  lastError: string;
  lastCheckedAt?: string;
  createdBy: string;
  createdAt?: string;
  routes: { hostname: string; project: string; environment: string; projectId: string }[];
  pods: { name: string; phase: string; ready: boolean; restarts: number; reason: string }[];
}

// ---------------------------------------------------------------- per project environment

export type EnvDnsState = 'ok' | 'missing' | 'mismatch' | 'needs-target' | 'error' | 'not-configured';

export interface EnvDnsConfig {
  hostname: string;
  connectorId: string;
  connectorName: string;
  zoneId: string;
  zoneName: string;
  mode: 'record' | 'tunnel';
  target: string;
  tunnelId: string;
  service: string;
  port: number;
  proxied: boolean;
  /** Created by "Get random URL". */
  random?: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export interface Reachability {
  ok: boolean;
  status: number;
  ms: number;
  error: string;
}

export interface EnvDns {
  env: string;
  namespace: string;
  canConfigure: boolean; // project admin
  canApply: boolean; // build and deploy
  requiresApproval: boolean;
  pendingApproval: { id: string; kind: string; summary: string; requestedBy: string; at: string } | null;
  dns: EnvDnsConfig | null;
  state: EnvDnsState;
  message: string;
  expected: { type: 'A' | 'AAAA' | 'CNAME'; content: string; proxied: boolean; origin: string } | null;
  records: DnsRecord[];
  reachable: Reachability | null;
  tunnel: { id: string; name: string; status: string; connections: number } | null;
  preview: { running: boolean; ready: boolean; url: string; reason: string; startedAt?: string; startedBy: string; reachable: Reachability | null };
  publicUrl: string;
}

export interface ProjectDns {
  project: string;
  cluster: string;
  environments: EnvDns[];
  connectors: { id: string; name: string; isDefault: boolean; hasAccount: boolean; zones: { id: string; name: string; status: string }[] }[];
  tunnels: { id: string; name: string; connectorId: string; clusterName: string; status: string }[];
}

export interface EnvDnsInput {
  hostname: string;
  connectorId?: string;
  mode: 'record' | 'tunnel';
  target?: string;
  tunnelId?: string;
  service?: string;
  port?: number;
  proxied?: boolean;
}

/** 200 = done; 202 = approvalRequired (a request was created instead). */
export interface DnsActionResult {
  message: string;
  approvalRequired?: boolean;
  url?: string;
  changed?: boolean;
}

const envPath = (projectId: string, env: string) => `/projects/${projectId}/environments/${encodeURIComponent(env)}`;

export const envDnsApi = {
  get: async (projectId: string, probe = true): Promise<ProjectDns> => (await api.get(`/projects/${projectId}/dns`, { params: probe ? {} : { probe: 0 } })).data,
  configure: async (projectId: string, env: string, data: EnvDnsInput): Promise<{ message: string }> => (await api.put(`${envPath(projectId, env)}/dns`, data)).data,
  clear: async (projectId: string, env: string): Promise<{ message: string }> => (await api.put(`${envPath(projectId, env)}/dns`, { clear: true })).data,
  apply: async (projectId: string, env: string, reason?: string): Promise<DnsActionResult> => (await api.post(`${envPath(projectId, env)}/dns/apply`, { reason: reason || undefined })).data,
  removeRecord: async (projectId: string, env: string, reason?: string): Promise<DnsActionResult> =>
    (await api.delete(`${envPath(projectId, env)}/dns/record`, { data: { reason: reason || undefined } })).data,
  /** One click: random subdomain of a Cloudflare zone, served through the cluster's tunnel. */
  quick: async (projectId: string, env: string, opts: { regenerate?: boolean; zoneId?: string; reason?: string } = {}): Promise<DnsActionResult & { hostname?: string; steps?: TunnelStep[] }> =>
    (await api.post(`${envPath(projectId, env)}/dns/quick`, { regenerate: opts.regenerate || undefined, zoneId: opts.zoneId || undefined, reason: opts.reason || undefined })).data,
  startPreview: async (projectId: string, env: string, reason?: string): Promise<DnsActionResult> =>
    (await api.post(`${envPath(projectId, env)}/preview`, { reason: reason || undefined })).data,
  stopPreview: async (projectId: string, env: string): Promise<DnsActionResult> => (await api.delete(`${envPath(projectId, env)}/preview`)).data,
};

// Disabled connectors keep their last test result; show them as Disabled instead.
export const dnsStatus = (d: DnsConnector) => (d.isActive ? d.status : 'Disabled');

export interface PublicUrlItem extends EnvDns {
  projectId: string;
  projectName: string;
  cluster: string;
}

export interface PublicUrls {
  items: PublicUrlItem[];
  summary: { hostnames: number; live: number; needAttention: number; previews: number; oldPreviews: number };
  /** Clusters whose previews could not be listed (their previews may be missing here). */
  unreachableClusters: string[];
}

export const publicUrlsApi = {
  list: async (probe = true): Promise<PublicUrls> => (await api.get('/dns/public-urls', { params: probe ? {} : { probe: 0 } })).data,
};

// ---------------------------------------------------------------- what can be seen of a domain

/** What the internet sees for a hostname (needs no Cloudflare permission). */
export interface HostInspection {
  hostname: string;
  dns: { A: string[]; AAAA: string[]; CNAME: string[]; error: string };
  https: { ok: boolean; status: number; ms: number; server: string; location: string; viaCloudflare: boolean; poweredBy: string; error: string };
  tls: { ok: boolean; valid: boolean; issuer: string; subject: string; validTo: string; daysLeft: number | null; altNames: string[]; error: string };
}

export interface ZoneUser {
  project: string;
  projectId: string;
  environment: string;
  hostname: string;
}

export interface ZoneOverview {
  zone: DnsZone & {
    type?: string;
    developmentMode?: number;
    originalNameServers?: string[];
    originalRegistrar?: string;
    originalDnsHost?: string;
    createdOn?: string;
    activatedOn?: string;
  };
  capabilities: TokenCapabilities | null;
  records: DnsRecord[] | null;
  recordsError: string;
  settings: { id: string; value: string; editable: boolean }[] | null;
  settingsError: string;
  public: HostInspection[]; // apex and www
  usedBy: ZoneUser[];
  checkedAt: string;
}

export interface DomainsList {
  domains: { connectorId: string; connectorName: string; zone: DnsZone; apex: HostInspection | null; www: HostInspection | null; usedBy: ZoneUser[] }[];
  errors: string[];
}
