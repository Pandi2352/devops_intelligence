import React from 'react';
import { AlertTriangle, CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from 'lucide-react';
import type { StarterRun, StepState } from '../../api/starterApi';
import { formatDuration } from './starterMeta';

const STEP_ICON: Record<StepState, React.ReactNode> = {
  pending: <Circle size={16} className="text-slate-300" aria-label="pending" />,
  running: <Loader2 size={16} className="text-amber-600 animate-spin" aria-label="running" />,
  done: <CheckCircle2 size={16} className="text-emerald-600" aria-label="done" />,
  failed: <XCircle size={16} className="text-rose-600" aria-label="failed" />,
  skipped: <MinusCircle size={16} className="text-slate-400" aria-label="skipped" />,
};

export const TrackerTab: React.FC<{ run: StarterRun }> = ({ run }) => {
  const tokens = (run.usage?.promptTokens || 0) + (run.usage?.completionTokens || 0);
  return (
    <div className="space-y-4">
      {run.steps.length === 0 ? (
        <p className="text-xs text-slate-500">Steps appear here once you generate the project.</p>
      ) : (
        <ol className="relative">
          {run.steps.map((s, i) => {
            const last = i === run.steps.length - 1;
            const duration = s.state === 'running' || s.state === 'done' || s.state === 'failed' ? formatDuration(s.startedAt, s.finishedAt) : '';
            return (
              <li key={s.key} className="relative flex gap-3 pb-4">
                {!last && <span className="absolute left-[7.5px] top-5 bottom-0 w-px bg-slate-200" aria-hidden />}
                <span className="relative z-10 bg-white">{STEP_ICON[s.state] || STEP_ICON.pending}</span>
                <div className="min-w-0 flex-1 -mt-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm font-medium ${s.state === 'pending' ? 'text-slate-400' : 'text-slate-800'}`}>{s.label}</span>
                    {duration && <span className="text-[10px] font-mono text-slate-400">{duration}</span>}
                  </div>
                  {s.message && (
                    <p className={`text-xs mt-0.5 break-words ${s.state === 'failed' ? 'text-rose-700' : 'text-slate-500'}`}>{s.message}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {run.error && (
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span className="break-words">{run.error}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 border-t border-slate-100 pt-3">
        <span>
          AI usage: <span className="font-mono text-slate-700">{tokens.toLocaleString()}</span> tokens
          {run.usage?.requests ? ` over ${run.usage.requests} request${run.usage.requests === 1 ? '' : 's'}` : ''}
        </span>
        {run.model && <span>Model: <span className="font-mono text-slate-700">{run.model}</span></span>}
        <span>Files: <span className="font-mono text-slate-700">{run.files.length}</span></span>
      </div>
    </div>
  );
};
