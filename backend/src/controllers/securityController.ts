import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { Cluster } from '../models/Cluster.js';
import { IProject, Project } from '../models/Project.js';
import { ISonarIntegration, SonarIntegration } from '../models/SonarIntegration.js';
import { ADMIN, DEPLOY, envLevel, envNameOf, projectLevel } from '../services/access.js';
import { audit, requiresApproval } from '../services/approvals.js';
import { describeSonarError, pendingTasks, probeSonar, SonarFields } from '../services/sonarClient.js';
import { analysisStatus, envReports, qualityOf, releaseChecks, sonarKeyOf, startAnalysis } from '../services/securityService.js';
import { reportVulnerabilities, sumReports, trivyStatus } from '../services/trivyService.js';
import { ENV_ORDER } from './environmentController.js';
import { resolveClients } from './clusterController.js';
import { maskSecret } from '../utils/secrets.js';
import { cleanString, isHttpUrl, isValidId, nameMatch, normalizeUrl } from '../utils/validation.js';

const DNS_LABEL = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const SONAR_KEY = /^(?!\d+$)[a-zA-Z0-9_.:-]{1,400}$/;

// ---------------------------------------------------------------- SonarQube connectors (DevOps admins)

export const serializeSonar = (c: ISonarIntegration) => ({
  _id: String(c._id),
  name: c.name,
  access: c.access,
  clusterName: c.clusterName,
  namespace: c.namespace,
  service: c.service,
  port: c.port,
  url: c.url,
  publicUrl: c.publicUrl,
  organization: c.organization,
  hasToken: Boolean(c.token),
  tokenHint: maskSecret(c.token),
  isDefault: c.isDefault,
  isActive: c.isActive,
  status: c.status,
  version: c.version,
  lastError: c.lastError,
  lastTestedAt: c.lastTestedAt,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const readSonar = (body: any, current?: ISonarIntegration | null): { fields?: SonarFields & { name: string; publicUrl: string }; error?: string } => {
  const name = cleanString(body.name ?? current?.name, 80);
  if (!name) return { error: 'Enter a name' };
  const access = (body.access ?? current?.access ?? 'service') === 'url' ? 'url' : 'service';
  const fields = {
    name,
    access,
    clusterName: cleanString(body.clusterName ?? current?.clusterName, 63),
    namespace: cleanString(body.namespace ?? current?.namespace, 63),
    service: cleanString(body.service ?? current?.service, 63),
    port: Number(body.port ?? current?.port) || 0,
    url: body.url !== undefined ? normalizeUrl(String(body.url)) : current?.url || '',
    publicUrl: body.publicUrl !== undefined ? normalizeUrl(String(body.publicUrl)) : current?.publicUrl || '',
    token: body.token ? String(body.token).trim() : current?.token || '',
    organization: cleanString(body.organization ?? current?.organization, 100),
  } as SonarFields & { name: string; publicUrl: string };
  if (!fields.token) return { error: 'Enter a SonarQube user token' };
  if (access === 'service') {
    if (!fields.clusterName) return { error: 'Pick the cluster that runs SonarQube' };
    if (!DNS_LABEL.test(fields.namespace) || !DNS_LABEL.test(fields.service)) return { error: 'Enter a valid namespace and service name' };
    if (!(fields.port > 0 && fields.port < 65536)) return { error: 'Enter the service port (usually 9000)' };
  } else if (!isHttpUrl(fields.url)) return { error: 'Enter a valid http(s) URL' };
  if (fields.publicUrl && !isHttpUrl(fields.publicUrl)) return { error: 'Browser URL must be a valid http(s) URL' };
  return { fields };
};

const applySonarProbe = async (doc: ISonarIntegration) => {
  doc.lastTestedAt = new Date();
  try {
    const r = await probeSonar(doc);
    doc.status = 'Connected';
    doc.version = r.version;
    doc.lastError = '';
    return { ok: true, message: r.message };
  } catch (err) {
    doc.status = 'Error';
    doc.lastError = err instanceof Error && !(err as any).response ? err.message : describeSonarError(err);
    return { ok: false, message: doc.lastError };
  }
};

const findSonar = (id: unknown) => (isValidId(id) ? SonarIntegration.findById(id) : Promise.resolve(null));

export const listSonarConnectors = async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({ connectors: (await SonarIntegration.find().sort({ isDefault: -1, name: 1 })).map(serializeSonar) });
};

export const createSonarConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  const { fields, error } = readSonar(req.body || {});
  if (!fields) {
    res.status(400).json({ message: error });
    return;
  }
  if (await SonarIntegration.exists({ name: nameMatch(fields.name) })) {
    res.status(409).json({ message: `A SonarQube connector named ${fields.name} already exists` });
    return;
  }
  const first = !(await SonarIntegration.exists({}));
  const doc = new SonarIntegration({ ...fields, isDefault: first || Boolean(req.body.isDefault), isActive: req.body.isActive !== false });
  if (doc.isDefault) await SonarIntegration.updateMany({}, { isDefault: false });
  const test = await applySonarProbe(doc);
  await doc.save();
  await audit(req.user, { action: 'CONNECTOR', target: `SonarQube · ${doc.name}`, outcome: 'changed', message: `Added. ${test.message}` });
  res.status(201).json({ message: `${doc.name} added`, test, connector: serializeSonar(doc) });
};

