import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { DnsIntegration, IDnsIntegration } from '../models/DnsIntegration.js';
import { Project } from '../models/Project.js';
import { isIP } from 'node:net';
import {
  CloudflareCredentials,
  countRecords,
  createRecord,
  createTunnel,
  deleteRecord,
  deleteTunnel,
  describeCloudflareError,
  DnsRecordType,
  EDITABLE_TYPES,
  getTunnel,
  getZone,
  getZoneSettings,
  getTunnelToken,
  listRecords,
  listZones,
  probeCloudflare,
  putTunnelIngress,
  RecordInput,
  updateRecord,
} from '../services/cloudflareClient.js';
import { CloudflareTunnel, ICloudflareTunnel } from '../models/CloudflareTunnel.js';
import { Cluster } from '../models/Cluster.js';
import { connectorPods, deployTunnelConnector, removeTunnelConnector } from '../services/cloudflared.js';
import { cachedZones, forgetZones, HOSTNAME, MANAGED_MARK, provisionTunnel, syncTunnelIngress, tunnelRoutes } from '../services/dnsService.js';
import { envNameOf } from '../services/access.js';
import { inspectHost } from '../services/domainInspector.js';
import { audit } from '../services/approvals.js';
import { maskSecret } from '../utils/secrets.js';
import { cleanString, isValidId, nameMatch } from '../utils/validation.js';

const ZONE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const ACCOUNT_ID = /^[a-f0-9]{32}$/i;
// The legacy Global API Key is 37 hex characters; it grants everything and is not supported.
const GLOBAL_KEY = /^[a-f0-9]{37}$/i;

