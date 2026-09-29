import { Response } from 'express';
import { isIP } from 'node:net';
import { randomBytes } from 'node:crypto';
import { AuthRequest } from '../middleware/auth.js';
import { IArgoAppMapping, IProject, Project } from '../models/Project.js';
import { DnsIntegration } from '../models/DnsIntegration.js';
import { CloudflareTunnel, ICloudflareTunnel } from '../models/CloudflareTunnel.js';
import { ApprovalRequest } from '../models/ApprovalRequest.js';
import { ADMIN, DEPLOY, envLevel, envNameOf, isManager } from '../services/access.js';
import { audit, requiresApproval } from '../services/approvals.js';
import { createRecord, deleteRecord, describeCloudflareError, listRecords, tunnelTarget, updateRecord, zoneForHostname } from '../services/cloudflareClient.js';
import { environmentService, previewNamespaces, previewState, startPreview, stopPreview } from '../services/cloudflared.js';
import {
  activeConnector,
  ADDRESS_TYPES,
  cachedZones,
  checkReachable,
  clusterOf,
  compareRecords,
  envApp,
  expectedRecord,
  HOSTNAME,
  MANAGED_MARK,
  provisionTunnel,
  syncTunnelIngress,
} from '../services/dnsService.js';
import { cleanString, isValidId } from '../utils/validation.js';

const DNS_1035 = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/;

const loadProject = async (req: AuthRequest, res: Response) => {
  const project = isValidId(req.params.id) ? await Project.findById(req.params.id) : null;
  if (!project) {
    res.status(404).json({ message: 'Project not found' });
    return null;
  }
  return project;
};

const loadEnv = async (req: AuthRequest, res: Response) => {
  const project = await loadProject(req, res);
  if (!project) return null;
  const env = String(req.params.env);
  const app = envApp(project, env);
  if (!app) {
    res.status(404).json({ message: `${project.name} has no environment ${env}` });
    return null;
  }
  return { project, env, app };
};

const comment = (project: IProject, env: string) => `${MANAGED_MARK}: ${project.name}/${env}`;

// ---------------------------------------------------------------- status

// One environment's public address: configuration, what Cloudflare has, whether it answers, and the preview URL.
export const describeEnv = async (req: AuthRequest, project: IProject, app: IArgoAppMapping, probe: boolean) => {
  const env = envNameOf(app);
  const level = envLevel(req.user, project.name, env);
  const pending = await ApprovalRequest.findOne({ projectName: project.name, environment: env, status: 'PENDING', kind: { $in: ['dns.apply', 'dns.remove', 'preview.start'] } }).sort({ createdAt: -1 });
  const base = {
    env,
    namespace: app.targetNamespace,
    canConfigure: level >= ADMIN,
    canApply: level >= DEPLOY,
    requiresApproval: requiresApproval(project, env),
    pendingApproval: pending ? { id: String(pending._id), kind: pending.kind, summary: pending.summary, requestedBy: pending.requestedByName || pending.requestedBy, at: pending.createdAt } : null,
  };

  // Preview (quick tunnel) is independent of DNS.
  const previewLive = await previewState(clusterOf(project), app.targetNamespace).catch(() => null);
  const previewUrl = previewLive?.url || (previewLive?.running ? app.preview?.url || '' : '');
  const preview = {
    running: Boolean(previewLive?.running),
    ready: Boolean(previewLive?.ready),
    url: previewUrl,
    reason: previewLive?.reason || '',
    startedAt: app.preview?.startedAt,
    startedBy: app.preview?.startedBy || '',
    reachable: probe && previewUrl ? await checkReachable(previewUrl) : null,
  };

  const dns = app.dns;
  if (!dns?.hostname) return { ...base, dns: null, state: 'not-configured', message: 'No public hostname yet.', expected: null, records: [], reachable: null, tunnel: null, preview, publicUrl: previewUrl || '' };

  const connector = await DnsIntegration.findById(dns.connectorId);
  const plan = await expectedRecord(project, app, dns).catch((err) => ({ problem: describeCloudflareError(err), expected: undefined, tunnel: undefined }));
  const tunnel = plan.tunnel ? { id: plan.tunnel.tunnelId, name: plan.tunnel.name, status: plan.tunnel.status, connections: plan.tunnel.connections } : null;
  let records: Awaited<ReturnType<typeof listRecords>> = [];
  let state: string;
  let message: string;
  if (!connector) {
    state = 'error';
    message = 'The DNS connector of this hostname was deleted. Pick another connector.';
  } else {
    try {
      records = await listRecords(connector, dns.zoneId, { name: dns.hostname });
      const cmp = compareRecords(plan.expected, records);
      state = cmp.state;
      message = plan.problem && !plan.expected ? plan.problem : cmp.message;
    } catch (err) {
      state = 'error';
      message = describeCloudflareError(err);
    }
  }
  const url = `https://${dns.hostname}`;
  return {
    ...base,
    dns: { ...JSON.parse(JSON.stringify(dns)), connectorName: connector?.name || '' },
    state,
    message,
    expected: plan.expected || null,
    records: records.filter((r) => ADDRESS_TYPES.includes(r.type) || r.type === 'TXT'),
    reachable: probe ? await checkReachable(url) : null,
    tunnel,
    preview,
    publicUrl: url,
  };
};

