import axios, { AxiosError, Method } from 'axios';

// Cloudflare API v4. Every response is { success, errors: [{ code, message }], result, result_info }.
// CLOUDFLARE_API_BASE exists for the test suite (a local fake API); leave it unset in real use.
const API = (process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4').replace(/\/+$/, '');
const TIMEOUT = 15000;

export interface CloudflareCredentials {
  apiToken: string;
  accountId?: string;
  zones?: string[]; // allowed zone names; empty = all
}

export interface CloudflareZone {
  id: string;
  name: string;
  status: string; // active / pending / moved …
  paused: boolean;
  plan: string;
  nameServers: string[];
  account: string;
  accountId: string;
  modifiedOn?: string;
  recordCount?: number;
}

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'NS' | 'SRV' | 'CAA';
export const EDITABLE_TYPES: DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'TXT', 'MX'];

export interface CloudflareRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  proxiable: boolean;
  ttl: number;
  priority?: number;
  comment: string;
  modifiedOn?: string;
}

export interface RecordInput {
  type: DnsRecordType;
  name: string;
  content: string;
  proxied?: boolean;
  ttl?: number; // 1 = automatic
  priority?: number;
  comment?: string;
}

export interface TokenCapabilities {
  zoneRead: boolean;
  dnsRead: boolean;
  settingsRead: boolean;
  tunnelRead: boolean | null; // null = no Account ID to check with
}

export interface CloudflareProbe {
  message: string;
  tokenStatus: string;
  tokenExpiresOn?: string;
  zoneCount: number;
  dnsReadable: boolean;
  zones: string[];
  capabilities: TokenCapabilities;
}

export interface CloudflareTunnel {
  id: string;
  name: string;
  status: string; // inactive / degraded / healthy / down
  createdAt?: string;
  connections: { coloName: string; clientVersion: string; openedAt?: string; originIp?: string }[];
}

export interface TunnelIngressRule {
  hostname?: string;
  service: string;
  originRequest?: Record<string, unknown>;
}

type Envelope<T> = { success: boolean; result: T; result_info?: { page: number; per_page: number; total_count: number; total_pages: number } };

export const cfRequest = async <T = any>(c: CloudflareCredentials, method: Method, path: string, opts: { params?: Record<string, unknown>; data?: unknown } = {}) => {
  const res = await axios.request<Envelope<T>>({
    method,
    url: `${API}${path}`,
    params: opts.params,
    data: opts.data,
    timeout: TIMEOUT,
    headers: { Authorization: `Bearer ${c.apiToken}`, 'Content-Type': 'application/json' },
  });
  return res.data;
};

export const cfGet = <T = any>(c: CloudflareCredentials, path: string, params?: Record<string, unknown>) => cfRequest<T>(c, 'get', path, { params });

// Cloudflare puts the useful text in errors[].message rather than a top-level message.
export const describeCloudflareError = (err: unknown): string => {
  if (err instanceof Error && !(err as any).isAxiosError) return err.message;
  const e = err as AxiosError<any>;
  const status = e?.response?.status;
  const errors: { code?: number; message?: string }[] = e?.response?.data?.errors || [];
  const detail = errors.map((x) => x.message).filter(Boolean).join('; ');
  if (errors.some((x) => [1000, 6003, 6111, 9109].includes(Number(x.code))) || status === 401) {
    return 'Cloudflare rejected the API token. Check it was copied completely and has not been revoked or expired.';
  }
  if (status === 403) return `Cloudflare denied access (403)${detail ? `: ${detail}` : ''}. Check the token permissions.`;
  if (status) return `Cloudflare responded with HTTP ${status}${detail ? `: ${detail.slice(0, 200)}` : ''}`;
  const code = (e as any)?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Could not resolve api.cloudflare.com. Check the server has internet access.';
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return 'Cloudflare did not answer in time.';
  return (e as any)?.message || 'Unknown error talking to Cloudflare';
};

// ---------------------------------------------------------------- zones

const toZone = (z: any): CloudflareZone => ({
  id: z.id,
  name: z.name,
  status: z.status,
  paused: Boolean(z.paused),
  plan: z.plan?.name || '',
  nameServers: z.name_servers || [],
  account: z.account?.name || '',
  accountId: z.account?.id || '',
  modifiedOn: z.modified_on,
});

// Every zone the token can see (paged), narrowed to the allowed list when one is set.
export const listZones = async (c: CloudflareCredentials): Promise<CloudflareZone[]> => {
  const zones: CloudflareZone[] = [];
  for (let page = 1; page <= 20; page++) {
    const data = await cfGet<any[]>(c, '/zones', { page, per_page: 50, ...(c.accountId ? { 'account.id': c.accountId } : {}) });
    zones.push(...(data.result || []).map(toZone));
    if (!data.result_info || page >= data.result_info.total_pages) break;
  }
  const allowed = (c.zones || []).map((z) => z.toLowerCase());
  return allowed.length ? zones.filter((z) => allowed.includes(z.name.toLowerCase())) : zones;
};

