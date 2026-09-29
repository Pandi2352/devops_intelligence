import { Response } from 'express';
import { dumpYaml } from '@kubernetes/client-node';
import { AuthRequest } from '../middleware/auth.js';
import { Project } from '../models/Project.js';
import { argoRequest, syncArgoApp } from './argoController.js';
import { describeRequestError } from '../utils/httpError.js';

// Everything ArgoCD knows about its applications, shaped for the DevOps Intelligence ArgoCD page.

const appPath = (name: string) => `/api/v1/applications/${encodeURIComponent(name)}`;
const NAME_PATTERN = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;

const initiatedBy = (i: any) => i?.username || (i?.automated ? 'auto-sync' : '');

// Which DevOps Intelligence project / environment maps each ArgoCD app.
const projectIndex = async () => {
  const index = new Map<string, { project: string; projectId: string; environment: string }>();
  const projects = await Project.find({}, { name: 1, argoApps: 1 });
  for (const p of projects) {
    for (const a of p.argoApps || []) {
      index.set(a.appName, { project: p.name, projectId: String(p._id), environment: a.environment || '' });
    }
  }
  return index;
};

const summarize = (app: any, index: Map<string, { project: string; projectId: string; environment: string }>) => {
  const spec = app.spec || {};
  const status = app.status || {};
  const source = spec.source || spec.sources?.[0] || {};
  const op = status.operationState;
  const lastHistory = status.history?.[status.history.length - 1];
  const resources: any[] = status.resources || [];
  return {
    name: app.metadata.name,
    namespace: app.metadata.namespace,
    project: spec.project || 'default',
    createdAt: app.metadata.creationTimestamp,
    source: { repoURL: source.repoURL || '', path: source.path || '', targetRevision: source.targetRevision || 'HEAD', chart: source.chart || '' },
    sourceType: status.sourceType || '',
    destination: { server: spec.destination?.server || '', name: spec.destination?.name || '', namespace: spec.destination?.namespace || '' },
    sync: { status: status.sync?.status || 'Unknown', revision: String(status.sync?.revision || '').slice(0, 8) },
    health: { status: status.health?.status || 'Unknown', message: status.health?.message || '' },
    autoSync: spec.syncPolicy?.automated
      ? { enabled: true, prune: Boolean(spec.syncPolicy.automated.prune), selfHeal: Boolean(spec.syncPolicy.automated.selfHeal) }
      : { enabled: false, prune: false, selfHeal: false },
    syncOptions: spec.syncPolicy?.syncOptions || [],
    images: status.summary?.images || [],
    reconciledAt: status.reconciledAt || null,
    lastSync: lastHistory ? { at: lastHistory.deployedAt, by: initiatedBy(lastHistory.initiatedBy), revision: String(lastHistory.revision || '').slice(0, 8) } : null,
    operation: op
      ? { phase: op.phase, message: op.message || '', startedAt: op.startedAt, finishedAt: op.finishedAt || null, by: initiatedBy(op.operation?.initiatedBy) }
      : null,
    conditions: (status.conditions || []).map((c: any) => ({ type: c.type, message: c.message, time: c.lastTransitionTime })),
    resourceCounts: {
      total: resources.length,
      outOfSync: resources.filter((r) => r.status === 'OutOfSync').length,
      unhealthy: resources.filter((r) => r.health && !['Healthy', ''].includes(r.health.status)).length,
    },
    kubeorbit: index.get(app.metadata.name) || null,
  };
};

const handle = (res: Response, err: any, fallback = 'ArgoCD request failed') => {
  const status = err.response?.status === 404 ? 404 : err.response?.status === 403 ? 403 : 500;
  res.status(status).json({ message: status === 404 ? 'Application not found in ArgoCD' : describeRequestError(err, 'ArgoCD') || fallback });
};

const validName = (req: AuthRequest, res: Response) => {
  const name = String(req.params.name);
  if (!NAME_PATTERN.test(name)) {
    res.status(400).json({ message: 'Invalid application name' });
    return null;
  }
  return name;
};

export const listApps = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [{ data, serverUrl }, index] = await Promise.all([argoRequest('get', '/api/v1/applications'), projectIndex()]);
    const apps = (data.items || []).map((a: any) => summarize(a, index));
    res.json({ serverUrl, apps });
  } catch (err: any) {
    handle(res, err);
  }
};