export const updateSonarConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  const doc = await findSonar(req.params.id);
  if (!doc) {
    res.status(404).json({ message: 'SonarQube connector not found' });
    return;
  }
  const { fields, error } = readSonar(req.body || {}, doc);
  if (!fields) {
    res.status(400).json({ message: error });
    return;
  }
  if (fields.name.toLowerCase() !== doc.name.toLowerCase() && (await SonarIntegration.exists({ name: nameMatch(fields.name) }))) {
    res.status(409).json({ message: `A SonarQube connector named ${fields.name} already exists` });
    return;
  }
  Object.assign(doc, fields);
  if (typeof req.body.isActive === 'boolean') doc.isActive = req.body.isActive;
  if (req.body.isDefault === true) {
    await SonarIntegration.updateMany({ _id: { $ne: doc._id } }, { isDefault: false });
    doc.isDefault = true;
  }
  const test = await applySonarProbe(doc);
  await doc.save();
  await audit(req.user, { action: 'CONNECTOR', target: `SonarQube · ${doc.name}`, outcome: 'changed', message: `Updated${req.body.token ? ' (new token)' : ''}. ${test.message}` });
  res.json({ message: `${doc.name} saved`, test, connector: serializeSonar(doc) });
};

export const setDefaultSonarConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  const doc = await findSonar(req.params.id);
  if (!doc) {
    res.status(404).json({ message: 'SonarQube connector not found' });
    return;
  }
  await SonarIntegration.updateMany({ _id: { $ne: doc._id } }, { isDefault: false });
  doc.isDefault = true;
  await doc.save();
  res.json({ message: `'${doc.name}' is now the default SonarQube`, connector: serializeSonar(doc) });
};

export const deleteSonarConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  const doc = await findSonar(req.params.id);
  if (!doc) {
    res.status(404).json({ message: 'SonarQube connector not found' });
    return;
  }
  const used = await Project.countDocuments({ 'security.sonarConnectorId': String(doc._id) });
  if (used && req.query.force !== 'true') {
    res.status(409).json({ message: `${doc.name} is selected by ${used} project(s)` });
    return;
  }
  await doc.deleteOne();
  if (doc.isDefault) {
    const next = await SonarIntegration.findOne().sort({ createdAt: 1 });
    if (next) await SonarIntegration.updateOne({ _id: next._id }, { isDefault: true });
  }
  await audit(req.user, { action: 'CONNECTOR', target: `SonarQube · ${doc.name}`, outcome: 'changed', message: 'Deleted with its saved token' });
  res.json({ message: `${doc.name} deleted` });
};

