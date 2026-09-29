import mongoose, { Document, Schema } from 'mongoose';

// Legacy actions (DevOps Copilot) plus the deploy actions the approval gate holds back.
export type ApprovalAction =
  | 'RESTART_POD'
  | 'SCALE_DEPLOYMENT'
  | 'PROD_DEPLOY'
  | 'ROLLBACK'
  | 'PROMOTE'
  | 'SYNC'
  | 'REDEPLOY'
  | 'MERGE'
  | 'PIPELINE'
  | 'DNS_CHANGE'
  | 'PUBLIC_PREVIEW';

// PENDING → APPROVED → EXECUTING → EXECUTED | FAILED, or PENDING → REJECTED | CANCELLED.
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTING' | 'EXECUTED' | 'FAILED' | 'CANCELLED';

export interface IApprovalRequest extends Document {
  projectName: string;
  projectId?: string;
  environment?: string;
  action: ApprovalAction;
  resource: string;
  summary?: string; // one line shown to approvers
  details?: string;
  context?: Record<string, unknown>; // what the approver sees: commit, image, commits, …
  reason: string;
  requestedBy: string; // email of the signed-in requester
  requestedByName?: string;
  requestedByRole: string;
  // The exact API call to replay once approved (gate requests only).
  kind?: string;
  call?: { params: Record<string, string>; body: unknown; query: Record<string, unknown> };
  status: ApprovalStatus;
  reviewedBy?: string;
  reviewComment?: string;
  reviewedAt?: Date;
  selfApproved?: boolean;
  execution?: { startedAt?: Date; finishedAt?: Date; httpStatus?: number; message?: string };
  createdAt: Date;
  updatedAt: Date;
}

const ApprovalRequestSchema = new Schema<IApprovalRequest>(
  {
    projectName: { type: String, required: true },
    projectId: { type: String, default: '' },
    environment: { type: String, default: '' },
    action: {
      type: String,
      enum: ['RESTART_POD', 'SCALE_DEPLOYMENT', 'PROD_DEPLOY', 'ROLLBACK', 'PROMOTE', 'SYNC', 'REDEPLOY', 'MERGE', 'PIPELINE', 'DNS_CHANGE', 'PUBLIC_PREVIEW'],
      required: true,
    },
    resource: { type: String, required: true },
    summary: { type: String, default: '' },
    details: { type: String, default: '' },
    context: { type: Schema.Types.Mixed, default: {} },
    reason: { type: String, default: '' },
    requestedBy: { type: String, required: true },
    requestedByName: { type: String, default: '' },
    requestedByRole: { type: String, default: 'developer' },
    kind: { type: String, default: '' },
    call: { type: Schema.Types.Mixed },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'EXECUTING', 'EXECUTED', 'FAILED', 'CANCELLED'],
      default: 'PENDING',
    },
    reviewedBy: { type: String },
    reviewComment: { type: String },
    reviewedAt: { type: Date },
    selfApproved: { type: Boolean, default: false },
    execution: {
      startedAt: { type: Date },
      finishedAt: { type: Date },
      httpStatus: { type: Number },
      message: { type: String },
    },
  },
  { timestamps: true }
);

ApprovalRequestSchema.index({ status: 1, projectName: 1, environment: 1 });

export const ApprovalRequest = mongoose.model<IApprovalRequest>('ApprovalRequest', ApprovalRequestSchema);
