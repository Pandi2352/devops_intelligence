import React from 'react';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Badge, BadgeVariant } from '../common/Badge';
import { ConnectionTestResult } from '../../types';
import { formatDateTime, formatRelativeTime } from '../../utils/format';

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  Connected: 'healthy',
  Healthy: 'healthy',
  Error: 'offline',
  Offline: 'offline',
  Disconnected: 'offline',
  Degraded: 'degraded',
  Connecting: 'progressing',
  Unknown: 'default',
  Disabled: 'default',
};

interface StatusCellProps {
  status: string;
  checkedAt?: string;
  error?: string;
}

// Status badge + "checked 5m ago" + last error, used in every connector table.
export const ConnectorStatusCell: React.FC<StatusCellProps> = ({ status, checkedAt, error }) => {
  const variant = STATUS_VARIANT[status] || 'default';
  return (
    <div className="space-y-1 min-w-[140px]">
      <Badge label={status} variant={variant} withPulse={variant === 'healthy'} />
      <div className="text-[11px] text-slate-500" title={formatDateTime(checkedAt)}>
        Checked {formatRelativeTime(checkedAt).toLowerCase()}
      </div>
      {error && variant !== 'healthy' && (
        <p className="text-[11px] text-rose-700 leading-snug line-clamp-2 max-w-[260px]" title={error}>
          {error}
        </p>
      )}
    </div>
  );
};

interface TestResultProps {
  result: ConnectionTestResult | null;
  isTesting?: boolean;
}

// Inline outcome of the "Test connection" button inside a connector form.
export const ConnectionTestPanel: React.FC<TestResultProps> = ({ result, isTesting }) => {
  if (isTesting) {
    return (
      <div className="p-3 rounded-md border border-sky-200 bg-sky-50 text-sky-800 text-xs flex items-center gap-2" role="status">
        <Loader2 size={15} className="animate-spin shrink-0" />
        Testing connection…
      </div>
    );
  }
  if (!result) return null;
  return (
    <div
      role="status"
      className={`p-3 rounded-md border text-xs space-y-1.5 ${
        result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
      }`}
    >
      <div className="flex items-start gap-2 font-semibold">
        {result.ok ? (
          <CheckCircle2 size={15} className="shrink-0 mt-px text-emerald-600" />
        ) : (
          <XCircle size={15} className="shrink-0 mt-px text-rose-600" />
        )}
        <span className="break-words">{result.message}</span>
      </div>
      {result.details && (
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 pl-6 font-mono text-[11px]">
          {Object.entries(result.details).map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="text-emerald-700/80 capitalize font-sans">{key}</dt>
              <dd className="truncate" title={String(value)}>
                {String(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
};
