import type { ApprovalState, AuditEventItem, AuditOutcome } from '../../api/approvalApi';

export const STATUS_META: Record<ApprovalState, { label: string; chip: string }> = {
  PENDING: { label: 'Waiting for approval', chip: 'bg-amber-50 text-amber-900 border-amber-200' },
  APPROVED: { label: 'Approved', chip: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  EXECUTING: { label: 'Running', chip: 'bg-sky-50 text-sky-800 border-sky-200' },
  EXECUTED: { label: 'Done', chip: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  FAILED: { label: 'Failed', chip: 'bg-rose-50 text-rose-800 border-rose-200' },
  REJECTED: { label: 'Rejected', chip: 'bg-slate-100 text-slate-700 border-slate-200' },
  CANCELLED: { label: 'Cancelled', chip: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export const ACTION_LABEL: Record<string, string> = {
  PROMOTE: 'Promote',
  SYNC: 'Sync',
  REDEPLOY: 'Redeploy',
  ROLLBACK: 'Roll back',
  MERGE: 'Merge',
  PIPELINE: 'Run pipeline',
  PROD_DEPLOY: 'Production deploy',
  RESTART_POD: 'Restart pod',
  SCALE_DEPLOYMENT: 'Scale deployment',
  APPROVAL_REVIEW: 'Review',
  APPROVAL_CANCEL: 'Cancel request',
  SETTINGS: 'Settings',
  CONNECTOR: 'Connector',
  DNS_CHANGE: 'DNS change',
  PUBLIC_PREVIEW: 'Public preview',
};

export const OUTCOME_META: Record<AuditOutcome, { label: string; chip: string }> = {
  succeeded: { label: 'succeeded', chip: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  failed: { label: 'failed', chip: 'bg-rose-50 text-rose-800 border-rose-200' },
  denied: { label: 'denied', chip: 'bg-rose-50 text-rose-700 border-rose-200' },
  requested: { label: 'requested', chip: 'bg-amber-50 text-amber-900 border-amber-200' },
  approved: { label: 'approved', chip: 'bg-sky-50 text-sky-800 border-sky-200' },
  rejected: { label: 'rejected', chip: 'bg-slate-100 text-slate-700 border-slate-200' },
  cancelled: { label: 'cancelled', chip: 'bg-slate-100 text-slate-600 border-slate-200' },
  changed: { label: 'changed', chip: 'bg-violet-50 text-violet-800 border-violet-200' },
};

export const OUTCOMES = Object.keys(OUTCOME_META) as AuditOutcome[];

export const durationOf = (start?: string, end?: string): string => {
  if (!start || !end) return '';
  const s = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

// CSV of audit events, quoted so commas and quotes in messages are safe.
export const auditCsv = (events: AuditEventItem[]): string => {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['time', 'actor', 'role', 'action', 'project', 'environment', 'target', 'outcome', 'via approval', 'message'];
  const rows = events.map((e) => [e.at, e.actor, e.actorRole, e.action, e.project, e.environment, e.target, e.outcome, e.viaApproval ? 'yes' : '', e.message].map(q).join(','));
  return [header.map(q).join(','), ...rows].join('\n');
};

export const downloadText = (name: string, text: string, type = 'text/csv') => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};
