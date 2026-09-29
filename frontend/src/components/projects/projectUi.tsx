import React from 'react';
import { CheckCircle2, CircleDashed, MinusCircle, PlusCircle, RefreshCw, XCircle } from 'lucide-react';
import { SetupCheck, SetupStep, StepStatus } from '../../api/projectApi';
import { sortEnvironments } from '../../utils/project';

export const EnvironmentChips: React.FC<{ names: string[] }> = ({ names }) => (
  <div className="flex flex-wrap gap-1">
    {sortEnvironments(names, (n) => n).map((n) => (
      <span key={n} className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[11px] font-mono text-slate-700">
        {n}
      </span>
    ))}
  </div>
);

// One row per setup item: green when present and correct, red with the reason otherwise.
export const CheckList: React.FC<{ checks: SetupCheck[] }> = ({ checks }) => (
  <ul className="divide-y divide-slate-100">
    {checks.map((c) => (
      <li key={c.key} className="flex items-start gap-2.5 py-2">
        {c.ok ? (
          <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-0.5" aria-label="OK" />
        ) : (
          <XCircle size={15} className="text-rose-600 shrink-0 mt-0.5" aria-label="Missing" />
        )}
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-800">{c.label}</div>
          <div className={`text-[11px] break-words ${c.ok ? 'text-slate-500' : 'text-rose-700'}`}>{c.detail}</div>
        </div>
      </li>
    ))}
  </ul>
);

const STEP_STYLE: Record<StepStatus, { icon: React.ReactNode; label: string; text: string }> = {
  exists: { icon: <CheckCircle2 size={14} className="text-slate-400" />, label: 'already there', text: 'text-slate-500' },
  created: { icon: <PlusCircle size={14} className="text-emerald-600" />, label: 'created', text: 'text-emerald-700' },
  updated: { icon: <RefreshCw size={14} className="text-sky-600" />, label: 'updated', text: 'text-sky-700' },
  failed: { icon: <XCircle size={14} className="text-rose-600" />, label: 'failed', text: 'text-rose-700' },
  skipped: { icon: <MinusCircle size={14} className="text-slate-400" />, label: 'skipped', text: 'text-slate-500' },
};

// What a provision / remove run actually did, step by step.
export const StepList: React.FC<{ steps: SetupStep[] }> = ({ steps }) => (
  <ol className="space-y-1.5">
    {steps.map((s) => {
      const style = STEP_STYLE[s.status];
      return (
        <li key={s.key} className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0" aria-hidden>
            {style.icon}
          </span>
          <div className="min-w-0 text-xs">
            <span className="font-semibold text-slate-800">{s.label}</span>
            <span className={`ml-1.5 text-[10px] uppercase tracking-wide font-semibold ${style.text}`}>{style.label}</span>
            <div className={`text-[11px] break-words ${s.status === 'failed' ? 'text-rose-700' : 'text-slate-500'}`}>{s.detail}</div>
          </div>
        </li>
      );
    })}
  </ol>
);

export const CheckSummary: React.FC<{ checks: SetupCheck[] }> = ({ checks }) => {
  const missing = checks.filter((c) => !c.ok).length;
  if (!checks.length)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
        <CircleDashed size={13} /> not checked
      </span>
    );
  return missing ? (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700">
      <XCircle size={13} /> {missing} of {checks.length} missing
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
      <CheckCircle2 size={13} /> all {checks.length} ready
    </span>
  );
};