export const serializeDns = (c: IDnsIntegration) => ({
  _id: String(c._id),
  name: c.name,
  provider: c.provider,
  accountId: c.accountId,
  zones: c.zones,
  hasToken: Boolean(c.apiToken),
  tokenHint: maskSecret(c.apiToken),
  isDefault: c.isDefault,
  isActive: c.isActive,
  status: c.status,
  lastError: c.lastError,
  lastTestedAt: c.lastTestedAt,
  tokenStatus: c.tokenStatus,
  tokenExpiresOn: c.tokenExpiresOn,
  zoneCount: c.zoneCount,
  dnsReadable: c.dnsReadable,
  capabilities: c.capabilities || null,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

type DnsFields = CloudflareCredentials & { name: string; accountId: string; zones: string[] };

// Validates the body; `current` supplies the stored token on edit so it never has to be re-entered.
const readInput = (body: any, current?: IDnsIntegration | null): { fields?: DnsFields; error?: string } => {
  const name = cleanString(body.name ?? current?.name, 80);
  if (!name) return { error: 'Enter a name' };
  const apiToken = body.apiToken ? String(body.apiToken).trim() : current?.apiToken || '';
  if (!apiToken) return { error: 'Enter a Cloudflare API token' };
  if (GLOBAL_KEY.test(apiToken)) return { error: 'That looks like the Global API Key. Create a scoped API token instead (My Profile → API Tokens).' };
  if (/\s/.test(apiToken) || apiToken.length < 20) return { error: 'That does not look like a Cloudflare API token' };
  const accountId = cleanString(body.accountId ?? current?.accountId, 64);
  if (accountId && !ACCOUNT_ID.test(accountId)) return { error: 'Account ID is 32 hex characters (Cloudflare dashboard → Overview, right column)' };
  const rawZones: unknown[] = Array.isArray(body.zones) ? body.zones : body.zones === undefined ? current?.zones || [] : String(body.zones).split(/[\s,]+/);
  const zones = [...new Set(rawZones.map((z) => String(z).trim().toLowerCase().replace(/\.$/, '')).filter(Boolean))];
  const bad = zones.find((z) => !ZONE.test(z));
  if (bad) return { error: `${bad} is not a valid domain name` };
  if (zones.length > 50) return { error: 'Limit the connector to at most 50 zones' };
  return { fields: { name, apiToken, accountId, zones } };
};

const applyProbe = async (doc: IDnsIntegration) => {
  doc.lastTestedAt = new Date();
  try {
    const r = await probeCloudflare(doc);
    doc.tokenStatus = r.tokenStatus;
    doc.tokenExpiresOn = r.tokenExpiresOn ? new Date(r.tokenExpiresOn) : undefined;
    doc.zoneCount = r.zoneCount;
    doc.dnsReadable = r.dnsReadable;
    doc.capabilities = r.capabilities;
    doc.status = r.dnsReadable ? 'Connected' : 'Limited';
    doc.lastError = r.dnsReadable ? '' : r.message;
    return { ok: r.dnsReadable, message: r.message, capabilities: r.capabilities };
  } catch (err: any) {
    doc.status = 'Error';
    doc.dnsReadable = false;
    doc.zoneCount = 0;
    doc.capabilities = null;
    // The token check may have passed before a later step failed.
    if (err?.tokenStatus) doc.tokenStatus = err.tokenStatus;
    if (err?.tokenExpiresOn) doc.tokenExpiresOn = new Date(err.tokenExpiresOn);
    doc.lastError = describeCloudflareError(err);
    return { ok: false, message: doc.lastError };
  } finally {
    forgetZones(String(doc._id));
  }
};

const findDoc = (id: unknown) => (isValidId(id) ? DnsIntegration.findById(id) : Promise.resolve(null));

export const listDnsConnectors = async (_req: AuthRequest, res: Response): Promise<void> => {
  const items = await DnsIntegration.find().sort({ isDefault: -1, name: 1 });
  res.json({ connectors: items.map(serializeDns) });
};

export const createDnsConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { fields, error } = readInput(req.body || {});
    if (!fields) {
      res.status(400).json({ message: error });
      return;
    }
    if (await DnsIntegration.exists({ name: nameMatch(fields.name) })) {
      res.status(409).json({ message: `A DNS connector named ${fields.name} already exists` });
      return;
    }
    const first = !(await DnsIntegration.exists({}));
    const doc = new DnsIntegration({ ...fields, provider: 'cloudflare', isDefault: first || Boolean(req.body.isDefault), isActive: req.body.isActive !== false });
    if (doc.isDefault) await DnsIntegration.updateMany({}, { isDefault: false });
    const test = await applyProbe(doc);
    await doc.save();
    await audit(req.user, { action: 'CONNECTOR', target: `Cloudflare DNS · ${doc.name}`, outcome: 'changed', message: `Added. ${test.message}` });
    res.status(201).json({ message: `${doc.name} added`, test, connector: serializeDns(doc) });
  } catch (err: any) {
    res.status(500).json({ message: 'Could not save the DNS connector', error: err?.message });
  }
};

export const updateDnsConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const doc = await findDoc(req.params.id);
    if (!doc) {
      res.status(404).json({ message: 'DNS connector not found' });
      return;
    }
    const { fields, error } = readInput(req.body || {}, doc);
    if (!fields) {
      res.status(400).json({ message: error });
      return;
    }
    if (fields.name.toLowerCase() !== doc.name.toLowerCase() && (await DnsIntegration.exists({ name: nameMatch(fields.name) }))) {
      res.status(409).json({ message: `A DNS connector named ${fields.name} already exists` });
      return;
    }
    const tokenChanged = Boolean(req.body.apiToken);
    Object.assign(doc, fields);
    if (typeof req.body.isActive === 'boolean') doc.isActive = req.body.isActive;
    if (req.body.isDefault === true) {
      await DnsIntegration.updateMany({ _id: { $ne: doc._id } }, { isDefault: false });
      doc.isDefault = true;
    }
    const test = await applyProbe(doc);
    await doc.save();
    await audit(req.user, {
      action: 'CONNECTOR',
      target: `Cloudflare DNS · ${doc.name}`,
      outcome: 'changed',
      message: `Updated${tokenChanged ? ' (new API token)' : ''}. ${test.message}`,
    });
    res.json({ message: `${doc.name} saved`, test, connector: serializeDns(doc) });
  } catch (err: any) {
    res.status(500).json({ message: 'Could not save the DNS connector', error: err?.message });
  }
};

