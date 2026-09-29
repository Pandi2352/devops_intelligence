import React from 'react';
import { ReleaseCheck, Severity, SeverityCounts } from '../../api/securityApi';
import { RATING_CHIP, SEVERITIES, SEVERITY_META, checkMeta, ratingLetter, severityMeta } from './securityMeta';

export const SeverityChip: React.FC<{ severity: Severity | string; count?: number; className?: string }> = ({ severity, count, className = '' }) => {
  const m = severityMeta(severity);
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold whitespace-nowrap ${m.chip} ${className}`}>
      {count !== undefined && <span className="font-mono">{count}</span>}
      {m.label}
    </span>
  );
};

// One chip per severity; zero counts are shown faded so the row keeps its shape.
export const SeverityCountChips: React.FC<{ counts: SeverityCounts; hideZero?: boolean }> = ({ counts, hideZero }) => (
  <span className="inline-flex flex-wrap items-center gap-1">
    {SEVERITIES.map((s) => {
      const n = counts[SEVERITY_META[s].key] || 0;
      if (hideZero && !n) return null;
      return <SeverityChip key={s} severity={s} count={n} className={n ? '' : 'opacity-40'} />;
    })}
  </span>
);

export const RatingChip: React.FC<{ value?: string; label: string }> = ({ value, label }) => {
  const letter = ratingLetter(value);
  return (
    <span
      className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold ${letter ? RATING_CHIP[letter] : 'bg-slate-100 text-slate-400'}`}
      title={`${label}: ${letter || 'not rated'}`}
      aria-label={`${label} rating ${letter || 'not rated'}`}
    >
      {letter || '–'}
    </span>
  );
};

export const CheckIcon: React.FC<{ status: string }> = ({ status }) => {
  const m = checkMeta(status);
  return (
    <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold shrink-0 ${m.icon}`} aria-label={status}>
      {m.symbol}
    </span>
  );
};

// Release checks (quality gate, critical CVEs) as compact rows. Used on the Security tab and on approval requests.
export const ReleaseCheckList: React.FC<{ checks: ReleaseCheck[]; compact?: boolean }> = ({ checks, compact }) => (
  <ul className={compact ? 'space-y-1' : 'space-y-1.5'}>
    {checks.map((c) => {
      const m = checkMeta(c.status);
      return (
        <li key={c.key || c.label} className={`flex items-start gap-2 rounded border px-2 ${compact ? 'py-1' : 'py-1.5'} ${m.box}`}>
          <span className="mt-px">
            <CheckIcon status={c.status} />
          </span>
          <div className={`min-w-0 text-xs ${m.text}`}>
            <span className="font-semibold">{c.label}</span>
            {c.blocking && c.status === 'fail' && (
              <span className="ml-1.5 px-1 rounded bg-rose-600 text-white text-[9px] font-bold uppercase align-middle">blocking</span>
            )}
            {c.detail && <span className="text-[11px] opacity-90"> — {c.detail}</span>}
          </div>
        </li>
      );
    })}
  </ul>
);
