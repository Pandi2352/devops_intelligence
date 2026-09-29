import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronRight, GitCommitHorizontal, Globe, Lock, Rocket } from 'lucide-react';
import { EnvOverview, EnvState } from '../../api/projectApi';
import { ENV_STATE_META } from '../../utils/project';
import { formatDateTime, formatRelativeTime, hostFromUrl } from '../../utils/format';

export const EnvStateChip: React.FC<{ state: EnvState; className?: string }> = ({ state, className = '' }) => {
  const m = ENV_STATE_META[state] || ENV_STATE_META.unknown;
  return (
    <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[11px] font-semibold ${m.chip} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} aria-hidden />
      {m.label}
    </span>
  );
};

// dev → qa → staging → uat → prod, with what each runs. An amber arrow means the left side has a newer
// commit than the right side: something is ready to promote.
export const EnvironmentStrip: React.FC<{ environments: EnvOverview[]; projectId?: string }> = ({ environments, projectId }) => {
  if (!environments.length) return null;
  return (
    <div className="flex items-stretch gap-1 overflow-x-auto pb-1" role="list" aria-label="Environments">
      {environments.map((e, i) => {
        const m = ENV_STATE_META[e.state] || ENV_STATE_META.unknown;
        const next = environments[i + 1];
        const ahead = next && e.commit && next.commit && e.commit !== next.commit && e.state !== 'missing';
        const node = (
          <div
            className={`min-w-[108px] rounded-md border bg-white px-2 py-1.5 ${m.ring} ${projectId ? 'hover:bg-slate-50' : ''}`}
            title={`${e.name}: ${m.label}. ${e.message}${e.tag ? `\nImage ${e.tag}` : ''}`}
          >
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full shrink-0 ${m.dot}`} aria-hidden />
              <span className="text-xs font-semibold font-mono text-slate-900">{e.name}</span>
            </div>
            <div className="mt-0.5 text-[10px] font-mono text-slate-500 truncate">{e.commit || (e.state === 'missing' ? 'not set up' : 'no build yet')}</div>
            <div className="text-[10px] text-slate-400 truncate">{e.lastDeployAt ? formatRelativeTime(e.lastDeployAt) : m.label}</div>
          </div>
        );
        return (
          <React.Fragment key={e.name}>
            <div role="listitem">{projectId ? <Link to={`/projects/${projectId}#env-${e.name}`}>{node}</Link> : node}</div>
            {next && (
              <div className="flex flex-col items-center justify-center px-0.5 shrink-0" aria-hidden>
                <ArrowRight size={14} className={ahead ? 'text-amber-500' : 'text-slate-300'} />
                {ahead && <span className="text-[9px] font-semibold text-amber-600 uppercase">new</span>}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export interface EnvAction {
  label: string;
  icon: React.ReactNode;
  to?: string;
  onClick?: () => void;
}

// Large card for one environment on the project page.
export const EnvironmentTile: React.FC<{ env: EnvOverview; previous?: EnvOverview; actions: EnvAction[] }> = ({ env, previous, actions }) => {
  const m = ENV_STATE_META[env.state] || ENV_STATE_META.unknown;
  const behind = previous && previous.commit && env.commit && previous.commit !== env.commit;
  return (
    <div id={`env-${env.name}`} className={`rounded-lg border-2 bg-white p-4 flex flex-col gap-3 scroll-mt-20 ${m.ring}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-bold font-mono text-slate-900">{env.name}</div>
          <div className="text-[11px] font-mono text-slate-500">{env.namespace}</div>
          {(env.publicUrl || env.previewUrl) && (
            <a
              href={env.publicUrl || env.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 flex items-center gap-1 text-[11px] text-sky-700 hover:underline max-w-[220px]"
              title={env.publicUrl ? `Open ${env.publicUrl}` : `Temporary preview: ${env.previewUrl}`}
            >
              <Globe size={11} className="shrink-0" aria-hidden />
              <span className="truncate font-mono">{env.publicUrl ? hostFromUrl(env.publicUrl) : 'Preview'}</span>
            </a>
          )}
          {env.requiresApproval && (
            <span
              className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-900 text-[10px] font-semibold"
              title="Deploys, syncs, rollbacks and merges here wait for an approver"
            >
              <Lock size={10} /> Approval required
            </span>
          )}
        </div>
        <EnvStateChip state={env.state} />
      </div>
      <p className="text-xs text-slate-600 min-h-[32px]">{env.message}</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <dt className="text-slate-500">Running commit</dt>
        <dd className="font-mono text-slate-800 flex items-center gap-1">
          <GitCommitHorizontal size={12} className="text-slate-400" />
          {env.commit || '—'}
        </dd>
        <dt className="text-slate-500">Built</dt>
        <dd className="text-slate-800" title={formatDateTime(env.builtAt || undefined)}>
          {env.builtAt ? formatRelativeTime(env.builtAt) : '—'}
        </dd>
        <dt className="text-slate-500">Last deploy</dt>
        <dd className="text-slate-800" title={formatDateTime(env.lastDeployAt || undefined)}>
          {env.lastDeployAt ? `${formatRelativeTime(env.lastDeployAt)}${env.lastDeployBy ? ` · ${env.lastDeployBy}` : ''}` : '—'}
        </dd>
        <dt className="text-slate-500">Sync</dt>
        <dd className="text-slate-800">{env.autoSync ? 'automatic' : 'manual (approval)'}</dd>
      </dl>
      {env.tag && (
        <div className="text-[10px] font-mono text-slate-500 bg-slate-50 border border-slate-200 rounded px-2 py-1 truncate" title={env.image}>
          {env.tag}
        </div>
      )}
      {behind && (
        <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          <span className="font-mono">{previous!.name}</span> runs a newer commit ({previous!.commit}). Promote it from Environments.
        </div>
      )}
      <div className="flex flex-wrap gap-1 mt-auto pt-1 border-t border-slate-100">
        {actions.map((a) =>
          a.to ? (
            <Link key={a.label} to={a.to} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-slate-600 hover:text-sky-700 hover:bg-sky-50">
              {a.icon}
              {a.label}
            </Link>
          ) : (
            <button key={a.label} type="button" onClick={a.onClick} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-slate-600 hover:text-sky-700 hover:bg-sky-50">
              {a.icon}
              {a.label}
            </button>
          )
        )}
      </div>
    </div>
  );
};

// Repositories → Cluster → First environment → First deploy
export const SetupStepper: React.FC<{ steps: { key: string; label: string; done: boolean }[] }> = ({ steps }) => {
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Setup progress">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${
              s.done ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : i === current ? 'bg-sky-50 border-sky-300 text-sky-800' : 'bg-white border-slate-200 text-slate-500'
            }`}
            aria-current={i === current ? 'step' : undefined}
          >
            {s.done ? <Check size={12} /> : <span className="w-4 text-center">{i + 1}</span>}
            {s.label}
          </span>
          {i < steps.length - 1 && <ChevronRight size={14} className="text-slate-300" aria-hidden />}
        </li>
      ))}
    </ol>
  );
};

// Latest ArgoCD deploys across all environments, newest first.
export const ActivityFeed: React.FC<{ environments: EnvOverview[]; limit?: number }> = ({ environments, limit = 10 }) => {
  const items = environments
    .flatMap((e) => e.history.map((h) => ({ ...h, env: e.name })))
    .filter((h) => h.at)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
  if (!items.length) return <p className="text-xs text-slate-500">No deploys yet. They appear here after ArgoCD syncs an environment.</p>;
  return (
    <ol className="relative border-l border-slate-200 ml-2 space-y-3">
      {items.map((h, i) => (
        <li key={`${h.env}-${h.at}-${i}`} className="pl-4 relative">
          <span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-white border-2 border-sky-500" aria-hidden />
          <div className="text-xs text-slate-800">
            <span className="font-semibold font-mono">{h.env}</span> synced to <span className="font-mono">{h.revision || '—'}</span>
            {h.by && <span className="text-slate-500"> · {h.by === 'auto-sync' ? 'auto-sync' : `by ${h.by}`}</span>}
          </div>
          <div className="text-[11px] text-slate-400" title={formatDateTime(h.at)}>
            {formatRelativeTime(h.at)}
          </div>
        </li>
      ))}
    </ol>
  );
};

export const PromoteHint: React.FC<{ projectId: string }> = ({ projectId }) => (
  <Link to={`/environments?project=${projectId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline">
    <Rocket size={12} /> Promote in Environments
  </Link>
);
