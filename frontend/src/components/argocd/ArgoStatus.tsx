import React from 'react';
import { CheckCircle2, CircleDashed, HeartPulse, Loader2, PauseCircle, XCircle, AlertTriangle, HelpCircle, GitCompare } from 'lucide-react';

const SYNC: Record<string, { cls: string; icon: React.ReactNode }> = {
  Synced: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <CheckCircle2 size={11} aria-hidden /> },
  OutOfSync: { cls: 'bg-amber-50 text-amber-800 border-amber-200', icon: <GitCompare size={11} aria-hidden /> },
  Unknown: { cls: 'bg-slate-100 text-slate-600 border-slate-200', icon: <HelpCircle size={11} aria-hidden /> },
};

const HEALTH: Record<string, { cls: string; icon: React.ReactNode }> = {
  Healthy: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <HeartPulse size={11} aria-hidden /> },
  Progressing: { cls: 'bg-sky-50 text-sky-700 border-sky-200', icon: <Loader2 size={11} className="animate-spin" aria-hidden /> },
  Degraded: { cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: <XCircle size={11} aria-hidden /> },
  Suspended: { cls: 'bg-slate-100 text-slate-600 border-slate-200', icon: <PauseCircle size={11} aria-hidden /> },
  Missing: { cls: 'bg-slate-100 text-slate-600 border-slate-200', icon: <CircleDashed size={11} aria-hidden /> },
  Unknown: { cls: 'bg-slate-100 text-slate-600 border-slate-200', icon: <HelpCircle size={11} aria-hidden /> },
};

const Pill: React.FC<{ label: string; cls: string; icon: React.ReactNode; title?: string }> = ({ label, cls, icon, title }) => (
  <span title={title} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-semibold whitespace-nowrap ${cls}`}>
    {icon}
    {label}
  </span>
);

export const SyncPill: React.FC<{ status: string }> = ({ status }) => {
  const s = SYNC[status] || SYNC.Unknown;
  return <Pill label={status || 'Unknown'} cls={s.cls} icon={s.icon} />;
};

export const HealthPill: React.FC<{ status: string; message?: string }> = ({ status, message }) => {
  const h = HEALTH[status] || HEALTH.Unknown;
  return <Pill label={status || 'Unknown'} cls={h.cls} icon={h.icon} title={message || undefined} />;
};

export const OperationPill: React.FC<{ phase: string }> = ({ phase }) => {
  if (phase === 'Running') return <Pill label="Syncing" cls="bg-sky-50 text-sky-700 border-sky-200" icon={<Loader2 size={11} className="animate-spin" aria-hidden />} />;
  if (phase === 'Failed' || phase === 'Error') return <Pill label={`Sync ${phase.toLowerCase()}`} cls="bg-rose-50 text-rose-700 border-rose-200" icon={<AlertTriangle size={11} aria-hidden />} />;
  if (phase === 'Terminating') return <Pill label="Terminating" cls="bg-amber-50 text-amber-800 border-amber-200" icon={<Loader2 size={11} className="animate-spin" aria-hidden />} />;
  return null;
};
