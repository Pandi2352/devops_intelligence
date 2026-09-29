import mongoose, { Document, Schema } from 'mongoose';

// Who did what, where, and how it ended. Written for every deploy action and every approval step.
export type AuditOutcome = 'succeeded' | 'failed' | 'denied' | 'requested' | 'approved' | 'rejected' | 'cancelled' | 'changed';

export interface IAuditEvent extends Document {
  at: Date;
  actor: string; // email
  actorName: string;
  actorRole: string;
  action: string; // e.g. PROMOTE, SYNC, APPROVAL_REVIEW, SETTINGS
  project: string;
  environment: string;
  target: string; // app, branch, merge request, …
  outcome: AuditOutcome;
  message: string;
  requestId?: string; // approval request
  viaApproval?: boolean;
}

const AuditEventSchema = new Schema<IAuditEvent>({
  at: { type: Date, default: () => new Date(), index: true },
  actor: { type: String, required: true },
  actorName: { type: String, default: '' },
  actorRole: { type: String, default: '' },
  action: { type: String, required: true },
  project: { type: String, default: '', index: true },
  environment: { type: String, default: '' },
  target: { type: String, default: '' },
  outcome: { type: String, required: true },
  message: { type: String, default: '' },
  requestId: { type: String, default: '' },
  viaApproval: { type: Boolean, default: false },
});

export const AuditEvent = mongoose.model<IAuditEvent>('AuditEvent', AuditEventSchema);