// GET /projects/:id/dns: every environment the user can see.
export const getProjectDns = async (req: AuthRequest, res: Response): Promise<void> => {
  const project = await loadProject(req, res);
  if (!project) return;
  const probe = req.query.probe !== '0';
  const visible = (project.argoApps || []).filter((a) => envLevel(req.user, project.name, envNameOf(a)) >= 1);
  const environments = await Promise.all(visible.map((a) => describeEnv(req, project, a, probe)));

  // Choices for the configure form (names and zone names only; never credentials).
  const connectors = await DnsIntegration.find({ isActive: true }).sort({ isDefault: -1, name: 1 });
  const choices = await Promise.all(
    connectors.map(async (c) => ({
      id: String(c._id),
      name: c.name,
      isDefault: c.isDefault,
      hasAccount: Boolean(c.accountId),
      zones: await cachedZones(c).then((zs) => zs.map((z) => ({ id: z.id, name: z.name, status: z.status }))).catch(() => []),
    }))
  );
  const tunnels = (await CloudflareTunnel.find().sort({ name: 1 })).map((t) => ({ id: t.tunnelId, name: t.name, connectorId: t.connectorId, clusterName: t.clusterName, status: t.status }));
  res.json({ project: project.name, cluster: clusterOf(project), environments, connectors: choices, tunnels });
};

// ---------------------------------------------------------------- configure (project admin)