export const setDefaultDnsConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  const doc = await findDoc(req.params.id);
  if (!doc) {
    res.status(404).json({ message: 'DNS connector not found' });
    return;
  }
  await DnsIntegration.updateMany({ _id: { $ne: doc._id } }, { isDefault: false });
  doc.isDefault = true;
  await doc.save();
  res.json({ message: `'${doc.name}' is now the default DNS connector`, connector: serializeDns(doc) });
};

export const deleteDnsConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await findDoc(req.params.id);
  if (!existing) {
    res.status(404).json({ message: 'DNS connector not found' });
    return;
  }
  // Refuse while tunnels or environment hostnames depend on it (the UI then offers force).
  const tunnels = await CloudflareTunnel.countDocuments({ connectorId: String(existing._id) });
  const hostnames = await Project.countDocuments({ 'argoApps.dns.connectorId': String(existing._id) });
  if ((tunnels || hostnames) && req.query.force !== 'true') {
    res.status(409).json({ message: `${existing.name} is used by ${tunnels} tunnel(s) and ${hostnames} project(s) with public hostnames` });
    return;
  }
  const doc = await DnsIntegration.findByIdAndDelete(existing._id);
  if (!doc) {
    res.status(404).json({ message: 'DNS connector not found' });
    return;
  }
  forgetZones(String(doc._id));
  if (doc.isDefault) {
    const next = await DnsIntegration.findOne().sort({ createdAt: 1 });
    if (next) await DnsIntegration.updateOne({ _id: next._id }, { isDefault: true });
  }
  await audit(req.user, { action: 'CONNECTOR', target: `Cloudflare DNS · ${doc.name}`, outcome: 'changed', message: 'Deleted with its saved API token' });
  res.json({ message: `${doc.name} deleted` });
};

// The form's "Test connection": unsaved values, reusing the stored token when editing.
export const testDnsConnection = async (req: AuthRequest, res: Response): Promise<void> => {
  const current = await findDoc(req.body?.id);
  const { fields, error } = readInput(req.body || {}, current);
  if (!fields) {
    res.status(400).json({ ok: false, message: error });
    return;
  }
  try {
    const r = await probeCloudflare(fields);
    res.json({ ok: r.dnsReadable, message: r.message, details: { zones: r.zoneCount } });
  } catch (err) {
    res.json({ ok: false, message: describeCloudflareError(err) });
  }
};

export const testSavedDnsConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  const doc = await findDoc(req.params.id);
  if (!doc) {
    res.status(404).json({ message: 'DNS connector not found' });
    return;
  }
  const test = await applyProbe(doc);
  await doc.save();
  res.json({ ...test, connector: serializeDns(doc) });
};

// Zones this connector can use, with how many DNS records each has.
export const listDnsZones = async (req: AuthRequest, res: Response): Promise<void> => {
  const doc = await findDoc(req.params.id);
  if (!doc) {
    res.status(404).json({ message: 'DNS connector not found' });
    return;
  }
  try {
    const zones = await listZones(doc);
    forgetZones(String(doc._id));
    await Promise.all(
      zones.slice(0, 50).map(async (z) => {
        z.recordCount = await countRecords(doc, z.id).catch(() => undefined);
      })
    );
    res.json({ connector: serializeDns(doc), zones });
  } catch (err) {
    res.status(502).json({ message: describeCloudflareError(err) });
  }
};

// ---------------------------------------------------------------- zone records (DevOps admins)

