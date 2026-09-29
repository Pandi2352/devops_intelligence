import React from 'react';
import { Loader2, Pencil, PlugZap, Star, Trash2 } from 'lucide-react';

interface IconActionProps {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  tone?: 'default' | 'danger' | 'active';
  isBusy?: boolean;
  disabled?: boolean;
}

export const IconAction: React.FC<IconActionProps> = ({ label, onClick, icon, tone = 'default', isBusy, disabled }) => {
  const toneClass =
    tone === 'danger'
      ? 'hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200'
      : tone === 'active'
      ? 'text-amber-500 border-amber-200 bg-amber-50'
      : 'hover:text-sky-700 hover:bg-sky-50 hover:border-sky-200';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isBusy}
      aria-label={label}
      title={label}
      className={`h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${toneClass}`}
    >
      {isBusy ? <Loader2 size={14} className="animate-spin" /> : icon}
    </button>
  );
};

interface ConnectorRowActionsProps {
  name: string;
  isDefault?: boolean;
  isTesting?: boolean;
  canManage: boolean;
  onTest: () => void;
  onEdit: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
  extra?: React.ReactNode;
}

// Standard action set for a connector row: test, edit, make default, delete.
export const ConnectorRowActions: React.FC<ConnectorRowActionsProps> = ({
  name,
  isDefault,
  isTesting,
  canManage,
  onTest,
  onEdit,
  onSetDefault,
  onDelete,
  extra,
}) => (
  <div className="flex items-center justify-end gap-1.5">
    {extra}
    {canManage && (
      <>
        <IconAction label={`Test connection for ${name}`} onClick={onTest} icon={<PlugZap size={14} />} isBusy={isTesting} />
        <IconAction label={`Edit ${name}`} onClick={onEdit} icon={<Pencil size={14} />} />
        <IconAction
          label={isDefault ? `${name} is the default` : `Set ${name} as default`}
          onClick={onSetDefault}
          icon={<Star size={14} fill={isDefault ? 'currentColor' : 'none'} />}
          tone={isDefault ? 'active' : 'default'}
          disabled={isDefault}
        />
        <IconAction label={`Delete ${name}`} onClick={onDelete} icon={<Trash2 size={14} />} tone="danger" />
      </>
    )}
  </div>
);

export const DefaultBadge: React.FC = () => (
  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
    <Star size={9} fill="currentColor" aria-hidden /> Default
  </span>
);
