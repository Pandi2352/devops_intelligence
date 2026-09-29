import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { IProject, Project } from '../models/Project.js';
import { ApprovalAction, ApprovalRequest, IApprovalRequest } from '../models/ApprovalRequest.js';
import { AuditEvent, AuditOutcome } from '../models/AuditEvent.js';
import { IUser, User } from '../models/User.js';
import { argoRequest } from '../controllers/argoController.js';
import { mergeRequestInfo } from '../controllers/gitMergeController.js';
import { repoPath } from './gitAccess.js';
import { DEPLOY, envLevel, envNameOf, repoPathOf } from './access.js';

// ---------------------------------------------------------------- rules

export const defaultRequiresApproval = (env: string) => /^(prod|production)$/i.test(env);

export const requiresApproval = (project: IProject, env: string): boolean => {
  const app = (project.argoApps || []).find((a) => envNameOf(a) === env);
  if (app && typeof app.requiresApproval === 'boolean') return app.requiresApproval;
  return defaultRequiresApproval(env);
};

// ---------------------------------------------------------------- audit

export const audit = async (
  actor: IUser | undefined,
  e: { action: string; project?: string; environment?: string; target?: string; outcome: AuditOutcome; message?: string; requestId?: string; viaApproval?: boolean }
) => {
  try {
    await AuditEvent.create({
      actor: actor?.email || 'system',
      actorName: actor?.name || '',
      actorRole: actor?.role || '',
      project: e.project || '',
      environment: e.environment || '',
      target: e.target || '',
      message: (e.message || '').slice(0, 500),
      requestId: e.requestId || '',
      viaApproval: Boolean(e.viaApproval),
      action: e.action,
      outcome: e.outcome,
    });
  } catch (err) {
    console.error('[Audit] could not record event', err);
  }
};

// ---------------------------------------------------------------- what a request targets

export interface GateTarget {
  project: IProject;
  environment: string;
  target: string;
  summary: string;
  context: Record<string, unknown>;
}

type Resolver = (req: AuthRequest) => Promise<GateTarget | null>;

const envOfProject = (project: IProject, env: string) => (project.argoApps || []).find((a) => envNameOf(a) === env);

const byProjectEnv =
  (envFrom: (req: AuthRequest) => string, describe: (req: AuthRequest, env: string) => string): Resolver =>
  async (req) => {
    const project = await Project.findById(req.params.id);
    const env = envFrom(req);
    if (!project || !env || !envOfProject(project, env)) return null;
    const app = envOfProject(project, env)!;
    return { project, environment: env, target: app.appName, summary: describe(req, env), context: await appContext(app.appName) };
  };

// Current state of the ArgoCD app, so approvers see what runs now.
const appContext = async (appName: string): Promise<Record<string, unknown>> => {
  try {
    const { data } = await argoRequest('get', `/api/v1/applications/${encodeURIComponent(appName)}`);
    return {
      app: appName,
      sync: data.status?.sync?.status,
      health: data.status?.health?.status,
      runningImage: data.status?.summary?.images?.[0] || '',
      gitRevision: String(data.status?.sync?.revision || '').slice(0, 8),
    };
  } catch {
    return { app: appName };
  }
};

const byArgoApp =
  (describe: (req: AuthRequest, env: string) => string): Resolver =>
  async (req) => {
    const name = String(req.params.name);
    const project = await Project.findOne({ 'argoApps.appName': name });
    const app = project?.argoApps.find((a) => a.appName === name);
    if (!project || !app) return null;
    const env = envNameOf(app);
    return { project, environment: env, target: name, summary: describe(req, env), context: await appContext(name) };
  };

// The project environment whose branch is `branch` in the app repo `repo` (branch-per-environment).
const envOfBranch = async (connectorId: string, repoId: string, branch: string) => {
  const path = await repoPath(connectorId, repoId);
  if (!path) return null;
  for (const project of await Project.find()) {
    const isApp = (project.gitLabRepos || []).some((r) => repoPathOf(r.repoUrl) === path && r.role !== 'gitops');
    const app = isApp ? (project.argoApps || []).find((a) => (a.branch || a.environment) === branch) : undefined;
    if (app) return { project, app };
  }
  return null;
};