// The zone must be one this connector may use.
const loadZone = async (req: AuthRequest, res: Response) => {
  const doc = await findDoc(req.params.id);
  if (!doc) {
    res.status(404).json({ message: 'DNS connector not found' });
    return null;
  }
  try {
    const zone = (await cachedZones(doc)).find((z) => z.id === req.params.zoneId);
    if (!zone) {
      res.status(404).json({ message: 'Zone not found for this connector' });
      return null;
    }
    return { doc, zone };
  } catch (err) {
    res.status(502).json({ message: describeCloudflareError(err) });
    return null;
  }
};

// Which environment manages each hostname (from project settings), keyed by hostname.
const managedHostnames = async () => {
  const map = new Map<string, string>();
  for (const p of await Project.find({ 'argoApps.dns.hostname': { $exists: true } })) {
    for (const a of p.argoApps || []) if (a.dns?.hostname) map.set(a.dns.hostname, `${p.name}/${envNameOf(a)}`);
  }
  return map;
};

export const listZoneRecords = async (req: AuthRequest, res: Response): Promise<void> => {
  const ctx = await loadZone(req, res);
  if (!ctx) return;
  try {
    const [records, managed] = await Promise.all([listRecords(ctx.doc, ctx.zone.id), managedHostnames()]);
    res.json({
      zone: ctx.zone,
      editableTypes: EDITABLE_TYPES,
      records: records.map((r) => ({ ...r, environment: managed.get(r.name) || '', managed: r.comment.startsWith(MANAGED_MARK) })),
    });
  } catch (err) {
    res.status(502).json({ message: describeCloudflareError(err) });
  }
};

// Validates a record against its type; "@" and relative names are completed with the zone name.
const readRecord = (body: any, zoneName: string): { record?: RecordInput; error?: string } => {
  const type = String(body.type || '').toUpperCase() as DnsRecordType;
  if (!EDITABLE_TYPES.includes(type)) return { error: `Type must be one of ${EDITABLE_TYPES.join(', ')}` };
  let name = cleanString(body.name, 253).toLowerCase().replace(/\.$/, '');
  if (!name || name === '@') name = zoneName;
  else if (name !== zoneName && !name.endsWith(`.${zoneName}`)) name = `${name}.${zoneName}`;
  if (!/^(\*\.)?[a-z0-9_.-]+$/.test(name) || name.length > 253) return { error: 'Enter a valid record name' };
  const content = String(body.content ?? '').trim();
  if (type === 'A' && isIP(content) !== 4) return { error: 'An A record needs an IPv4 address' };
  if (type === 'AAAA' && isIP(content) !== 6) return { error: 'An AAAA record needs an IPv6 address' };
  if ((type === 'CNAME' || type === 'MX') && !HOSTNAME.test(content.replace(/\.$/, ''))) return { error: `A ${type} record needs a hostname` };
  if (type === 'TXT' && (!content || content.length > 2048)) return { error: 'TXT content must be 1–2048 characters' };
  const ttl = Number(body.ttl) || 1;
  if (ttl !== 1 && (ttl < 60 || ttl > 86400)) return { error: 'TTL is Auto (1) or 60–86400 seconds' };
  const priority = type === 'MX' ? Math.min(Math.max(Number(body.priority ?? 10), 0), 65535) : undefined;
  return {
    record: {
      type,
      name,
      content: type === 'CNAME' || type === 'MX' ? content.replace(/\.$/, '') : content,
      proxied: ['A', 'AAAA', 'CNAME'].includes(type) && Boolean(body.proxied),
      ttl,
      priority,
      comment: cleanString(body.comment, 100),
    },
  };
};

