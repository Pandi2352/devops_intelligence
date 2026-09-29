import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { ApprovalAction, ApprovalRequest, IApprovalRequest } from '../models/ApprovalRequest.js';
import { AuditEvent } from '../models/AuditEvent.js';
import { Project } from '../models/Project.js';
import { ADMIN, canApprove, envLevel, envNameOf, isManager, isSuperAdmin, projectLevel } from '../services/access.js';
import { audit, defaultRequiresApproval, executeApproval, requiresApproval } from '../services/approvals.js';
import { cleanString, isValidId } from '../utils/validation.js';

const mine = (a: IApprovalRequest, req: AuthRequest) => a.requestedBy === req.user?.email || a.requestedBy === req.user?.name; // older requests stored the name

// Requests the user may see: managers all; others their own and those they may approve.
const visible = (a: IApprovalRequest, req: AuthRequest) =>
  isManager(req.user) || mine(a, req) || canApprove(req.user, a.projectName, a.environment || undefined) || envLevel(req.user, a.projectName, a.environment || '') >= 1;

const view = (a: IApprovalRequest, req: AuthRequest) => ({
  ...a.toObject(),
  call: undefined, // internal: the replayed API call
  mine: mine(a, req),
  canReview: a.status === 'PENDING' && canApprove(req.user, a.projectName, a.environment || undefined) && (!mine(a, req) || isSuperAdmin(req.user)),
  canCancel: a.status === 'PENDING' && (mine(a, req) || isManager(req.user)),
});

export const listApprovals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.status && req.query.status !== 'all') filter.status = String(req.query.status);
    if (req.query.project) filter.projectName = String(req.query.project);
    if (req.query.environment) filter.environment = String(req.query.environment);
    const all = await ApprovalRequest.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json({ approvals: all.filter((a) => visible(a, req)).map((a) => view(a, req)) });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to fetch approval requests', error: err.message });
  }
};

// Badge counts for the sidebar and the Environments page.
export const approvalSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  const pending = await ApprovalRequest.find({ status: 'PENDING' });
  res.json({
    waitingForMe: pending.filter((a) => view(a, req).canReview).length,
    myPending: pending.filter((a) => mine(a, req)).length,
  });
};

// Free-form requests (DevOps Copilot). Deploy actions create theirs through the approval gate.
export const createApprovalRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectName, action, resource, reason, details } = req.body;
    if (!projectName || !action || !resource) {
      res.status(400).json({ message: 'Project name, action, and resource are required' });
      return;
    }
    if (projectLevel(req.user, String(projectName)) < 1) {
      res.status(403).json({ message: `You have no access to project ${projectName}` });
      return;
    }
    const request = await ApprovalRequest.create({
      projectName,
      action: action as ApprovalAction,
      resource,
      summary: cleanString(details || `${action} ${resource}`, 300),
      reason: cleanString(reason, 1000) || 'Requested via DevOps Copilot',
      details: cleanString(details, 2000),
      requestedBy: req.user!.email,
      requestedByName: req.user!.name,
      requestedByRole: req.user!.role,
    });
    await audit(req.user, { action, project: projectName, target: resource, outcome: 'requested', message: request.summary, requestId: String(request._id) });
    res.status(201).json({ message: 'Approval request submitted', request });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to submit approval request', error: err.message });
  }
};

