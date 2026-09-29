import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, XCircle } from 'lucide-react';
import { Button } from '../common/Button';
import { ApprovalItem } from '../../api/approvalApi';
import { formatDateTime, formatRelativeTime } from '../../utils/format';
import { ACTION_LABEL, STATUS_META, durationOf } from './approvalMeta';
import { ReleaseCheckList } from '../security/SecurityChips';
import { isReleaseCheckList } from '../security/securityMeta';

interface ApprovalCardProps {
  request: ApprovalItem;
  busy?: boolean;
  onApprove: (r: ApprovalItem) => void;
  onReject: (r: ApprovalItem) => void;
  onCancel: (r: ApprovalItem) => void;
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0">
    <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
    <div className="text-xs text-slate-700 font-mono truncate">{children}</div>
  </div>
);

const isUrl = (v?: string) => Boolean(v && /^https?:\/\//.test(v));

export const ApprovalCard: React.FC<ApprovalCardProps> = ({ request: r, busy, onApprove, onReject, onCancel }) => {
  const status = STATUS_META[r.status] || STATUS_META.PENDING;
  const ctx = r.context || {};
  const projectHref = r.projectId ? `/projects/${r.projectId}` : null;
  const hasContext = ctx.runningImage || ctx.gitRevision || ctx.sync || ctx.health || ctx.mergeRequest || ctx.sourceCommit;
  const releaseChecks = isReleaseCheckList(ctx.releaseChecks) ? ctx.releaseChecks : [];
  const decided = r.reviewedBy && r.status !== 'PENDING' && r.status !== 'CANCELLED';

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <header className="flex flex-wrap items-start gap-2">
        <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
          {ACTION_LABEL[r.action] || r.action}
        </span>
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${status.chip}`}>
          {r.status === 'EXECUTING' && <Loader2 size={10} className="animate-spin" />}
          {status.label}
        </span>
        <span className="ml-auto text-[11px] text-slate-500" title={formatDateTime(r.createdAt)}>
          {r.requestedByName || r.requestedBy}
          {r.requestedByRole && <span className="text-slate-400"> ({r.requestedByRole})</span>} · {formatRelativeTime(r.createdAt)}
        </span>
      </header>

      <div>
        <h3 className="text-sm font-semibold text-slate-900">{r.summary || `${r.action} ${r.resource}`}</h3>
        <div className="text-xs text-slate-500 font-mono mt-0.5">
          {projectHref ? (
            <Link to={projectHref} className="hover:underline text-sky-700">
              {r.projectName}
            </Link>
          ) : (
            r.projectName
          )}
          {r.environment && <span> · {r.environment}</span>}
          {r.resource && <span className="text-slate-400"> · {r.resource}</span>}
        </div>
      </div>

      {r.reason && <p className="text-xs text-slate-700 border-l-2 border-slate-200 pl-2 italic">“{r.reason}”</p>}

      {hasContext && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-md bg-slate-50 border border-slate-100 p-2.5">
          {ctx.runningImage && <Field label="Running image"><span title={ctx.runningImage}>{ctx.runningImage}</span></Field>}
          {ctx.gitRevision && <Field label="Git revision">{String(ctx.gitRevision).slice(0, 10)}</Field>}
          {(ctx.sync || ctx.health) && <Field label="Sync / health">{[ctx.sync, ctx.health].filter(Boolean).join(' / ')}</Field>}
          {ctx.mergeRequest && (
            <Field label="Merge request">
              {isUrl(ctx.mergeRequest) ? (
                <a href={ctx.mergeRequest} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-700 hover:underline">
                  open <ExternalLink size={10} />
                </a>
              ) : (
                ctx.mergeRequest
              )}
            </Field>
          )}
          {ctx.sourceCommit && <Field label="Source commit">{String(ctx.sourceCommit).slice(0, 10)}</Field>}
        </div>
      )}

      {releaseChecks.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Release checks</div>
          <ReleaseCheckList checks={releaseChecks} compact />
        </div>
      )}

      {decided && (
        <div className="text-xs text-slate-600">
          {r.status === 'REJECTED' ? 'Rejected' : 'Approved'} by <span className="font-semibold">{r.reviewedBy}</span>
          {r.reviewedAt && <span title={formatDateTime(r.reviewedAt)}> · {formatRelativeTime(r.reviewedAt)}</span>}
          {r.reviewComment && <span className="text-slate-500"> — “{r.reviewComment}”</span>}
          {r.selfApproved && (
            <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-900 text-[10px] font-semibold">
              <AlertTriangle size={10} /> self-approved
            </span>
          )}
        </div>
      )}

      {r.execution?.message && (
        <div
          className={`text-xs rounded-md border p-2 ${
            r.status === 'FAILED' ? 'bg-rose-50 border-rose-200 text-rose-800' : r.status === 'EXECUTED' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-sky-50 border-sky-200 text-sky-800'
          }`}
        >
          {r.execution.message}
          <span className="ml-2 opacity-70 font-mono">
            {r.execution.httpStatus ? `HTTP ${r.execution.httpStatus}` : ''}
            {durationOf(r.execution.startedAt, r.execution.finishedAt) && ` · ${durationOf(r.execution.startedAt, r.execution.finishedAt)}`}
          </span>
        </div>
      )}

      {(r.canReview || r.canCancel) && r.status === 'PENDING' && (
        <footer className="flex flex-wrap justify-end gap-2 pt-1">
          {r.canCancel && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onCancel(r)}>
              Cancel request
            </Button>
          )}
          {r.canReview && (
            <>
              <Button variant="danger" size="sm" leftIcon={<XCircle size={13} />} disabled={busy} onClick={() => onReject(r)}>
                Reject
              </Button>
              <Button variant="primary" size="sm" leftIcon={<CheckCircle2 size={13} />} disabled={busy} onClick={() => onApprove(r)}>
                Approve
              </Button>
            </>
          )}
        </footer>
      )}
    </article>
  );
};