export const createZoneRecord = async (req: AuthRequest, res: Response): Promise<void> => {
  const ctx = await loadZone(req, res);
  if (!ctx) return;
  const { record, error } = readRecord(req.body || {}, ctx.zone.name);
  if (!record) {
    res.status(400).json({ message: error });
    return;
  }
  try {
    const created = await createRecord(ctx.doc, ctx.zone.id, record);
    await audit(req.user, { action: 'DNS_CHANGE', target: created.name, outcome: 'succeeded', message: `Created ${created.type} ${created.name} → ${created.content} in ${ctx.zone.name}` });
    res.status(201).json({ message: `${created.type} ${created.name} created`, record: created });
  } catch (err) {
    res.status(502).json({ message: describeCloudflareError(err) });
  }
};

export const updateZoneRecord = async (req: AuthRequest, res: Response): Promise<void> => {
  const ctx = await loadZone(req, res);
  if (!ctx) return;
  const { record, error } = readRecord(req.body || {}, ctx.zone.name);
  if (!record) {
    res.status(400).json({ message: error });
    return;
  }
  try {
    const updated = await updateRecord(ctx.doc, ctx.zone.id, String(req.params.recordId), record);
    await audit(req.user, { action: 'DNS_CHANGE', target: updated.name, outcome: 'succeeded', message: `Updated ${updated.type} ${updated.name} → ${updated.content} in ${ctx.zone.name}` });
    res.json({ message: `${updated.type} ${updated.name} saved`, record: updated });
  } catch (err) {
    res.status(502).json({ message: describeCloudflareError(err) });
  }
};

export const deleteZoneRecord = async (req: AuthRequest, res: Response): Promise<void> => {
  const ctx = await loadZone(req, res);
  if (!ctx) return;
  try {
    const name = cleanString(req.query.name, 253) || String(req.params.recordId);
    await deleteRecord(ctx.doc, ctx.zone.id, String(req.params.recordId));
    await audit(req.user, { action: 'DNS_CHANGE', target: name, outcome: 'succeeded', message: `Deleted DNS record ${name} in ${ctx.zone.name}` });
    res.json({ message: `${name} deleted` });
  } catch (err) {
    res.status(502).json({ message: describeCloudflareError(err) });
  }
};

// ---------------------------------------------------------------- tunnels (DevOps admins)

const TUNNEL_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

const serializeTunnel = async (t: ICloudflareTunnel, live = true) => {
  const routes = (await tunnelRoutes(t.tunnelId)).map((r) => ({ hostname: r.hostname, project: r.project.name, environment: envNameOf(r.app), projectId: String(r.project._id) }));
  const pods = live && t.deployed ? await connectorPods(t.clusterName, t.namespace).catch(() => []) : [];
  return {
    _id: String(t._id),
    name: t.name,
    tunnelId: t.tunnelId,
    connectorId: t.connectorId,
    clusterName: t.clusterName,
    namespace: t.namespace,
    replicas: t.replicas,
    deployed: t.deployed,
    status: t.status,
    connections: t.connections,
    lastError: t.lastError,
    lastCheckedAt: t.lastCheckedAt,
    createdBy: t.createdBy,
    createdAt: t.createdAt,
    routes,
    pods,
  };
};

// Refreshes status from Cloudflare; errors are recorded, not thrown.
const refreshTunnel = async (t: ICloudflareTunnel) => {
  const connector = await DnsIntegration.findById(t.connectorId);
  t.lastCheckedAt = new Date();
  if (!connector) {
    t.lastError = 'Its DNS connector was deleted';
    return;
  }
  try {
    const live = await getTunnel(connector, t.tunnelId);
    t.status = live.status;
    t.connections = live.connections.length;
    t.lastError = '';
  } catch (err) {
    t.lastError = describeCloudflareError(err);
  }
};

export const listTunnels = async (req: AuthRequest, res: Response): Promise<void> => {
  const live = req.query.live !== '0';
  const tunnels = await CloudflareTunnel.find().sort({ name: 1 });
  if (live) {
    await Promise.all(
      tunnels.map(async (t) => {
        await refreshTunnel(t);
        await t.save();
      })
    );
  }
  res.json({ tunnels: await Promise.all(tunnels.map((t) => serializeTunnel(t, live))) });
};