// The zone a hostname belongs to: the longest zone name it ends with.
export const zoneForHostname = (zones: CloudflareZone[], hostname: string) =>
  zones
    .filter((z) => hostname === z.name || hostname.endsWith(`.${z.name}`))
    .sort((a, b) => b.name.length - a.name.length)[0];

export interface ZoneDetails extends CloudflareZone {
  type: string;
  developmentMode: number;
  originalNameServers: string[];
  originalRegistrar: string;
  originalDnsHost: string;
  createdOn?: string;
  activatedOn?: string;
}

export const getZone = async (c: CloudflareCredentials, zoneId: string): Promise<ZoneDetails> => {
  const z = (await cfGet<any>(c, `/zones/${zoneId}`)).result;
  return {
    ...toZone(z),
    type: z.type || '',
    developmentMode: Number(z.development_mode || 0),
    originalNameServers: z.original_name_servers || [],
    originalRegistrar: z.original_registrar || '',
    originalDnsHost: z.original_dnshost || '',
    createdOn: z.created_on,
    activatedOn: z.activated_on,
  };
};

// The zone settings people usually care about (needs Zone → Zone Settings → Read).
const SETTING_IDS = ['ssl', 'always_use_https', 'min_tls_version', 'tls_1_3', 'automatic_https_rewrites', 'http3', 'brotli', 'security_level', 'cache_level', 'browser_cache_ttl', 'development_mode', 'ipv6', 'websockets'];
export const getZoneSettings = async (c: CloudflareCredentials, zoneId: string) => {
  const all = (await cfGet<any[]>(c, `/zones/${zoneId}/settings`)).result || [];
  return all.filter((x) => SETTING_IDS.includes(x.id)).map((x) => ({ id: String(x.id), value: typeof x.value === 'object' ? JSON.stringify(x.value) : String(x.value), editable: Boolean(x.editable) }));
};

const allowed = (p: Promise<unknown>) => p.then(() => true).catch(() => false);

// ---------------------------------------------------------------- records

const toRecord = (r: any): CloudflareRecord => ({
  id: r.id,
  type: r.type,
  name: r.name,
  content: r.content,
  proxied: Boolean(r.proxied),
  proxiable: r.proxiable !== false,
  ttl: r.ttl,
  priority: r.priority,
  comment: r.comment || '',
  modifiedOn: r.modified_on,
});

export const countRecords = async (c: CloudflareCredentials, zoneId: string): Promise<number> => {
  const data = await cfGet<any[]>(c, `/zones/${zoneId}/dns_records`, { per_page: 5 });
  return data.result_info?.total_count ?? (data.result || []).length;
};

export const listRecords = async (c: CloudflareCredentials, zoneId: string, filter: { name?: string; type?: string } = {}): Promise<CloudflareRecord[]> => {
  const out: CloudflareRecord[] = [];
  for (let page = 1; page <= 50; page++) {
    const data = await cfGet<any[]>(c, `/zones/${zoneId}/dns_records`, { page, per_page: 100, ...filter });
    out.push(...(data.result || []).map(toRecord));
    if (!data.result_info || page >= data.result_info.total_pages) break;
  }
  return out;
};

const recordBody = (r: RecordInput) => ({
  type: r.type,
  name: r.name,
  content: r.content,
  ttl: r.ttl || 1,
  ...(['A', 'AAAA', 'CNAME'].includes(r.type) ? { proxied: Boolean(r.proxied) } : {}),
  ...(r.type === 'MX' ? { priority: r.priority ?? 10 } : {}),
  comment: (r.comment || '').slice(0, 100),
});

export const createRecord = async (c: CloudflareCredentials, zoneId: string, r: RecordInput) =>
  toRecord((await cfRequest(c, 'post', `/zones/${zoneId}/dns_records`, { data: recordBody(r) })).result);

export const updateRecord = async (c: CloudflareCredentials, zoneId: string, id: string, r: RecordInput) =>
  toRecord((await cfRequest(c, 'put', `/zones/${zoneId}/dns_records/${id}`, { data: recordBody(r) })).result);

export const deleteRecord = async (c: CloudflareCredentials, zoneId: string, id: string) => {
  await cfRequest(c, 'delete', `/zones/${zoneId}/dns_records/${id}`);
};

// ---------------------------------------------------------------- tunnels (need the account ID)

const needAccount = (c: CloudflareCredentials) => {
  if (!c.accountId) throw new Error('Cloudflare Tunnel needs the Account ID on the DNS connector');
  return c.accountId;
};

const toTunnel = (t: any): CloudflareTunnel => ({
  id: t.id,
  name: t.name,
  status: t.status || 'inactive',
  createdAt: t.created_at,
  connections: (t.connections || []).map((x: any) => ({ coloName: x.colo_name, clientVersion: x.client_version, openedAt: x.opened_at, originIp: x.origin_ip })),
});