export const testSonarConnection = async (req: AuthRequest, res: Response): Promise<void> => {
  const current = await findSonar(req.body?.id);
  const { fields, error } = readSonar(req.body || {}, current);
  if (!fields) {
    res.status(400).json({ ok: false, message: error });
    return;
  }
  try {
    const r = await probeSonar(fields);
    res.json({ ok: true, message: r.message, details: { version: r.version } });
  } catch (err) {
    res.json({ ok: false, message: err instanceof Error && !(err as any).response ? err.message : describeSonarError(err) });
  }
};

export const testSavedSonarConnector = async (req: AuthRequest, res: Response): Promise<void> => {
  const doc = await findSonar(req.params.id);
  if (!doc) {
    res.status(404).json({ message: 'SonarQube connector not found' });
    return;
  }
  const test = await applySonarProbe(doc);
  await doc.save();
  res.json({ ...test, connector: serializeSonar(doc) });
};

// SonarQube services running in a cluster (for the "Discover" button).
export const discoverSonar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clusterName = cleanString(req.query.cluster, 63) || (await Cluster.findOne({ isDefault: true }))?.name || 'minikube';
    const { core } = await resolveClients(clusterName);
    const services = await core.listServiceForAllNamespaces();
    const existing = await SonarIntegration.find({ access: 'service', clusterName });
    const found = services.items
      .filter((s) => /sonarqube/.test(`${s.metadata?.name} ${s.metadata?.labels?.['app.kubernetes.io/name'] || ''} ${s.metadata?.labels?.app || ''}`) && !/postgres|headless/.test(s.metadata?.name || ''))
      .map((s) => {
        const port = (s.spec?.ports || []).find((p) => p.port === 9000)?.port || s.spec?.ports?.[0]?.port || 9000;
        return {
          clusterName,
          namespace: s.metadata?.namespace || '',
          service: s.metadata?.name || '',
          port,
          suggestedName: `SonarQube (${clusterName})`,
          alreadyAdded: existing.some((e) => e.namespace === s.metadata?.namespace && e.service === s.metadata?.name),
        };
      });
    res.json({ cluster: clusterName, services: found });
  } catch (err: any) {
    res.status(502).json({ message: err?.message || 'Discovery failed' });
  }
};

// Trivy Operator per cluster (Connectors → Security).
export const getTrivyStatus = async (_req: AuthRequest, res: Response): Promise<void> => {
  const clusters = await Cluster.find().sort({ name: 1 });
  const names = clusters.length ? clusters.map((c) => c.name) : ['minikube'];
  const status = await Promise.all(
    names.map(async (name) => {
      try {
        return { cluster: name, ...(await trivyStatus(name)), error: '' };
      } catch (err: any) {
        return { cluster: name, installed: false, ready: false, version: '', reports: 0, namespace: '', error: err?.message || 'Cluster not reachable' };
      }
    })
  );
  res.json({ clusters: status });
};

// ---------------------------------------------------------------- per project

const rankOf = (env: string) => {
  const i = ENV_ORDER.indexOf(env.toLowerCase());
  return i < 0 ? 50 : i;
};

const orderedEnvs = (p: IProject) => [...(p.argoApps || [])].sort((a, b) => rankOf(envNameOf(a)) - rankOf(envNameOf(b)));

const loadProject = async (req: AuthRequest, res: Response) => {
  const project = isValidId(req.params.id) ? await Project.findById(req.params.id) : null;
  if (!project) res.status(404).json({ message: 'Project not found' });
  return project;
};