// PUT /projects/:id/environments/:env/dns  { hostname, connectorId, mode, target, tunnelId, service, port, proxied } or { clear: true }
export const setEnvironmentDns = async (req: AuthRequest, res: Response): Promise<void> => {
  const ctx = await loadEnv(req, res);
  if (!ctx) return;
  const { project, env, app } = ctx;
  const body = req.body || {};

  if (body.clear) {
    const previous = app.dns;
    app.dns = null;
    project.markModified('argoApps');
    await project.save();
    if (previous?.mode === 'tunnel') {
      const t = await CloudflareTunnel.findOne({ tunnelId: previous.tunnelId });
      if (t) await syncTunnelIngress(t).catch(() => undefined);
    }
    await audit(req.user, { action: 'SETTINGS', project: project.name, environment: env, target: previous?.hostname || env, outcome: 'changed', message: `Public hostname removed from ${env}. Existing DNS records were left as they are.` });
    res.json({ message: `${env} has no public hostname now. Its DNS record (if any) was left in Cloudflare; remove it first if it should go.` });
    return;
  }

  const hostname = cleanString(body.hostname, 253).toLowerCase().replace(/\.$/, '');
  if (!HOSTNAME.test(hostname)) {
    res.status(400).json({ message: 'Enter a full hostname, e.g. demo-api-dev.example.com' });
    return;
  }
  const connector = await activeConnector(body.connectorId ? String(body.connectorId) : undefined);
  if (!connector) {
    res.status(400).json({ message: 'No active DNS connector. Add Cloudflare in Connectors → DNS first.' });
    return;
  }
  let zones;
  try {
    zones = await cachedZones(connector, true);
  } catch (err) {
    res.status(502).json({ message: describeCloudflareError(err) });
    return;
  }
  const zone = zoneForHostname(zones, hostname);
  if (!zone) {
    res.status(400).json({ message: `${hostname} is not inside a zone ${connector.name} can manage (${zones.map((z) => z.name).join(', ') || 'none'}).` });
    return;
  }
  // One environment per hostname, across all projects.
  const clash = await Project.findOne({ argoApps: { $elemMatch: { 'dns.hostname': hostname } } });
  const clashEnv = clash?.argoApps.find((a) => a.dns?.hostname === hostname);
  if (clash && clashEnv && !(String(clash._id) === String(project._id) && envNameOf(clashEnv) === env)) {
    res.status(409).json({ message: `${hostname} is already used by ${clash.name}/${envNameOf(clashEnv)}` });
    return;
  }

  const mode = body.mode === 'tunnel' ? 'tunnel' : 'record';
  const target = cleanString(body.target, 253).toLowerCase().replace(/\.$/, '');
  const service = cleanString(body.service, 63);
  const port = Number(body.port) || 0;
  if (service && !DNS_1035.test(service)) {
    res.status(400).json({ message: 'Service must be a Kubernetes service name' });
    return;
  }
  if (port && !(port > 0 && port < 65536)) {
    res.status(400).json({ message: 'Port must be between 1 and 65535' });
    return;
  }
  let tunnelId = '';
  if (mode === 'tunnel') {
    const tunnel = body.tunnelId ? await CloudflareTunnel.findOne({ tunnelId: String(body.tunnelId) }) : await CloudflareTunnel.findOne({ connectorId: String(connector._id), clusterName: clusterOf(project) });
    if (!tunnel) {
      res.status(400).json({ message: `No Cloudflare Tunnel for cluster ${clusterOf(project)}. A DevOps admin creates one in Connectors → DNS → Tunnels.` });
      return;
    }
    if (tunnel.connectorId !== String(connector._id)) {
      res.status(400).json({ message: `Tunnel ${tunnel.name} belongs to another DNS connector` });
      return;
    }
    if (tunnel.clusterName !== clusterOf(project)) {
      res.status(400).json({ message: `Tunnel ${tunnel.name} runs in cluster ${tunnel.clusterName}, but ${project.name} deploys to ${clusterOf(project)}` });
      return;
    }
    tunnelId = tunnel.tunnelId;
  } else if (target && !HOSTNAME.test(target) && !isIP(target)) {
    res.status(400).json({ message: 'Target must be an IP address or a hostname' });
    return;
  }

  const previous = app.dns;
  app.dns = {
    hostname,
    connectorId: String(connector._id),
    zoneId: zone.id,
    zoneName: zone.name,
    mode,
    target: mode === 'record' ? target : '',
    tunnelId,
    service,
    port,
    proxied: mode === 'tunnel' ? true : body.proxied !== false,
    updatedAt: new Date(),
    updatedBy: req.user?.email || '',
  };
  project.markModified('argoApps');
  await project.save();

  // Tunnel routes follow the configuration (the DNS record itself needs Apply).
  const touched = new Set([previous?.mode === 'tunnel' ? previous.tunnelId : '', tunnelId].filter(Boolean));
  let routeNote = '';
  for (const id of touched) {
    const t = await CloudflareTunnel.findOne({ tunnelId: id });
    if (t) {
      await syncTunnelIngress(t).catch((err) => {
        routeNote = ` Tunnel routes could not be updated: ${describeCloudflareError(err)}`;
      });
    }
  }
  await audit(req.user, {
    action: 'SETTINGS',
    project: project.name,
    environment: env,
    target: hostname,
    outcome: 'changed',
    message: `Public hostname of ${env}: ${hostname} via ${mode === 'tunnel' ? 'tunnel' : target ? `record → ${target}` : 'record → Ingress address'}${previous?.hostname && previous.hostname !== hostname ? ` (was ${previous.hostname})` : ''}`,
  });
  res.json({ message: `${env} will be served at ${hostname}. Press Apply to create the DNS record.${routeNote}`, dns: app.dns });
};