export const getApp = async (req: AuthRequest, res: Response): Promise<void> => {
  const name = validName(req, res);
  if (!name) return;
  try {
    const [{ data: app, serverUrl }, index] = await Promise.all([argoRequest('get', appPath(name)), projectIndex()]);
    const status = app.status || {};
    const op = status.operationState;
    res.json({
      ...summarize(app, index),
      argoUrl: `${serverUrl}/applications/argocd/${name}`,
      resources: (status.resources || []).map((r: any) => ({
        group: r.group || '',
        version: r.version || '',
        kind: r.kind,
        namespace: r.namespace || '',
        name: r.name,
        status: r.status || '',
        health: r.health?.status || '',
        healthMessage: r.health?.message || '',
        hook: Boolean(r.hook),
        requiresPruning: Boolean(r.requiresPruning),
      })),
      history: [...(status.history || [])].reverse().map((h: any) => ({
        id: h.id,
        revision: String(h.revision || '').slice(0, 8),
        fullRevision: h.revision || '',
        deployedAt: h.deployedAt,
        startedAt: h.deployStartedAt,
        by: initiatedBy(h.initiatedBy),
        source: { path: h.source?.path || '', targetRevision: h.source?.targetRevision || '' },
      })),
      operationDetail: op
        ? {
            phase: op.phase,
            message: op.message || '',
            startedAt: op.startedAt,
            finishedAt: op.finishedAt || null,
            by: initiatedBy(op.operation?.initiatedBy),
            revision: String(op.syncResult?.revision || op.operation?.sync?.revision || '').slice(0, 8),
            prune: Boolean(op.operation?.sync?.prune),
            results: (op.syncResult?.resources || []).map((r: any) => ({
              kind: r.kind,
              name: r.name,
              namespace: r.namespace || '',
              status: r.status,
              message: r.message || '',
              syncPhase: r.syncPhase || '',
            })),
          }
        : null,
    });
  } catch (err: any) {
    handle(res, err);
  }
};

// Resource tree: Deployment → ReplicaSet → Pod, Service → Endpoints…, with health and pod info.
export const getAppTree = async (req: AuthRequest, res: Response): Promise<void> => {
  const name = validName(req, res);
  if (!name) return;
  try {
    const { data } = await argoRequest('get', `${appPath(name)}/resource-tree`);
    const nodes = (data.nodes || []).map((n: any) => ({
      uid: n.uid,
      kind: n.kind,
      name: n.name,
      namespace: n.namespace || '',
      group: n.group || '',
      parents: (n.parentRefs || []).map((p: any) => p.uid).filter(Boolean),
      health: n.health?.status || '',
      healthMessage: n.health?.message || '',
      info: (n.info || []).map((i: any) => ({ name: i.name, value: i.value })),
      images: n.images || [],
      createdAt: n.createdAt || null,
    }));
    res.json({ nodes });
  } catch (err: any) {
    handle(res, err);
  }
};

// ---------------------------------------------------------------- diff (Git vs cluster)

const NOISY_ANNOTATIONS = ['kubectl.kubernetes.io/last-applied-configuration', 'deployment.kubernetes.io/revision'];

const clean = (json?: string) => {
  if (!json || json === 'null') return null;
  const obj = JSON.parse(json);
  delete obj.status;
  if (obj.metadata) {
    for (const key of ['managedFields', 'resourceVersion', 'uid', 'creationTimestamp', 'generation', 'selfLink']) delete obj.metadata[key];
    if (obj.metadata.annotations) {
      for (const a of NOISY_ANNOTATIONS) delete obj.metadata.annotations[a];
      if (Object.keys(obj.metadata.annotations).length === 0) delete obj.metadata.annotations;
    }
  }
  return obj;
};

type DiffLine = { type: ' ' | '+' | '-' | '…'; text: string };