// GET /projects/:id/security
export const getProjectSecurity = async (req: AuthRequest, res: Response): Promise<void> => {
  const project = await loadProject(req, res);
  if (!project) return;
  const envs = orderedEnvs(project).filter((a) => envLevel(req.user, project.name, envNameOf(a)) >= 1);
  const [sonar, environments] = await Promise.all([
    qualityOf(project),
    Promise.all(
      envs.map(async (a) => {
        const env = envNameOf(a);
        const { reports, error } = await envReports(project, env);
        return { env, namespace: a.targetNamespace, reports, totals: sumReports(reports), error, requiresApproval: requiresApproval(project, env) };
      })
    ),
  ]);

  // Release checks for each gated environment, against the environment before it.
  const all = orderedEnvs(project).map(envNameOf);
  const release = await Promise.all(
    environments
      .filter((e) => e.requiresApproval)
      .map(async (e) => {
        const idx = all.indexOf(e.env);
        const from = idx > 0 ? all[idx - 1] : undefined;
        return { env: e.env, from, ...(await releaseChecks(project, e.env, from)) };
      })
  );

  const level = projectLevel(req.user, project.name);
  const s = project.security;
  res.json({
    project: project.name,
    policy: { sonarConnectorId: s?.sonarConnectorId || '', sonarProjectKey: s?.sonarProjectKey || '', blockOnQualityGate: Boolean(s?.blockOnQualityGate), blockOnCritical: Boolean(s?.blockOnCritical) },
    projectKey: sonarKeyOf(project),
    sonar: {
      connector: sonar.connector ? { id: String(sonar.connector._id), name: sonar.connector.name, access: sonar.connector.access, publicUrl: sonar.connector.publicUrl } : null,
      quality: sonar.quality,
      error: sonar.error,
      pending: sonar.connector && sonar.quality ? await pendingTasks(sonar.connector, sonarKeyOf(project)).catch(() => 0) : 0,
    },
    lastAnalysis: s?.lastAnalysis || null,
    environments,
    release,
    canConfigure: level >= ADMIN,
    canAnalyze: level >= DEPLOY,
    connectors: (await SonarIntegration.find({ isActive: true }).sort({ isDefault: -1, name: 1 })).map((c) => ({ id: String(c._id), name: c.name, isDefault: c.isDefault })),
  });
};

// GET /projects/:id/environments/:env/vulnerabilities/:report
export const getVulnerabilityReport = async (req: AuthRequest, res: Response): Promise<void> => {
  const project = await loadProject(req, res);
  if (!project) return;
  const app = (project.argoApps || []).find((a) => envNameOf(a) === String(req.params.env));
  if (!app) {
    res.status(404).json({ message: 'Environment not found' });
    return;
  }
  try {
    const cluster = project.kubernetesMappings?.[0]?.clusterName || 'minikube';
    res.json(await reportVulnerabilities(cluster, app.targetNamespace, String(req.params.report)));
  } catch (err: any) {
    res.status(err?.response?.status === 404 ? 404 : 502).json({ message: err?.response?.status === 404 ? 'Report not found (it may have been re-created by a new scan)' : err?.message });
  }
};

// PUT /projects/:id/security (project admin)
export const setProjectSecurity = async (req: AuthRequest, res: Response): Promise<void> => {
  const project = await loadProject(req, res);
  if (!project) return;
  const body = req.body || {};
  const key = cleanString(body.sonarProjectKey, 400);
  if (key && !SONAR_KEY.test(key)) {
    res.status(400).json({ message: 'SonarQube project key: letters, digits, - _ . : (not only digits)' });
    return;
  }
  if (body.sonarConnectorId && !(await SonarIntegration.exists({ _id: isValidId(body.sonarConnectorId) ? body.sonarConnectorId : null }))) {
    res.status(400).json({ message: 'Unknown SonarQube connector' });
    return;
  }
  const before = project.security || {};
  project.security = {
    ...(JSON.parse(JSON.stringify(before)) as object),
    sonarConnectorId: body.sonarConnectorId !== undefined ? String(body.sonarConnectorId || '') : before.sonarConnectorId || '',
    sonarProjectKey: body.sonarProjectKey !== undefined ? key : before.sonarProjectKey || '',
    blockOnQualityGate: body.blockOnQualityGate !== undefined ? Boolean(body.blockOnQualityGate) : Boolean(before.blockOnQualityGate),
    blockOnCritical: body.blockOnCritical !== undefined ? Boolean(body.blockOnCritical) : Boolean(before.blockOnCritical),
  };
  project.markModified('security');
  await project.save();
  const s = project.security;
  await audit(req.user, {
    action: 'SETTINGS',
    project: project.name,
    target: 'security',
    outcome: 'changed',
    message: `Security: SonarQube key ${sonarKeyOf(project)}; block on failed quality gate ${s.blockOnQualityGate ? 'on' : 'off'}; block on critical CVEs ${s.blockOnCritical ? 'on' : 'off'}`,
  });
  res.json({ message: 'Security settings saved', policy: s });
};

