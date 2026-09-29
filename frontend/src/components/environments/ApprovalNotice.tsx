import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Clock, Loader2, Lock, X } from 'lucide-react';
import { PendingApproval } from '../../api/environmentApi';
import { formatRelativeTime } from '../../utils/format';
import { TextArea } from '../common/Form';

// Optional note sent with a deploy that may need an approval; the approvers read it with the request.
export const ReasonField: React.FC<{ id: string; value: string; onChange: (value: string) => void; hint?: string }> = ({ id, value, onChange, hint }) => (
  <div className="text-left">
    <label htmlFor={id} className="block text-[11px] font-semibold text-slate-700 mb-1">
      Reason for approvers (optional)
    </label>
    <TextArea id={id} rows={2} maxLength={1000} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Release 1.4: fixes the checkout timeout" />
    {hint && <p className="mt-0.5 text-[10px] text-slate-500">{hint}</p>}
  </div>
);

// Shown in confirm dialogs for environments that need an approval: explains what happens and asks for a reason.
export const ApprovalNotice: React.FC<{ env: string; reason: string; onReason: (value: string) => void; id?: string }> = ({ env, reason, onReason, id = 'approval-reason' }) => (
  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2 text-left">
    <div className="flex items-start gap-2 text-xs text-amber-900">
      <Lock size={14} className="shrink-0 mt-0.5" aria-hidden />
      <span>
        Deploys to <span className="font-mono font-semibold">{env}</span> need an approval: a request goes to the approvers instead of running now. It runs as
        soon as someone approves it.
      </span>
    </div>
    <ReasonField id={id} value={reason} onChange={onReason} />
  </div>
);

export const ApprovalRequiredBadge: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span
    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-[10px] font-semibold text-amber-800 ${className}`}
    title="Deploys to this environment wait for an approved request"
  >
    <Lock size={10} aria-hidden /> Approval required
  </span>
);

// A request waiting for approval (amber) or the approved action running (sky).
export const PendingApprovalStrip: React.FC<{ pending: PendingApproval }> = ({ pending }) => {
  const running = pending.status === 'EXECUTING';
  return (
    <div
      className={`rounded-md border px-2.5 py-1.5 text-[11px] flex items-start gap-1.5 ${
        running ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
      role="status"
    >
      {running ? <Loader2 size={12} className="shrink-0 mt-0.5 animate-spin" aria-hidden /> : <Clock size={12} className="shrink-0 mt-0.5" aria-hidden />}
      <div className="min-w-0">
        <div className="font-semibold">{running ? 'Running approved action' : 'Waiting for approval'}</div>
        <div className="truncate" title={pending.summary}>
          {pending.summary}
        </div>
        <div className="opacity-80">
          {pending.requestedBy} · {formatRelativeTime(pending.at)} ·{' '}
          <Link to="/approvals" className="underline font-semibold">
            View request
          </Link>
        </div>
      </div>
    </div>
  );
};

// Page-level confirmation that a request was sent, with the way to follow it.
export const ApprovalRequestedBanner: React.FC<{ message: string; onDismiss: () => void }> = ({ message, onDismiss }) => (
  <div className="p-3 rounded-md border border-amber-200 bg-amber-50 text-amber-900 text-xs flex items-start justify-between gap-3" role="status">
    <span className="flex items-start gap-2">
      <Lock size={14} className="shrink-0 mt-0.5" aria-hidden />
      <span>
        {message}{' '}
        <Link to="/approvals" className="inline-flex items-center gap-0.5 font-semibold underline">
          View request <ArrowRight size={11} />
        </Link>
      </span>
    </span>
    <button type="button" onClick={onDismiss} className="p-0.5 text-amber-700 hover:text-amber-900" aria-label="Dismiss">
      <X size={13} />
    </button>
  </div>
);