export const RESOLVERS: Record<string, { action: ApprovalAction; resolve: Resolver }> = {
  'env.promote': {
    action: 'PROMOTE',
    resolve: byProjectEnv((req) => String(req.body?.to || ''), (req, env) => `Promote ${req.body?.from} → ${env}`),
  },
  'env.rollback': {
    action: 'ROLLBACK',
    resolve: byProjectEnv((req) => String(req.params.env), (req, env) => `Roll back ${env} to ${String(req.body?.sha || '').slice(0, 8)}`),
  },
  'env.redeploy': {
    action: 'REDEPLOY',
    resolve: byProjectEnv((req) => String(req.params.env), (_req, env) => `Redeploy the head of ${env}`),
  },
  'dns.apply': {
    action: 'DNS_CHANGE',
    resolve: byProjectEnv((req) => String(req.params.env), (_req, env) => `Point the public hostname of ${env} at ${env} (Cloudflare DNS)`),
  },
  'dns.remove': {
    action: 'DNS_CHANGE',
    resolve: byProjectEnv((req) => String(req.params.env), (_req, env) => `Remove the public DNS record of ${env}`),
  },
  'preview.start': {
    action: 'PUBLIC_PREVIEW',
    resolve: byProjectEnv((req) => String(req.params.env), (_req, env) => `Open a temporary public preview URL for ${env}`),
  },
  'argo.sync': { action: 'SYNC', resolve: byArgoApp((_req, env) => `Sync ${env} to what is in Git`) },
  'argo.rollback': { action: 'ROLLBACK', resolve: byArgoApp((req, env) => `ArgoCD rollback of ${env} to history #${req.body?.id}`) },
  'git.pipeline': {
    action: 'PIPELINE',
    resolve: async (req) => {
      const ref = String(req.body?.ref || '');
      const hit = await envOfBranch(String(req.params.id), String(req.params.repoId), ref);
      if (!hit) return null;
      return { project: hit.project, environment: envNameOf(hit.app), target: `pipeline on ${ref}`, summary: `Run the ${ref} pipeline (builds and deploys ${envNameOf(hit.app)})`, context: await appContext(hit.app.appName) };
    },
  },
  'git.merge': {
    action: 'MERGE',
    resolve: async (req) => {
      const mr = await mergeRequestInfo(req, Number(req.params.iid));
      const hit = await envOfBranch(String(req.params.id), String(req.params.repoId), mr.target);
      if (!hit) return null;
      return {
        project: hit.project,
        environment: envNameOf(hit.app),
        target: `!${req.params.iid} ${mr.source} → ${mr.target}`,
        summary: `Merge !${req.params.iid} (${mr.source} → ${mr.target}): ${mr.title}`,
        context: { ...(await appContext(hit.app.appName)), mergeRequest: mr.webUrl, sourceCommit: mr.sha },
      };
    },
  },
};

// ---------------------------------------------------------------- gate

// Replayed approved requests carry this marker so the gate lets them through.
export interface GateRequest extends AuthRequest {
  approvalId?: string;
}

const sanitizeBody = (body: unknown) => {
  if (!body || typeof body !== 'object') return {};
  const copy = { ...(body as Record<string, unknown>) };
  delete copy.reason;
  return copy;
};

