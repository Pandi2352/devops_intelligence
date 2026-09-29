import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  isLoading?: boolean;
  /** Shown inside the dialog, e.g. a server-side conflict that needs another decision. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'danger',
  isLoading = false,
  error,
  onConfirm,
  onCancel,
}) => (
  <Modal
    isOpen={isOpen}
    onClose={onCancel}
    title={title}
    maxWidth="sm"
    preventClose={isLoading}
    icon={
      <div
        className={`w-9 h-9 rounded-md flex items-center justify-center border ${
          tone === 'danger' ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-sky-50 border-sky-200 text-sky-600'
        }`}
      >
        <AlertTriangle size={18} />
      </div>
    }
    footer={
      <>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          type="button"
          variant={tone === 'danger' ? 'dangerSolid' : 'primary'}
          onClick={onConfirm}
          isLoading={isLoading}
        >
          {confirmLabel}
        </Button>
      </>
    }
  >
    <div className="text-sm text-slate-700 space-y-3">
      <div>{message}</div>
      {error && (
        <div className="p-2.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs" role="alert">
          {error}
        </div>
      )}
    </div>
  </Modal>
);