// POST /projects/:id/security/analysis
export const runAnalysis = async (req: AuthRequest, res: Response): Promise<void> => {
  const project = await loadProject(req, res);
  if (!project) return;
  const last = project.security?.lastAnalysis;
  if (last) {
    const st = await analysisStatus(last.clusterName, last.namespace, last.job).catch(() => null);
    if (st?.state === 'running') {
      res.status(409).json({ message: 'An analysis is already running' });
      return;
    }
  }
  try {
    const started = await startAnalysis(project, req.user?.email || '');
    project.security = { ...(JSON.parse(JSON.stringify(project.security || {})) as object), lastAnalysis: started };
    project.markModified('security');
    await project.save();
    await audit(req.user, { action: 'SETTINGS', project: project.name, target: started.job, outcome: 'succeeded', message: `SonarQube analysis of ${started.repo}@${started.branch} started` });
    res.status(202).json({ message: `Analysis of ${started.repo}@${started.branch} started. It takes 1–3 minutes.`, analysis: started });
  } catch (err: any) {
    res.status(err?.status || 502).json({ message: err?.body?.message || err?.message || 'Could not start the analysis' });
  }
};

// GET /projects/:id/security/analysis
export const getAnalysis = async (req: AuthRequest, res: Response): Promise<void> => {
  const project = await loadProject(req, res);
  if (!project) return;
  const last = project.security?.lastAnalysis;
  if (!last) {
    res.json({ analysis: null });
    return;
  }
  try {
    const st = await analysisStatus(last.clusterName, last.namespace, last.job);
    const { connector } = await qualityOf(project);
    const pending = connector ? await pendingTasks(connector, last.projectKey).catch(() => 0) : 0;
    res.json({ analysis: { ...last, ...st, pending } });
  } catch (err: any) {
    res.json({ analysis: { ...last, state: 'unknown', log: '', reason: err?.message || '' } });
  }
};

// ---------------------------------------------------------------- promotion guard

// Before a promotion into a gated environment: refuse when the project's policy blocks on a failing check.
// Used on the route (before the approval gate) and again when an approved request runs.
export const releaseGuard = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const project = isValidId(req.params.id) ? await Project.findById(req.params.id) : null;
    const to = String(req.body?.to || '');
    if (project && to && project.security && (project.security.blockOnQualityGate || project.security.blockOnCritical)) {
      const r = await releaseChecks(project, to, req.body?.from ? String(req.body.from) : undefined);
      if (r.blocked) {
        const reasons = r.checks.filter((c) => c.blocking).map((c) => `${c.label}: ${c.detail}`);
        res.status(409).json({ message: `Release blocked for ${to}. ${reasons.join(' · ')}`, releaseChecks: r.checks });
        return;
      }
    }
  } catch {
    // Checks that cannot run never block (they show as "unknown" to approvers).
  }
  next();
};

export const withReleaseGuard =
  (handler: (req: AuthRequest, res: Response) => unknown) =>
  (req: AuthRequest, res: Response) =>
    releaseGuard(req, res, () => handler(req, res));