// Put after the permission guard of a deploy action. Environments that require approval get a request
// (HTTP 202) instead of the action; everything else runs and is written to the audit log.
export const approvalGate = (kind: keyof typeof RESOLVERS) => {
  const { action, resolve } = RESOLVERS[kind];
  return async (req: GateRequest, res: Response, next: NextFunction): Promise<void> => {
    if (req.approvalId) return next();
    let target: GateTarget | null = null;
    try {
      target = await resolve(req);
    } catch {
      target = null; // unknown target: permission guards already ran; the handler reports real errors
    }

    if (target && requiresApproval(target.project, target.environment)) {
      const open = await ApprovalRequest.findOne({ kind, projectName: target.project.name, environment: target.environment, status: 'PENDING', requestedBy: req.user!.email, resource: target.target });
      if (open) {
        res.status(202).json({ approvalRequired: true, message: `Already waiting for approval (request ${String(open._id).slice(-6)})`, request: open });
        return;
      }
      const request = await ApprovalRequest.create({
        projectName: target.project.name,
        projectId: String(target.project._id),
        environment: target.environment,
        action,
        resource: target.target,
        summary: target.summary,
        context: target.context,
        reason: String(req.body?.reason || '').slice(0, 1000),
        requestedBy: req.user!.email,
        requestedByName: req.user!.name,
        requestedByRole: req.user!.role,
        kind,
        call: { params: { ...req.params }, body: sanitizeBody(req.body), query: { ...req.query } },
        status: 'PENDING',
      });
      await audit(req.user, { action, project: target.project.name, environment: target.environment, target: target.target, outcome: 'requested', message: target.summary, requestId: String(request._id) });
      res.status(202).json({
        approvalRequired: true,
        message: `${target.environment} needs an approval: request sent to the approvers of ${target.project.name}.`,
        request,
      });
      return;
    }

    // Not gated: run it and record how it ended.
    res.on('finish', () => {
      audit(req.user, {
        action,
        project: target?.project.name,
        environment: target?.environment,
        target: target?.target || req.originalUrl,
        outcome: res.statusCode < 400 ? 'succeeded' : res.statusCode === 403 ? 'denied' : 'failed',
        message: target?.summary || `${req.method} ${req.originalUrl} → ${res.statusCode}`,
      });
    });
    next();
  };
};

// ---------------------------------------------------------------- executor

type Handler = (req: GateRequest, res: Response) => unknown;
const HANDLERS: Partial<Record<string, Handler>> = {};

// Controllers register themselves (avoids import cycles between controllers and this service).
export const registerApprovalHandler = (kind: string, handler: Handler) => {
  HANDLERS[kind] = handler;
};

// Calls a route handler with a stored request and captures its JSON answer.
const invoke = (handler: Handler, req: Partial<GateRequest>): Promise<{ status: number; body: any }> =>
  new Promise((resolve) => {
    let status = 200;
    const res: any = {
      statusCode: 200,
      status(code: number) {
        status = code;
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        resolve({ status, body });
        return this;
      },
      send(body: unknown) {
        resolve({ status, body });
        return this;
      },
      setHeader() {},
      on() {},
    };
    Promise.resolve(handler(req as GateRequest, res)).catch((err) => resolve({ status: 500, body: { message: err?.message || 'Failed' } }));
  });

// Runs an approved request as the requester, after re-checking that they may still do it.
export const executeApproval = async (request: IApprovalRequest, approver: IUser) => {
  const finish = async (ok: boolean, httpStatus: number, message: string) => {
    request.status = ok ? 'EXECUTED' : 'FAILED';
    request.execution = { ...(request.execution || {}), finishedAt: new Date(), httpStatus, message: message.slice(0, 1000) };
    await request.save();
    await audit(approver, {
      action: request.action,
      project: request.projectName,
      environment: request.environment,
      target: request.resource,
      outcome: ok ? 'succeeded' : 'failed',
      message: `${request.summary}: ${message}`,
      requestId: String(request._id),
      viaApproval: true,
    });
  };

  const handler = request.kind ? HANDLERS[request.kind] : undefined;
  if (!handler || !request.call) return finish(false, 0, 'This request has no action to run');
  const requester = await User.findOne({ email: request.requestedBy });
  if (!requester || !requester.isActive) return finish(false, 0, 'The requester no longer has an active account');
  if (envLevel(requester, request.projectName, request.environment || '') < DEPLOY) {
    return finish(false, 403, 'The requester no longer has build-and-deploy access to this environment');
  }

  request.status = 'EXECUTING';
  request.execution = { startedAt: new Date() };
  await request.save();
  const { status, body } = await invoke(handler, {
    params: request.call.params,
    body: request.call.body,
    query: request.call.query || {},
    headers: {},
    user: requester,
    approvalId: String(request._id),
    method: 'POST',
    originalUrl: `approval:${request.kind}`,
  } as Partial<GateRequest>);
  const message = String(body?.message || (status < 400 ? 'Done' : `Failed with HTTP ${status}`));
  // 202 from a replay would mean the gate held it again: treat as failure so it is visible.
  await finish(status < 400 && !body?.approvalRequired, status, message);
};
