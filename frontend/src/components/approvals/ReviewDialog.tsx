import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { FormField, TextArea } from '../common/Form';
import { ApprovalItem } from '../../api/approvalApi';
import { ACTION_LABEL } from './approvalMeta';

const SELF_APPROVAL_MIN = 10;

interface ReviewDialogProps {
  request: ApprovalItem | null;
  decision: 'APPROVED' | 'REJECTED';
  busy?: boolean;
  error?: string | null;
  onSubmit: (comment: string) => void;
  onClose: () => void;
}

// Approve / reject with a comment. A Super Admin approving their own request is break-glass: the comment is required.
export const ReviewDialog: React.FC<ReviewDialogProps> = ({ request, decision, busy, error, onSubmit, onClose }) => {
  const [comment, setComment] = useState('');
  if (!request) return null;
  const approving = decision === 'APPROVED';
  const selfApproval = approving && request.mine;
  const tooShort = selfApproval && comment.trim().length < SELF_APPROVAL_MIN;

  return (
    <Modal
      isOpen
      onClose={onClose}
      preventClose={busy}
      maxWidth="md"
      icon={approving ? <CheckCircle2 size={18} className="text-emerald-600" /> : <XCircle size={18} className="text-rose-600" />}
      title={approving ? 'Approve request' : 'Reject request'}
      subtitle={`${ACTION_LABEL[request.action] || request.action} · ${request.projectName}${request.environment ? ` · ${request.environment}` : ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button variant={approving ? 'primary' : 'dangerSolid'} isLoading={busy} disabled={busy || tooShort} onClick={() => onSubmit(comment.trim())}>
            {approving ? 'Approve and run' : 'Reject'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-700">{request.summary || `${request.action} ${request.resource}`}</p>
        {approving && (
          <p className="text-xs text-slate-500">
            Approving runs the action right away, as <span className="font-semibold">{request.requestedByName || request.requestedBy}</span>. You can follow it on this page.
          </p>
        )}
        {selfApproval && (
          <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs flex gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>
              This is your own request. Only a Super Admin can approve their own request, and it is marked as self-approved in the audit log. Write at
              least {SELF_APPROVAL_MIN} characters explaining why it cannot wait for another approver.
            </span>
          </div>
        )}
        <FormField
          id="review-comment"
          label="Comment"
          required={selfApproval}
          hint={selfApproval ? `${comment.trim().length}/${SELF_APPROVAL_MIN} characters minimum` : 'Optional. The requester sees it.'}
          error={error || undefined}
        >
          <TextArea
            id="review-comment"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            invalid={Boolean(error)}
            placeholder={
              selfApproval ? 'e.g. Production is down and no other approver is reachable' : approving ? 'e.g. Checked the diff, good to go' : 'e.g. Wait until after the release freeze'
            }
            autoFocus
          />
        </FormField>
      </div>
    </Modal>
  );
};
