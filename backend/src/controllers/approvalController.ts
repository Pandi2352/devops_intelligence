import { Response } from 'express';
import { canApprove, isManager, projectLevel } from '../services/access.js';
import { AuthRequest } from '../middleware/auth.js';
import { ApprovalRequest, ApprovalAction, ApprovalStatus } from '../models/ApprovalRequest.js';

export const listApprovals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, project } = req.query;
    const filter: any = {};
    if (status) filter.status = status;
    if (project) filter.projectName = project;

    const all = await ApprovalRequest.find(filter).sort({ createdAt: -1 });
    // Managers see everything; others see what they asked for and what they may approve.
    const mine = (a: { requestedBy: string }) => a.requestedBy === req.user?.email || a.requestedBy === req.user?.name; // older requests stored the name
    const approvals = isManager(req.user) ? all : all.filter((a) => mine(a) || canApprove(req.user, a.projectName));
    res.json({ approvals });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to fetch approval requests', error: err.message });
  }
};

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

    const request = new ApprovalRequest({
      projectName,
      action: action as ApprovalAction,
      resource,
      reason: reason || 'Operation requested via DevOps Copilot',
      details: details || '',
      // Always the signed-in user, never from the request body.
      requestedBy: req.user!.email,
      requestedByName: req.user!.name,
      requestedByRole: req.user!.role,
      status: 'PENDING',
    });

    await request.save();
    res.status(201).json({
      message: 'Approval request submitted successfully and queued for DevOps Manager review',
      request,
    });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to submit approval request', error: err.message });
  }
};

export const reviewApprovalRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, reviewComment } = req.body;

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      res.status(400).json({ message: "Status must be 'APPROVED' or 'REJECTED'" });
      return;
    }

    const request = await ApprovalRequest.findById(id);
    if (!request) {
      res.status(404).json({ message: 'Approval request not found' });
      return;
    }
    if (!canApprove(req.user, request.projectName)) {
      res.status(403).json({ message: `Only a Manager Approver or admin of ${request.projectName} can review this request` });
      return;
    }
    if (request.requestedBy === req.user?.email || request.requestedBy === req.user?.name) {
      res.status(403).json({ message: 'You cannot approve your own request' });
      return;
    }

    request.status = status as ApprovalStatus;
    request.reviewComment = reviewComment || (status === 'APPROVED' ? 'Approved by DevOps Manager' : 'Rejected');
    request.reviewedBy = req.user!.email;
    request.reviewedAt = new Date();

    await request.save();
    res.json({ message: `Request has been ${status.toLowerCase()}`, request });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to review request', error: err.message });
  }
};