// POST /dns/tunnels { connectorId, clusterName, name, replicas, deploy }
export const createTunnelHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const body = req.body || {};
  const connector = await findDoc(body.connectorId);
  if (!connector || !connector.isActive) {
    res.status(400).json({ message: 'Pick an active DNS connector' });
    return;
  }
  if (!connector.accountId) {
    res.status(400).json({ message: `${connector.name} has no Account ID. Edit the connector and add it: tunnels live in the account.` });
    return;
  }
  const clusterName = cleanString(body.clusterName, 63);
  if (!clusterName || !(await Cluster.exists({ name: clusterName }))) {
    res.status(400).json({ message: 'Pick a cluster from Connectors → Clusters' });
    return;
  }
  const name = cleanString(body.name, 63).toLowerCase() || `di-${clusterName}`;
  if (!TUNNEL_NAME.test(name)) {
    res.status(400).json({ message: 'Tunnel name: lowercase letters, digits and dashes (3–63)' });
    return;
  }
  if (await CloudflareTunnel.exists({ name })) {
    res.status(409).json({ message: `A tunnel named ${name} already exists` });
    return;
  }
  const replicas = Math.min(Math.max(Number(body.replicas) || 1, 1), 3);
  const { doc, steps, error } = await provisionTunnel(connector, clusterName, name, { replicas, deploy: body.deploy !== false, createdBy: req.user?.email || '' });
  if (!doc) {
    res.status(502).json({ message: `Could not create the tunnel: ${error}`, steps });
    return;
  }
  await audit(req.user, { action: 'CONNECTOR', target: `Cloudflare Tunnel · ${name}`, outcome: 'changed', message: `Created tunnel ${name} for ${clusterName}${doc.deployed ? ' and deployed cloudflared' : ''}` });
  res.status(201).json({ message: `Tunnel ${name} created${doc.deployed ? ' and cloudflared is starting' : ''}`, steps, tunnel: await serializeTunnel(doc, false) });
};

export const redeployTunnel = async (req: AuthRequest, res: Response): Promise<void> => {
  const t = isValidId(req.params.id) ? await CloudflareTunnel.findById(req.params.id) : null;
  if (!t) {
    res.status(404).json({ message: 'Tunnel not found' });
    return;
  }
  try {
    const connector = await DnsIntegration.findById(t.connectorId);
    if (connector) t.token = await getTunnelToken(connector, t.tunnelId); // picks up a rotated token
    if (req.body?.replicas) t.replicas = Math.min(Math.max(Number(req.body.replicas) || 1, 1), 3);
    await deployTunnelConnector(t.clusterName, t.namespace, t.token, t.replicas);
    t.deployed = true;
    t.lastError = '';
    const rules = await syncTunnelIngress(t);
    await t.save();
    await audit(req.user, { action: 'CONNECTOR', target: `Cloudflare Tunnel · ${t.name}`, outcome: 'changed', message: `Redeployed cloudflared (${t.replicas} replica(s)), ${rules.length} route(s)` });
    res.json({ message: `cloudflared redeployed to ${t.clusterName} with ${rules.length} route(s)`, tunnel: await serializeTunnel(t, false) });
  } catch (err: any) {
    res.status(502).json({ message: `Redeploy failed: ${err?.body?.message || describeCloudflareError(err)}` });
  }
};