export const reviewApprovalRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const status = String(req.body?.status);
    const comment = cleanString(req.body?.reviewComment, 1000);
    if (!['APPROVED', 'REJECTED'].includes(status)) {
      res.status(400).json({ message: "Status must be 'APPROVED' or 'REJECTED'" });
      return;
    }
    const request = isValidId(req.params.id) ? await ApprovalRequest.findById(req.params.id) : null;
    if (!request) {
      res.status(404).json({ message: 'Approval request not found' });
      return;
    }
    if (request.status !== 'PENDING') {
      res.status(409).json({ message: `This request is already ${request.status.toLowerCase()}` });
      return;
    }
    if (!canApprove(req.user, request.projectName, request.environment || undefined)) {
      res.status(403).json({ message: `Only a Manager Approver or admin of ${request.projectName} can review this request` });
      return;
    }
    // Four-eyes rule. A Super Admin may approve their own request as a documented break-glass.
    const self = mine(request, req);
    if (self && !isSuperAdmin(req.user)) {
      res.status(403).json({ message: 'You cannot approve your own request' });
      return;
    }
    if (self && status === 'APPROVED' && comment.length < 10) {
      res.status(400).json({ message: 'Approving your own request needs a comment (at least 10 characters) explaining why' });
      return;
    }

    request.status = status as IApprovalRequest['status'];
    request.reviewedBy = req.user!.email;
    request.reviewComment = comment;
    request.reviewedAt = new Date();
    request.selfApproved = self;
    await request.save();
    await audit(req.user, {
      action: 'APPROVAL_REVIEW',
      project: request.projectName,
      environment: request.environment,
      target: request.resource,
      outcome: status === 'APPROVED' ? 'approved' : 'rejected',
      message: `${request.summary}${comment ? `: ${comment}` : ''}${self ? ' (self-approved by a Super Admin)' : ''}`,
      requestId: String(request._id),
    });

    if (status === 'APPROVED' && request.kind) {
      // Run it in the background; the page follows EXECUTING → EXECUTED / FAILED.
      executeApproval(request, req.user!).catch((err) => console.error('[Approvals] execution failed', err));
      res.json({ message: 'Approved. Running it now…', request: view(request, req) });
      return;
    }
    res.json({ message: status === 'APPROVED' ? 'Approved' : 'Rejected', request: view(request, req) });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to review approval request', error: err.message });
  }
};

export const cancelApprovalRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  const request = isValidId(req.params.id) ? await ApprovalRequest.findById(req.params.id) : null;
  if (!request) {
    res.status(404).json({ message: 'Approval request not found' });
    return;
  }
  if (request.status !== 'PENDING' || (!mine(request, req) && !isManager(req.user))) {
    res.status(403).json({ message: 'Only a pending request can be cancelled, by its requester or an admin' });
    return;
  }
  request.status = 'CANCELLED';
  request.reviewedBy = req.user!.email;
  request.reviewedAt = new Date();
  await request.save();
  await audit(req.user, { action: 'APPROVAL_CANCEL', project: request.projectName, environment: request.environment, target: request.resource, outcome: 'cancelled', message: request.summary, requestId: String(request._id) });
  res.json({ message: 'Request cancelled', request: view(request, req) });
};

// Audit log, scoped like everything else.
export const listAuditEvents = async (req: AuthRequest, res: Response): Promise<void> => {
  const filter: Record<string, unknown> = {};
  if (req.query.project) filter.project = String(req.query.project);
  if (req.query.environment) filter.environment = String(req.query.environment);
  if (req.query.actor) filter.actor = String(req.query.actor);
  const limit = Math.min(Number(req.query.limit) || 300, 1000);
  const events = await AuditEvent.find(filter).sort({ at: -1 }).limit(limit);
  const allowed = isManager(req.user)
    ? events
    : events.filter((e) => e.actor === req.user?.email || (e.project && (e.environment ? envLevel(req.user, e.project, e.environment) : projectLevel(req.user, e.project)) >= 1));
  res.json({ events: allowed });
};

// Per-environment "deploys need approval" switch (project admins).
export const setEnvironmentApproval = async (req: AuthRequest, res: Response): Promise<void> => {
  const project = isValidId(req.params.id) ? await Project.findById(req.params.id) : null;
  if (!project) {
    res.status(404).json({ message: 'Project not found' });
    return;
  }
  if (projectLevel(req.user, project.name) < ADMIN) {
    res.status(403).json({ message: `You need admin access to project ${project.name}` });
    return;
  }
  const env = String(req.params.env);
  const app = project.argoApps.find((a) => envNameOf(a) === env);
  if (!app) {
    res.status(404).json({ message: `Environment ${env} is not part of ${project.name}` });
    return;
  }
  const value = req.body?.requiresApproval;
  app.requiresApproval = value === null || value === undefined ? null : Boolean(value);
  await project.save();
  const effective = requiresApproval(project, env);
  await audit(req.user, {
    action: 'SETTINGS',
    project: project.name,
    environment: env,
    target: 'requiresApproval',
    outcome: 'changed',
    message: `Deploys to ${env} ${effective ? 'now need' : 'no longer need'} approval${app.requiresApproval === null ? ' (default)' : ''}`,
  });
  res.json({ message: `Deploys to ${env} ${effective ? 'need an approval' : 'run without approval'}`, requiresApproval: effective, isDefault: app.requiresApproval === null, defaultValue: defaultRequiresApproval(env) });
};
