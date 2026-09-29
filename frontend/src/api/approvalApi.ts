import api from './client';
import { ApprovalRequest, ApprovalAction, ApprovalStatus } from '../types';

export const approvalApi = {
  getAll: async (params?: { status?: string; project?: string }): Promise<ApprovalRequest[]> => {
    const res = await api.get('/approvals', { params });
    return res.data.approvals;
  },
  create: async (data: {
    projectName: string;
    action: ApprovalAction;
    resource: string;
    reason?: string;
    details?: string;
    requestedBy?: string;
    requestedByRole?: string;
  }): Promise<ApprovalRequest> => {
    const res = await api.post('/approvals', data);
    return res.data.request;
  },
  review: async (
    id: string,
    status: 'APPROVED' | 'REJECTED',
    reviewComment?: string
  ): Promise<ApprovalRequest> => {
    const res = await api.put(`/approvals/${id}/review`, { status, reviewComment });
    return res.data.request;
  },
};