export const createTunnel = async (c: CloudflareCredentials, name: string) =>
  toTunnel((await cfRequest(c, 'post', `/accounts/${needAccount(c)}/cfd_tunnel`, { data: { name, config_src: 'cloudflare' } })).result);

export const getTunnel = async (c: CloudflareCredentials, id: string) => toTunnel((await cfGet(c, `/accounts/${needAccount(c)}/cfd_tunnel/${id}`)).result);

// The connector token cloudflared runs with (a secret).
export const getTunnelToken = async (c: CloudflareCredentials, id: string): Promise<string> => String((await cfGet<string>(c, `/accounts/${needAccount(c)}/cfd_tunnel/${id}/token`)).result);

export const getTunnelIngress = async (c: CloudflareCredentials, id: string): Promise<TunnelIngressRule[]> => {
  const data = await cfGet<any>(c, `/accounts/${needAccount(c)}/cfd_tunnel/${id}/configurations`);
  return data.result?.config?.ingress || [];
};

// Replaces the tunnel's routes. Cloudflare requires a final catch-all rule without hostname.
export const putTunnelIngress = async (c: CloudflareCredentials, id: string, rules: TunnelIngressRule[]) => {
  const ingress = [...rules.filter((r) => r.hostname), { service: 'http_status:404' }];
  await cfRequest(c, 'put', `/accounts/${needAccount(c)}/cfd_tunnel/${id}/configurations`, { data: { config: { ingress } } });
};

export const deleteTunnel = async (c: CloudflareCredentials, id: string) => {
  const account = needAccount(c);
  await cfRequest(c, 'delete', `/accounts/${account}/cfd_tunnel/${id}/connections`).catch(() => undefined);
  await cfRequest(c, 'delete', `/accounts/${account}/cfd_tunnel/${id}`);
};

export const tunnelTarget = (tunnelId: string) => `${tunnelId}.cfargotunnel.com`;

// ---------------------------------------------------------------- probe

// User-owned tokens verify at /user/tokens/verify; account-owned ones (cfat_…) at /accounts/{id}/tokens/verify.
const verifyToken = async (c: CloudflareCredentials) => {
  if (c.accountId && c.apiToken.startsWith('cfat_')) return (await cfGet<any>(c, `/accounts/${c.accountId}/tokens/verify`)).result;
  try {
    return (await cfGet<any>(c, '/user/tokens/verify')).result;
  } catch (err) {
    if (!c.accountId) throw err;
    return (await cfGet<any>(c, `/accounts/${c.accountId}/tokens/verify`)).result;
  }
};

// Token active → it can see zones → it can read DNS records. Nothing is changed.
// Failures carry tokenStatus/tokenExpiresOn so the connector still shows what is known.
export const probeCloudflare = async (c: CloudflareCredentials): Promise<CloudflareProbe> => {
  const token = await verifyToken(c);
  const tokenStatus = String(token?.status || 'unknown');
  const known = { tokenStatus, tokenExpiresOn: token?.expires_on };
  if (tokenStatus !== 'active') throw Object.assign(new Error(`The API token is ${tokenStatus}. Enable it or create a new one in Cloudflare.`), known);

  const zones = await listZones(c).catch((err) => {
    throw Object.assign(new Error(`Token is active, but listing zones failed: ${describeCloudflareError(err)}`), known);
  });
  if (!zones.length) {
    throw Object.assign(
      new Error(
        c.zones?.length
          ? `Token is active, but it cannot see ${c.zones.join(', ')}. Check the zone names or the token's Zone Resources.`
          : 'Token is active, but it sees no zones. Add a domain to this Cloudflare account, or give the token Zone → Zone → Read on it.'
      ),
      known
    );
  }

  // What else the token may do (read-only calls; nothing is changed).
  const [dnsReadable, settingsRead, tunnelRead] = await Promise.all([
    allowed(countRecords(c, zones[0].id)),
    allowed(cfGet(c, `/zones/${zones[0].id}/settings/ssl`)),
    c.accountId ? allowed(cfGet(c, `/accounts/${c.accountId}/cfd_tunnel`, { per_page: 1 })) : Promise.resolve(null),
  ]);
  const capabilities = { zoneRead: true, dnsRead: dnsReadable, settingsRead, tunnelRead };
  const expires = token?.expires_on ? ` · expires ${String(token.expires_on).slice(0, 10)}` : '';
  const names = `${zones.slice(0, 3).map((z) => z.name).join(', ')}${zones.length > 3 ? '…' : ''}`;
  const message = dnsReadable
    ? `Token active · ${zones.length} zone${zones.length === 1 ? '' : 's'} (${names}) · DNS records readable${expires}`
    : `Token active · sees ${names}, but cannot read DNS records: add Zone → DNS → Read (or Edit) to the token.`;
  return { message, ...known, zoneCount: zones.length, dnsReadable, zones: zones.map((z) => z.name), capabilities };
};
