import React, { useState } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Toggle } from '../common/Form';
import { ArgoAppSummary, ArgoSyncOptions } from '../../api/argoAppsApi';
import { SyncPill } from './ArgoStatus';

interface SyncDialogProps {
  app: ArgoAppSummary;
  isSyncing: boolean;
  onCancel: () => void;
  onConfirm: (options: ArgoSyncOptions) => void;
}

// Sync with the options people actually use; always hard-refreshes from Git first (server side).
export const SyncDialog: React.FC<SyncDialogProps> = ({ app, isSyncing, onCancel, onConfirm }) => {
  const [options, setOptions] = useState<ArgoSyncOptions>({ prune: true, applyOutOfSyncOnly: false, force: false });
  const set = <K extends keyof ArgoSyncOptions>(key: K, value: ArgoSyncOptions[K]) => setOptions((o) => ({ ...o, [key]: value }));

  return (
    <Modal
      isOpen
      onClose={onCancel}
      preventClose={isSyncing}
      maxWidth="sm"
      title={`Sync ${app.name}?`}
      subtitle={`${app.source.path || app.source.chart} @ ${app.source.targetRevision} → ${app.destination.namespace}`}
      icon={
        <div className="w-9 h-9 rounded-md bg-sky-50 border border-sky-200 text-sky-600 flex items-center justify-center">
          <RotateCw size={18} />
        </div>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isSyncing}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(options)} isLoading={isSyncing} leftIcon={<RotateCw size={14} />}>
            Sync
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-xs">
        <div className="flex items-center gap-2">
          Currently <SyncPill status={app.sync.status} />
          {app.resourceCounts.outOfSync > 0 && <span className="text-amber-800">{app.resourceCounts.outOfSync} resource(s) differ from Git</span>}
        </div>
        <p className="text-slate-600">DevOps Intelligence hard-refreshes from Git first, so the sync applies the latest commit on the target revision.</p>
        <div className="space-y-3 p-3 rounded-md border border-slate-200 bg-slate-50/60">
          <Toggle
            id="sync-prune"
            checked={options.prune}
            onChange={(v) => set('prune', v)}
            label="Prune"
            description="Delete cluster resources that are no longer in Git."
          />
          <Toggle
            id="sync-oos"
            checked={options.applyOutOfSyncOnly}
            onChange={(v) => set('applyOutOfSyncOnly', v)}
            label="Apply out-of-sync only"
            description="Skip resources that already match Git. Faster for large apps."
          />
          <Toggle
            id="sync-force"
            checked={options.force}
            onChange={(v) => set('force', v)}
            label="Force"
            description="Delete and re-create resources that cannot be patched."
          />
        </div>
        {options.force && (
          <p className="flex gap-1.5 p-2 rounded-md border border-amber-200 bg-amber-50 text-amber-900">
            <AlertTriangle size={13} className="shrink-0 mt-px" aria-hidden />
            Force re-creates resources, which can briefly take pods down.
          </p>
        )}
      </div>
    </Modal>
  );
};
