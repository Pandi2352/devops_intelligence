import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { ApprovalRequest, ApprovalAction, ApprovalStatus } from '../models/ApprovalRequest.js';

export const listApprovals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, project } = req.query;
    const filter: any = {};
    if (status) filter.status = status;
    if (project) filter.projectName = project;

    const approvals = await ApprovalRequest.find(filter).sort({ createdAt: -1 });
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

    const request = new ApprovalRequest({
      projectName,
      action: action as ApprovalAction,
      resource,
      reason: reason || 'Operation requested via DevOps Copilot',
      details: details || '',
      requestedBy: req.user?.name || req.body.requestedBy || 'Developer User',
      requestedByRole: req.user?.role || req.body.requestedByRole || 'developer',
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

    request.status = status as ApprovalStatus;
    request.reviewComment = reviewComment || (status === 'APPROVED' ? 'Approved by DevOps Manager' : 'Rejected');
    request.reviewedBy = req.user?.name || 'DevOps Manager';
    request.reviewedAt = new Date();

    await request.save();
    res.json({ message: `Request has been ${status.toLowerCase()}`, request });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to review request', error: err.message });
  }
};
