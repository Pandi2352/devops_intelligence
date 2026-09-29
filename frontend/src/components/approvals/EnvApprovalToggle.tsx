import React, { useState } from 'react';
import { Toggle } from '../common/Form';
import { projectApi } from '../../api/projectApi';
import { getApiErrorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';

const defaultFor = (env: string) => /^(prod|production)$/i.test(env);

interface EnvApprovalToggleProps {
  projectId: string;
  env: string;
  /** Effective value from the overview; undefined while it loads. */
  value?: boolean;
  /** From the overview: true when the environment follows the default rule. */
  isDefault?: boolean;
  onChanged?: () => void;
}

// "Deploys need approval" switch for one environment (project admins). Production is gated by default.
export const EnvApprovalToggle: React.FC<EnvApprovalToggleProps> = ({ projectId, env, value, isDefault: isDefaultProp, onChanged }) => {
  const toast = useToast();
  const fallback = defaultFor(env);
  const [saved, setSaved] = useState<{ value: boolean; isDefault: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const current = saved?.value ?? value ?? fallback;
  const isDefault = saved ? saved.isDefault : isDefaultProp ?? current === fallback;

  const save = async (next: boolean | null) => {
    setBusy(true);
    try {
      const res = await projectApi.setEnvironmentApproval(projectId, env, next);
      setSaved({ value: res.requiresApproval, isDefault: res.isDefault });
      toast.success(res.message);
      onChanged?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err, `Could not change the approval setting of ${env}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-w-[190px]">
      <Toggle
        id={`approval-${env}`}
        checked={current}
        disabled={busy}
        onChange={(v) => save(v)}
        label="Deploys need approval"
        description={isDefault ? `Default for ${env}` : `Custom (default: ${fallback ? 'on' : 'off'})`}
      />
      {!isDefault && (
        <button type="button" disabled={busy} onClick={() => save(null)} className="text-[11px] text-sky-700 hover:underline disabled:opacity-50">
          Reset to default
        </button>
      )}
    </div>
  );
};