export const deleteTunnelHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const t = isValidId(req.params.id) ? await CloudflareTunnel.findById(req.params.id) : null;
  if (!t) {
    res.status(404).json({ message: 'Tunnel not found' });
    return;
  }
  const routes = await tunnelRoutes(t.tunnelId);
  if (routes.length && req.query.force !== 'true') {
    res.status(409).json({ message: `${t.name} still serves ${routes.map((r) => r.hostname).join(', ')}` });
    return;
  }
  const notes: string[] = [];
  if (t.deployed) await removeTunnelConnector(t.clusterName, t.namespace).catch((err) => notes.push(`cloudflared not removed: ${err?.message}`));
  const connector = await DnsIntegration.findById(t.connectorId);
  if (connector) await deleteTunnel(connector, t.tunnelId).catch((err) => notes.push(`Cloudflare: ${describeCloudflareError(err)}`));
  await t.deleteOne();
  await audit(req.user, { action: 'CONNECTOR', target: `Cloudflare Tunnel · ${t.name}`, outcome: 'changed', message: `Deleted tunnel ${t.name}${notes.length ? ` (${notes.join('; ')})` : ''}` });
  res.json({
    message: `Tunnel ${t.name} deleted${notes.length ? `. ${notes.join('. ')}` : ''}${routes.length ? `. ${routes.length} hostname(s) no longer route anywhere: point them elsewhere.` : ''}`,
  });
};

// ---------------------------------------------------------------- what can be seen of a domain

// Each Cloudflare section either has data or says which permission would show it.
const section = async <T>(p: Promise<T>, permission: string) => {
  try {
    return { data: await p, error: '' };
  } catch (err: any) {
    const status = err?.response?.status;
    return { data: null, error: status === 403 || status === 401 ? `The token needs ${permission}` : describeCloudflareError(err) };
  }
};

// Environments (any project) whose hostname is in this zone.
const zoneUsers = async (zoneId: string) => {
  const out: { project: string; projectId: string; environment: string; hostname: string }[] = [];
  for (const p of await Project.find({ 'argoApps.dns.zoneId': zoneId })) {
    for (const a of p.argoApps || []) if (a.dns?.zoneId === zoneId) out.push({ project: p.name, projectId: String(p._id), environment: envNameOf(a), hostname: a.dns.hostname });
  }
  return out;
};

// GET /dns/connectors/:id/zones/:zoneId/overview
export const getZoneOverview = async (req: AuthRequest, res: Response): Promise<void> => {
  const ctx = await loadZone(req, res);
  if (!ctx) return;
  const { doc, zone } = ctx;
  const [details, records, settings, apex, www, usedBy] = await Promise.all([
    section(getZone(doc, zone.id), 'Zone → Zone → Read'),
    section(listRecords(doc, zone.id), 'Zone → DNS → Read'),
    section(getZoneSettings(doc, zone.id), 'Zone → Zone Settings → Read'),
    inspectHost(zone.name),
    inspectHost(`www.${zone.name}`),
    zoneUsers(zone.id),
  ]);
  res.json({
    zone: details.data || zone,
    capabilities: doc.capabilities || null,
    records: records.data,
    recordsError: records.error,
    settings: settings.data,
    settingsError: settings.error,
    public: [apex, www],
    usedBy,
    checkedAt: new Date().toISOString(),
  });
};

// GET /dns/domains: every zone of every active connector with a quick public check (Public URLs page).
export const listDomains = async (req: AuthRequest, res: Response): Promise<void> => {
  const connectors = await DnsIntegration.find({ isActive: true }).sort({ isDefault: -1, name: 1 });
  const probe = req.query.probe !== '0';
  const domains: any[] = [];
  const errors: string[] = [];
  await Promise.all(
    connectors.map(async (c) => {
      let zones: Awaited<ReturnType<typeof cachedZones>> = [];
      try {
        zones = await cachedZones(c);
      } catch (err) {
        errors.push(`${c.name}: ${describeCloudflareError(err)}`);
        return;
      }
      await Promise.all(
        zones.map(async (z) => {
          const [apex, www, usedBy] = await Promise.all([probe ? inspectHost(z.name) : null, probe ? inspectHost(`www.${z.name}`) : null, zoneUsers(z.id)]);
          domains.push({ connectorId: String(c._id), connectorName: c.name, zone: z, apex, www, usedBy });
        })
      );
    })
  );
  domains.sort((a, b) => a.zone.name.localeCompare(b.zone.name));
  res.json({ domains, errors });
};