// Line diff (LCS) with 3 lines of context; unchanged runs collapse to a '…' marker.
const lineDiff = (before: string[], after: string[]): DiffLine[] => {
  const n = before.length;
  const m = after.length;
  if (n * m > 4_000_000) return [{ type: '…', text: 'Resource too large to diff here; open it in ArgoCD.' }];
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const full: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      full.push({ type: ' ', text: before[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      full.push({ type: '-', text: before[i++] });
    } else {
      full.push({ type: '+', text: after[j++] });
    }
  }
  while (i < n) full.push({ type: '-', text: before[i++] });
  while (j < m) full.push({ type: '+', text: after[j++] });

  const keep = full.map((l, idx) => l.type !== ' ' || full.slice(Math.max(0, idx - 3), idx + 4).some((x) => x.type !== ' '));
  const out: DiffLine[] = [];
  full.forEach((line, idx) => {
    if (keep[idx]) out.push(line);
    else if (out.length === 0 || out[out.length - 1].type !== '…') out.push({ type: '…', text: '' });
  });
  return out;
};

export const getAppDiff = async (req: AuthRequest, res: Response): Promise<void> => {
  const name = validName(req, res);
  if (!name) return;
  try {
    const { data } = await argoRequest('get', `${appPath(name)}/managed-resources`);
    const items = (data.items || []).map((item: any) => {
      const live = clean(item.normalizedLiveState || item.liveState);
      const target = clean(item.predictedLiveState || item.targetState);
      const state = !live && target ? 'missing' : live && !target ? 'extra' : item.modified ? 'modified' : 'in-sync';
      const liveYaml = live ? dumpYaml(live) : '';
      const targetYaml = target ? dumpYaml(target) : '';
      return {
        group: item.group || '',
        kind: item.kind,
        namespace: item.namespace || '',
        name: item.name,
        state,
        diff: state === 'in-sync' ? [] : lineDiff(liveYaml ? liveYaml.trimEnd().split('\n') : [], targetYaml ? targetYaml.trimEnd().split('\n') : []),
      };
    });
    res.json({ items });
  } catch (err: any) {
    handle(res, err);
  }
};

export const getAppEvents = async (req: AuthRequest, res: Response): Promise<void> => {
  const name = validName(req, res);
  if (!name) return;
  try {
    const { data } = await argoRequest('get', `${appPath(name)}/events`);
    const events = (data.items || [])
      .map((e: any) => ({
        type: e.type,
        reason: e.reason,
        message: e.message,
        object: e.involvedObject ? `${e.involvedObject.kind}/${e.involvedObject.name}` : '',
        count: e.count || 1,
        time: e.lastTimestamp || e.eventTime || e.firstTimestamp || e.metadata?.creationTimestamp,
        source: e.source?.component || e.reportingComponent || '',
      }))
      .sort((a: any, b: any) => String(b.time).localeCompare(String(a.time)))
      .slice(0, 100);
    res.json({ events });
  } catch (err: any) {
    handle(res, err);
  }
};

// ---------------------------------------------------------------- actions

export const refreshApp = async (req: AuthRequest, res: Response): Promise<void> => {
  const name = validName(req, res);
  if (!name) return;
  try {
    const hard = req.body?.hard === true;
    await argoRequest('get', `${appPath(name)}?refresh=${hard ? 'hard' : 'normal'}`);
    res.json({ message: `${hard ? 'Hard refresh' : 'Refresh'} requested for ${name}` });
  } catch (err: any) {
    handle(res, err);
  }
};

export const syncApp = async (req: AuthRequest, res: Response): Promise<void> => {
  const name = validName(req, res);
  if (!name) return;
  try {
    const { prune, force, applyOutOfSyncOnly } = req.body || {};
    res.json(
      await syncArgoApp(name, {
        prune: typeof prune === 'boolean' ? prune : true,
        force: force === true,
        applyOutOfSyncOnly: applyOutOfSyncOnly === true,
      })
    );
  } catch (err: any) {
    handle(res, err);
  }
};

// ArgoCD's own rollback redeploys an earlier history entry. ArgoCD refuses it while auto-sync is on,
// because auto-sync would immediately re-apply Git.
export const rollbackApp = async (req: AuthRequest, res: Response): Promise<void> => {
  const name = validName(req, res);
  if (!name) return;
  try {
    const id = Number(req.body?.id);
    if (!Number.isInteger(id) || id < 0) {
      res.status(400).json({ message: 'Choose a history entry to roll back to' });
      return;
    }
    const { data: app } = await argoRequest('get', appPath(name));
    if (app.spec?.syncPolicy?.automated) {
      res.status(409).json({
        message: `${name} has auto-sync enabled, so ArgoCD would immediately re-apply Git. Roll back through Git instead (Environments → History), or disable auto-sync first.`,
      });
      return;
    }
    await argoRequest('put', `${appPath(name)}/rollback`, { id, prune: req.body?.prune === true });
    res.json({ message: `Rolling ${name} back to history #${id}. The app stays OutOfSync with Git until the next sync.` });
  } catch (err: any) {
    handle(res, err);
  }
};

export const terminateOperation = async (req: AuthRequest, res: Response): Promise<void> => {
  const name = validName(req, res);
  if (!name) return;
  try {
    await argoRequest('delete', `${appPath(name)}/operation`);
    res.json({ message: `Terminating the running operation on ${name}` });
  } catch (err: any) {
    handle(res, err);
  }
};