// ---------------------------------------------------------------- apply / remove (build and deploy, approval-gated)

// POST /projects/:id/environments/:env/dns/apply
export const applyEnvironmentDns = async (req: AuthRequest, res: Response): Promise<void> => {
  const ctx = await loadEnv(req, res);
  if (!ctx) return;
  const { project, env, app } = ctx;
  const dns = app.dns;
  if (!dns?.hostname) {
    res.status(400).json({ message: `${env} has no public hostname. Set one first.` });
    return;
  }
  const connector = await DnsIntegration.findById(dns.connectorId);
  if (!connector || !connector.isActive) {
    res.status(400).json({ message: 'The DNS connector of this hostname is missing or disabled' });
    return;
  }
  try {
    const plan = await expectedRecord(project, app, dns);
    if (!plan.expected) {
      res.status(400).json({ message: plan.problem });
      return;
    }
    const want = { type: plan.expected.type, name: dns.hostname, content: plan.expected.content, proxied: plan.expected.proxied, ttl: 1, comment: comment(project, env) };
    const current = (await listRecords(connector, dns.zoneId, { name: dns.hostname })).filter((r) => ADDRESS_TYPES.includes(r.type));
    const before = current.map((r) => `${r.type} ${r.content}`).join(', ') || 'nothing';
    const cmp = compareRecords(plan.expected, current);
    if (plan.tunnel) await syncTunnelIngress(plan.tunnel);
    if (cmp.state === 'ok') {
      res.json({ message: `${dns.hostname} already points at ${plan.expected.content}. Nothing to change.`, changed: false });
      return;
    }
    // Keep one address record: update the first, delete the rest (Cloudflare refuses CNAME next to A/AAAA).
    const [first, ...extra] = current;
    for (const r of extra) await deleteRecord(connector, dns.zoneId, r.id);
    const record = first ? await updateRecord(connector, dns.zoneId, first.id, want) : await createRecord(connector, dns.zoneId, want);
    res.json({
      message: `${dns.hostname}: ${before} → ${record.type} ${record.content}${record.proxied ? ' (proxied)' : ''}. DNS can take a minute to spread.`,
      changed: true,
      record,
    });
  } catch (err) {
    res.status(502).json({ message: describeCloudflareError(err) });
  }
};

// DELETE /projects/:id/environments/:env/dns/record
export const removeEnvironmentDnsRecord = async (req: AuthRequest, res: Response): Promise<void> => {
  const ctx = await loadEnv(req, res);
  if (!ctx) return;
  const { env, app } = ctx;
  const dns = app.dns;
  if (!dns?.hostname) {
    res.status(400).json({ message: `${env} has no public hostname` });
    return;
  }
  const connector = await DnsIntegration.findById(dns.connectorId);
  if (!connector) {
    res.status(400).json({ message: 'The DNS connector of this hostname was deleted' });
    return;
  }
  try {
    const current = (await listRecords(connector, dns.zoneId, { name: dns.hostname })).filter((r) => ADDRESS_TYPES.includes(r.type));
    for (const r of current) await deleteRecord(connector, dns.zoneId, r.id);
    res.json({ message: current.length ? `Removed ${current.map((r) => `${r.type} ${r.content}`).join(', ')} for ${dns.hostname}` : `${dns.hostname} had no DNS record`, removed: current.length });
  } catch (err) {
    res.status(502).json({ message: describeCloudflareError(err) });
  }
};

