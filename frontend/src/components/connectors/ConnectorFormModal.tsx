import React from 'react';
import { PlugZap } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { ConnectionTestPanel } from './ConnectorStatus';
import { ConnectionTestResult } from '../../types';

interface ConnectorFormModalProps {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  formId: string;
  submitLabel: string;
  isSaving: boolean;
  isTesting: boolean;
  testResult: ConnectionTestResult | null;
  formError?: string | null;
  onTest: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  children: React.ReactNode;
}

// Shared shell for the add/edit connector dialogs: form body, test result, error, and a
// footer with "Test connection", "Cancel" and the submit button.
export const ConnectorFormModal: React.FC<ConnectorFormModalProps> = ({
  title,
  subtitle,
  icon,
  formId,
  submitLabel,
  isSaving,
  isTesting,
  testResult,
  formError,
  onTest,
  onSubmit,
  onClose,
  children,
}) => (
  <Modal
    isOpen
    onClose={onClose}
    title={title}
    subtitle={subtitle}
    icon={icon}
    maxWidth="lg"
    preventClose={isSaving}
    footer={
      <>
        <Button
          type="button"
          variant="outline"
          onClick={onTest}
          isLoading={isTesting}
          disabled={isSaving}
          leftIcon={<PlugZap size={14} />}
          className="sm:mr-auto"
        >
          Test connection
        </Button>
        <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" form={formId} variant="primary" isLoading={isSaving} disabled={isTesting}>
          {submitLabel}
        </Button>
      </>
    }
  >
    <form id={formId} onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
          {formError}
        </div>
      )}
      {children}
      <ConnectionTestPanel result={testResult} isTesting={isTesting} />
    </form>
  </Modal>
);
