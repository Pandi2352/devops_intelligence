import api from './client';
import { ApprovalRequest, ApprovalAction } from '../types';

export type ApprovalState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTING' | 'EXECUTED' | 'FAILED' | 'CANCELLED';

// A request as the approvals API returns it (the replayed API call is never sent to the browser).
export interface ApprovalItem {
  _id: string;
  projectName: string;
  projectId?: string;
  environment?: string;
  action: string;
  resource: string;
  summary?: string;
  details?: string;
  context?: {
    app?: string;
    sync?: string;
    health?: string;
    runningImage?: string;
    gitRevision?: string;
    mergeRequest?: string;
    sourceCommit?: string;
    [key: string]: unknown;
  };
  reason?: string;
  requestedBy: string;
  requestedByName?: string;
  requestedByRole?: string;
  kind?: string;
  status: ApprovalState;
  reviewedBy?: string;
  reviewComment?: string;
  reviewedAt?: string;
  selfApproved?: boolean;
  execution?: { startedAt?: string; finishedAt?: string; httpStatus?: number; message?: string };
  createdAt: string;
  updatedAt?: string;
  mine: boolean;
  canReview: boolean;
  canCancel: boolean;
}

export type AuditOutcome = 'succeeded' | 'failed' | 'denied' | 'requested' | 'approved' | 'rejected' | 'cancelled' | 'changed';

export interface AuditEventItem {
  _id: string;
  at: string;
  actor: string;
  actorName: string;
  actorRole: string;
  action: string;
  project: string;
  environment: string;
  target: string;
  outcome: AuditOutcome;
  message: string;
  requestId?: string;
  viaApproval?: boolean;
}

export const approvalApi = {
  // Legacy helpers (DevOps Copilot, Getting Started).
  getAll: async (params?: { status?: string; project?: string }): Promise<ApprovalRequest[]> => {
    const res = await api.get('/approvals', { params });
    return res.data.approvals;
  },
  create: async (data: { projectName: string; action: ApprovalAction; resource: string; reason?: string; details?: string }): Promise<ApprovalRequest> => {
    const res = await api.post('/approvals', data);
    return res.data.request;
  },
  review: async (id: string, status: 'APPROVED' | 'REJECTED', reviewComment?: string): Promise<ApprovalRequest> => {
    const res = await api.put(`/approvals/${id}/review`, { status, reviewComment });
    return res.data.request;
  },

  list: async (params: { status?: ApprovalState | 'all'; project?: string; environment?: string } = {}): Promise<ApprovalItem[]> =>
    (await api.get('/approvals', { params: { status: 'all', ...params } })).data.approvals,
  summary: async (): Promise<{ waitingForMe: number; myPending: number }> => (await api.get('/approvals/summary')).data,
  decide: async (id: string, status: 'APPROVED' | 'REJECTED', reviewComment: string): Promise<{ message: string; request: ApprovalItem }> =>
    (await api.put(`/approvals/${id}/review`, { status, reviewComment })).data,
  cancel: async (id: string): Promise<{ message: string; request: ApprovalItem }> => (await api.post(`/approvals/${id}/cancel`)).data,
  audit: async (params: { project?: string; environment?: string; actor?: string; limit?: number } = {}): Promise<AuditEventItem[]> =>
    (await api.get('/approvals/audit', { params })).data.events,
};