// ---------------------------------------------------------------- preview URL (quick tunnel)

const waitForUrl = async (cluster: string, namespace: string, seconds: number) => {
  for (let i = 0; i < seconds; i += 2) {
    const s = await previewState(cluster, namespace).catch(() => null);
    if (s?.url) return s.url;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return '';
};

// POST /projects/:id/environments/:env/preview (approval-gated like a deploy)
export const startEnvironmentPreview = async (req: AuthRequest, res: Response): Promise<void> => {
  const ctx = await loadEnv(req, res);
  if (!ctx) return;
  const { project, env, app } = ctx;
  const cluster = clusterOf(project);
  try {
    const svc = await environmentService(cluster, app.targetNamespace, app.dns?.service, app.dns?.port);
    if (!svc) {
      res.status(400).json({ message: `No Service in ${app.targetNamespace} to expose. Deploy ${env} first.` });
      return;
    }
    await startPreview(cluster, app.targetNamespace, svc.url);
    const url = await waitForUrl(cluster, app.targetNamespace, 40);
    app.preview = { url, startedAt: new Date(), startedBy: req.user?.email || '' };
    project.markModified('argoApps');
    await project.save();
    res.json({
      message: url ? `${env} is public at ${url} until you stop the preview.` : `Preview of ${env} is starting (image pull). The URL appears here in a moment.`,
      url,
      service: `${svc.name}:${svc.port}`,
    });
  } catch (err: any) {
    res.status(502).json({ message: `Could not start the preview: ${err?.body?.message || err?.message || err}` });
  }
};

// DELETE /projects/:id/environments/:env/preview (closing public access never needs approval)
export const stopEnvironmentPreview = async (req: AuthRequest, res: Response): Promise<void> => {
  const ctx = await loadEnv(req, res);
  if (!ctx) return;
  const { project, env, app } = ctx;
  try {
    const stopped = await stopPreview(clusterOf(project), app.targetNamespace);
    const url = app.preview?.url;
    app.preview = null;
    project.markModified('argoApps');
    await project.save();
    await audit(req.user, { action: 'PUBLIC_PREVIEW', project: project.name, environment: env, target: url || env, outcome: 'succeeded', message: `Preview of ${env} stopped` });
    res.json({ message: stopped ? `Preview of ${env} stopped. ${url || 'The URL'} no longer works.` : `${env} had no preview running` });
  } catch (err: any) {
    res.status(502).json({ message: `Could not stop the preview: ${err?.body?.message || err?.message || err}` });
  }
};

// GET /dns/public-urls: every public hostname and running preview in the projects the user can see.
export const getPublicUrls = async (req: AuthRequest, res: Response): Promise<void> => {
  const probe = req.query.probe !== '0';
  const projects = await Project.find().sort({ name: 1 });
  const clusters = [...new Set(projects.map(clusterOf))];
  const previews = new Map<string, Set<string> | null>();
  await Promise.all(clusters.map(async (c) => previews.set(c, await previewNamespaces(c).catch(() => null))));

  const jobs: Promise<unknown>[] = [];
  const items: any[] = [];
  const unreachableClusters = clusters.filter((c) => !previews.get(c));
  for (const project of projects) {
    const inPreview = previews.get(clusterOf(project));
    for (const app of project.argoApps || []) {
      const env = envNameOf(app);
      if (envLevel(req.user, project.name, env) < 1) continue;
      // Unknown cluster state: fall back to what was recorded when the preview started.
      const hasPreview = inPreview ? inPreview.has(app.targetNamespace) : Boolean(app.preview?.url);
      if (!app.dns?.hostname && !hasPreview) continue;
      jobs.push(
        describeEnv(req, project, app, probe).then((d) =>
          items.push({ projectId: String(project._id), projectName: project.name, cluster: clusterOf(project), ...d })
        )
      );
    }
  }
  await Promise.all(jobs);
  items.sort((a, b) => a.projectName.localeCompare(b.projectName) || a.env.localeCompare(b.env));
  const hostnames = items.filter((i) => i.dns);
  const running = items.filter((i) => i.preview?.running);
  res.json({
    items,
    summary: {
      hostnames: hostnames.length,
      live: hostnames.filter((i) => i.state === 'ok').length,
      needAttention: hostnames.filter((i) => i.state !== 'ok').length,
      previews: running.length,
      oldPreviews: running.filter((i) => i.preview.startedAt && Date.now() - new Date(i.preview.startedAt).getTime() > 24 * 3600_000).length,
    },
    unreachableClusters,
  });
};

// ---------------------------------------------------------------- one click: random subdomain through a tunnel

const randomSuffix = () => randomBytes(3).toString('hex').slice(0, 4);
// <project>-<env>-<4 chars>, one DNS label (Cloudflare's free certificate covers one level below the zone).
const randomLabel = (project: string, env: string) => {
  const base = `${project}-${env}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
    .replace(/-$/, '');
  return `${base || 'env'}-${randomSuffix()}`;
};

// POST /projects/:id/environments/:env/dns/quick { zoneId?, connectorId?, regenerate? }
// Picks a random hostname in a zone, makes sure the cluster has a tunnel (DevOps admins may create one here),
// creates the proxied CNAME and routes the tunnel to the environment's Service. Nothing is saved if DNS fails.
export const quickEnvironmentDns = async (req: AuthRequest, res: Response): Promise<void> => {
  const ctx = await loadEnv(req, res);
  if (!ctx) return;
  const { project, env, app } = ctx;
  const body = req.body || {};
  const previous = app.dns;
  if (previous?.hostname && !body.regenerate) {
    res.status(409).json({ message: `${env} already has ${previous.hostname}. Use "New random URL" to replace it.` });
    return;
  }
  if (previous?.hostname && !previous.random) {
    res.status(409).json({ message: `${previous.hostname} was set by hand. Clear it first if you want a random URL instead.` });
    return;
  }

  const connector = await activeConnector(body.connectorId ? String(body.connectorId) : previous?.connectorId || undefined);
  if (!connector) {
    res.status(400).json({ message: 'No active DNS connector. A DevOps admin adds Cloudflare in Connectors → DNS.' });
    return;
  }
  // Fail early with the missing permission instead of half-doing it.
  const caps = connector.capabilities;
  if (caps && !caps.dnsRead) {
    res.status(400).json({ message: `The Cloudflare token of ${connector.name} cannot manage DNS records. Add Zone → DNS → Edit to the token, then press Test on the connector.` });
    return;
  }
  if (!connector.accountId) {
    res.status(400).json({ message: `${connector.name} has no Account ID, which tunnels need. Add it on the connector.` });
    return;
  }

  let zones;
  try {
    zones = (await cachedZones(connector)).filter((z) => z.status === 'active' && !z.paused);
  } catch (err) {
    res.status(502).json({ message: describeCloudflareError(err) });
    return;
  }
  const zone = body.zoneId ? zones.find((z) => z.id === String(body.zoneId)) : zones.find((z) => z.id === previous?.zoneId) || zones[0];
  if (!zone) {
    res.status(400).json({ message: `${connector.name} has no active domain to create a URL in.` });
    return;
  }

  // The cluster's tunnel; DevOps admins get one created (and cloudflared deployed) on the fly.
  const cluster = clusterOf(project);
  const steps: { label: string; ok: boolean; detail: string }[] = [];
  let tunnel: ICloudflareTunnel | null =
    (previous?.tunnelId ? await CloudflareTunnel.findOne({ tunnelId: previous.tunnelId }) : null) ||
    (await CloudflareTunnel.findOne({ connectorId: String(connector._id), clusterName: cluster }));
  if (!tunnel) {
    if (!isManager(req.user)) {
      res.status(400).json({ message: `Cluster ${cluster} has no Cloudflare Tunnel yet. A DevOps admin creates one in Connectors → DNS → Tunnels (or presses Get random URL once).` });
      return;
    }
    let name = `di-${cluster}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 55);
    if (await CloudflareTunnel.exists({ name })) name = `${name}-${randomSuffix()}`;
    const made = await provisionTunnel(connector, cluster, name, { deploy: body.deploy !== false, createdBy: req.user?.email || '' });
    steps.push(...made.steps);
    if (!made.doc) {
      res.status(502).json({ message: `Could not create a tunnel: ${made.error}. The token needs Account → Cloudflare Tunnel → Edit.`, steps });
      return;
    }
    tunnel = made.doc;
    await audit(req.user, { action: 'CONNECTOR', target: `Cloudflare Tunnel · ${name}`, outcome: 'changed', message: `Created tunnel ${name} for ${cluster} (Get random URL)` });
  }

  const svc = await environmentService(cluster, app.targetNamespace, previous?.service, previous?.port).catch(() => null);
  if (!svc || !tunnel) {
    res.status(400).json({ message: `No Service in ${app.targetNamespace} to route to. Deploy ${env} first.`, steps });
    return;
  }
  const t: ICloudflareTunnel = tunnel;

  // A fresh name that nobody uses (in DevOps Intelligence or in the zone).
  let hostname = '';
  try {
    for (let i = 0; i < 5 && !hostname; i++) {
      const candidate = `${randomLabel(project.name, env)}.${zone.name}`;
      const taken = (await Project.exists({ 'argoApps.dns.hostname': candidate })) || (await listRecords(connector, zone.id, { name: candidate })).length > 0;
      if (!taken) hostname = candidate;
    }
    if (!hostname) throw new Error('Could not find a free random name; try again');
    await createRecord(connector, zone.id, { type: 'CNAME', name: hostname, content: tunnelTarget(t.tunnelId), proxied: true, ttl: 1, comment: comment(project, env) });
    steps.push({ label: `DNS record ${hostname}`, ok: true, detail: `CNAME → ${tunnelTarget(t.tunnelId)} (proxied)` });
  } catch (err) {
    const status = (err as any)?.response?.status;
    const message = status === 403 || status === 401 ? `Cloudflare refused to create the DNS record: the token needs Zone → DNS → Edit on ${zone.name}.` : describeCloudflareError(err);
    res.status(502).json({ message, steps });
    return;
  }

  app.dns = {
    hostname,
    connectorId: String(connector._id),
    zoneId: zone.id,
    zoneName: zone.name,
    mode: 'tunnel',
    target: '',
    tunnelId: t.tunnelId,
    service: previous?.service || '',
    port: previous?.port || 0,
    proxied: true,
    random: true,
    updatedAt: new Date(),
    updatedBy: req.user?.email || '',
  };
  project.markModified('argoApps');
  await project.save();

  try {
    const rules = await syncTunnelIngress(t);
    steps.push({ label: 'Tunnel route', ok: true, detail: `${hostname} → ${svc.url} (${rules.length} route(s) on ${t.name})` });
  } catch (err) {
    steps.push({ label: 'Tunnel route', ok: false, detail: describeCloudflareError(err) });
  }

  // The old random name goes away (its record was ours).
  if (previous?.hostname && previous.random && previous.zoneId) {
    try {
      const old = (await listRecords(connector, previous.zoneId, { name: previous.hostname })).filter((r) => ADDRESS_TYPES.includes(r.type));
      for (const r of old) await deleteRecord(connector, previous.zoneId, r.id);
      steps.push({ label: `Old URL ${previous.hostname} removed`, ok: true, detail: '' });
    } catch (err) {
      steps.push({ label: `Old URL ${previous.hostname}`, ok: false, detail: `Remove it by hand: ${describeCloudflareError(err)}` });
    }
  }

  const url = `https://${hostname}`;
  res.json({
    message: `${env} is at ${url}${t.status === 'healthy' ? '' : '. The tunnel is still connecting; the URL works as soon as cloudflared is up (usually under a minute)'}.`,
    url,
    hostname,
    steps,
  });
};
