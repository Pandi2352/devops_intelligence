import mongoose, { Document, Schema } from 'mongoose';

export type ApprovalAction = 'RESTART_POD' | 'SCALE_DEPLOYMENT' | 'PROD_DEPLOY' | 'ROLLBACK';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface IApprovalRequest extends Document {
  projectName: string;
  action: ApprovalAction;
  resource: string;
  details?: string;
  reason: string;
  requestedBy: string; // email of the signed-in requester
  requestedByName?: string;
  requestedByRole: string;
  status: ApprovalStatus;
  reviewedBy?: string;
  reviewComment?: string;
  reviewedAt?: Date;
}

const ApprovalRequestSchema = new Schema<IApprovalRequest>(
  {
    projectName: { type: String, required: true, default: 'ecommerce' },
    action: {
      type: String,
      enum: ['RESTART_POD', 'SCALE_DEPLOYMENT', 'PROD_DEPLOY', 'ROLLBACK'],
      required: true,
    },
    resource: { type: String, required: true },
    details: { type: String, default: '' },
    reason: { type: String, default: 'Manual request via DevOps Copilot' },
    requestedBy: { type: String, required: true },
    requestedByName: { type: String, default: '' },
    requestedByRole: { type: String, default: 'developer' },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
    },
    reviewedBy: { type: String },
    reviewComment: { type: String },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

export const ApprovalRequest = mongoose.model<IApprovalRequest>('ApprovalRequest', ApprovalRequestSchema);
