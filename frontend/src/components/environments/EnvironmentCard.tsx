import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, GitBranch, Globe, History, Info, RotateCcw, RotateCw, Undo2, XCircle } from 'lucide-react';
import { EnvironmentView } from '../../api/environmentApi';
import { formatDateTime, formatRelativeTime, hostFromUrl } from '../../utils/format';
import { ApprovalRequiredBadge, PendingApprovalStrip } from './ApprovalNotice';

const ACCENT: Record<string, { bar: string; label: string }> = {
  dev: { bar: 'border-l-sky-500', label: 'text-sky-700' },
  qa: { bar: 'border-l-teal-500', label: 'text-teal-700' },
  staging: { bar: 'border-l-amber-500', label: 'text-amber-700' },
  prod: { bar: 'border-l-violet-600', label: 'text-violet-700' },
  production: { bar: 'border-l-violet-600', label: 'text-violet-700' },
};

// One dot for the combined ArgoCD state; the worst condition wins.
const statusTone = (env: EnvironmentView) => {
  if (env.health === 'Degraded' || env.operation?.phase === 'Failed' || env.operation?.phase === 'Error') return 'bg-rose-500';
  if (env.health === 'Progressing' || env.operation?.phase === 'Running') return 'bg-sky-500 animate-pulse';
  if (env.sync !== 'Synced' || env.health !== 'Healthy') return 'bg-amber-500';
  return 'bg-emerald-500';
};

const shortSha = (a?: string, b?: string) => Boolean(a && b && (a.startsWith(b) || b.startsWith(a)));

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-2 py-1.5 border-b border-slate-100 last:border-b-0">
    <dt className="text-[11px] text-slate-500">{label}</dt>
    <dd className="min-w-0 text-xs text-slate-800">{children}</dd>
  </div>
);

const PipelineStatus: React.FC<{ status?: string }> = ({ status }) => {
  if (!status) return null;
  if (status === 'success') return <CheckCircle2 size={12} className="inline text-emerald-600" aria-label="success" />;
  if (status === 'failed' || status === 'canceled') return <XCircle size={12} className="inline text-rose-600" aria-label={status} />;
  return <RotateCw size={12} className="inline text-sky-600 animate-spin" aria-label={status} />;
};

interface EnvironmentCardProps {
  env: EnvironmentView;
  canManage: boolean;
  onSync: (env: EnvironmentView) => void;
  onRedeploy: (env: EnvironmentView) => void;
  onHistory: (env: EnvironmentView) => void;
  onDetails: (env: EnvironmentView) => void;
}

export const EnvironmentCard: React.FC<EnvironmentCardProps> = ({ env, canManage, onSync, onRedeploy, onHistory, onDetails }) => {
  const accent = ACCENT[env.key] || { bar: 'border-l-slate-400', label: 'text-slate-700' };
  const live = env.live;
  const syncing = env.operation?.phase === 'Running';
  const drift = Boolean(env.desired && (!live || env.desired.tag !== live.tag) && env.desired.tag !== 'not-built-yet');
  const rolledBack = env.lastChange?.kind === 'rollback';
  const headNotDeployed = Boolean(env.branchHead && live?.commitSha && !shortSha(env.branchHead.sha, live.commitSha));
  const imageName = live ? live.image.slice(0, live.image.lastIndexOf(':')).split('/').pop() : '';
  // A request already waits (or its approved action runs): a second click would only point at the same request.
  const awaiting = env.pendingApproval;
  const awaitingLabel = awaiting?.status === 'EXECUTING' ? 'Running' : 'Requested';

  return (
    <article aria-label={`${env.key} environment`} className={`bg-white border border-slate-200 border-l-4 ${accent.bar} rounded-md flex flex-col min-w-0`}>
      <header className="px-4 pt-3 pb-2.5 border-b border-slate-100">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 min-w-0">
            <h3 className={`text-sm font-bold uppercase tracking-wide ${accent.label}`}>{env.key}</h3>
            {env.requiresApproval && <ApprovalRequiredBadge />}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-700 whitespace-nowrap">
            <span className={`w-2 h-2 rounded-full ${statusTone(env)}`} aria-hidden />
            {env.sync} · {env.health}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-500 truncate" title={`${env.cluster} / ${env.namespace}`}>
          <span className="font-mono text-slate-700">{env.namespace}</span> · {env.cluster} · {env.autoSync ? 'auto-sync' : 'manual sync'}
        </p>
        {env.publicUrl && (
          <a
            href={env.publicUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 flex items-center gap-1 text-[11px] text-sky-700 hover:underline min-w-0"
            title={`Open ${env.publicUrl}`}
          >
            <Globe size={11} className="shrink-0" aria-hidden />
            <span className="truncate font-mono">{hostFromUrl(env.publicUrl)}</span>
          </a>
        )}
      </header>

      <dl className="px-4 py-1.5 flex-1">
        <Row label="Running">
          {live ? (
            <>
              <a href={live.commitUrl} target="_blank" rel="noreferrer" className="font-mono text-indigo-700 hover:underline mr-1.5">
                {live.commitSha}
              </a>
              <span className="line-clamp-2" title={live.commitTitle}>
                {live.commitTitle || 'Unknown commit'}
              </span>
              <span className="block text-[11px] text-slate-500">
                {live.commitAuthor}
                {live.builtAt && (
                  <span title={formatDateTime(live.builtAt)}>
                    {live.commitAuthor ? ' · ' : ''}built {formatRelativeTime(live.builtAt)}
                  </span>
                )}
              </span>
            </>
          ) : (
            <span className="text-slate-500">Nothing deployed yet</span>
          )}
        </Row>
        {live && (
          <Row label="Image">
            <span className="block font-mono text-[11px] truncate" title={live.image}>
              <span className="text-slate-500">{imageName}:</span>
              {live.tag}
            </span>
          </Row>
        )}
        {live?.pipelineId && (
          <Row label="Pipeline">
            <a href={live.pipelineUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
              #{live.pipelineId} <PipelineStatus status={live.pipelineStatus} />
            </a>
          </Row>
        )}
        {env.branch && (
          <Row label="Branch">
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-purple-800">
              <GitBranch size={11} aria-hidden /> {env.branch}
            </span>
            {env.branchHead ? (
              <a href={env.branchHead.webUrl} target="_blank" rel="noreferrer" className="ml-1.5 font-mono text-[11px] text-indigo-700 hover:underline">
                {env.branchHead.sha}
              </a>
            ) : (
              <span className="ml-1.5 text-[11px] text-slate-500">not created</span>
            )}
            {env.branchPipeline && (
              <a href={env.branchPipeline.webUrl} target="_blank" rel="noreferrer" className="ml-1.5" title={`Latest ${env.branch} pipeline: ${env.branchPipeline.status}`}>
                <PipelineStatus status={env.branchPipeline.status} />
              </a>
            )}
          </Row>
        )}
        <Row label="Pods">
          {env.pods ? (
            <span className="inline-flex items-center gap-2">
              <span className="flex gap-0.5" aria-hidden>
                {Array.from({ length: Math.min(env.pods.desired, 10) }).map((_, i) => (
                  <span key={i} className={`w-2 h-3 rounded-sm ${i < env.pods!.ready ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                ))}
              </span>
              <span className={env.pods.ready === env.pods.desired ? 'text-slate-700' : 'text-amber-700'}>
                {env.pods.ready}/{env.pods.desired} ready
              </span>
            </span>
          ) : (
            <span className="text-slate-500">none</span>
          )}
        </Row>
        {env.syncedRevision && (
          <Row label="GitOps">
            <a href={env.syncedRevision.webUrl} target="_blank" rel="noreferrer" className="block truncate hover:underline" title={env.syncedRevision.title}>
              <span className="font-mono text-indigo-700">{env.syncedRevision.sha}</span> {env.syncedRevision.title}
            </a>
          </Row>
        )}
      </dl>

      {awaiting && (
        <div className="px-4 pb-3">
          <PendingApprovalStrip pending={awaiting} />
        </div>
      )}

      {(rolledBack || drift || headNotDeployed || (env.operation && !['Succeeded', 'Running'].includes(env.operation.phase))) && (
        <div className="px-4 pb-3 space-y-1.5">
          {rolledBack && (
            <p className="flex gap-1.5 p-2 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
              <Undo2 size={13} className="shrink-0 mt-px" aria-hidden />
              <span>
                Rolled back {formatRelativeTime(env.lastChange!.date).toLowerCase()} by {env.lastChange!.author}. The branch head is not running.
              </span>
            </p>
          )}
          {drift && !rolledBack && (
            <p className="flex gap-1.5 p-2 rounded-md bg-sky-50 border border-sky-200 text-[11px] text-sky-900">
              <Info size={13} className="shrink-0 mt-px" aria-hidden />
              <span className="min-w-0">
                Git wants <span className="font-mono break-all">{env.desired!.tag}</span>
                {env.autoSync ? '. ArgoCD will deploy it shortly.' : '. Sync to deploy it.'}
              </span>
            </p>
          )}
          {headNotDeployed && !rolledBack && !drift && (
            <p className="flex gap-1.5 p-2 rounded-md bg-slate-50 border border-slate-200 text-[11px] text-slate-700">
              <Info size={13} className="shrink-0 mt-px" aria-hidden />
              <span>
                {env.branch} head {env.branchHead!.sha} is not deployed yet{env.branchPipeline ? ` (pipeline ${env.branchPipeline.status})` : ''}.
              </span>
            </p>
          )}
          {env.operation && !['Succeeded', 'Running'].includes(env.operation.phase) && (
            <p className="flex gap-1.5 p-2 rounded-md bg-rose-50 border border-rose-200 text-[11px] text-rose-800">
              <AlertTriangle size={13} className="shrink-0 mt-px" aria-hidden />
              <span className="min-w-0 break-words">
                Last sync {env.operation.phase}: {env.operation.message}
              </span>
            </p>
          )}
        </div>
      )}

      <footer className="px-3 py-2 border-t border-slate-100 flex items-center gap-1 flex-wrap">
        <button type="button" onClick={() => onDetails(env)} className="h-7 px-2 inline-flex items-center gap-1 rounded text-[11px] font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer">
          <Info size={12} aria-hidden /> Details
        </button>
        <button type="button" onClick={() => onHistory(env)} className="h-7 px-2 inline-flex items-center gap-1 rounded text-[11px] font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer">
          <History size={12} aria-hidden /> History
        </button>
        <a href={env.argoUrl} target="_blank" rel="noreferrer" className="h-7 px-2 inline-flex items-center gap-1 rounded text-[11px] font-semibold text-slate-600 hover:bg-slate-100">
          ArgoCD <ExternalLink size={10} aria-hidden />
        </a>
        <span className="flex-1" />
        {canManage && env.branch && (rolledBack || (headNotDeployed && env.branchPipeline?.status !== 'running')) && (
          <button
            type="button"
            onClick={() => onRedeploy(env)}
            disabled={Boolean(awaiting)}
            title={awaiting ? `Waiting on request: ${awaiting.summary}` : undefined}
            className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md border border-slate-300 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {awaiting ? <Clock size={12} aria-hidden /> : <RotateCcw size={12} aria-hidden />} {awaiting ? awaitingLabel : 'Redeploy head'}
          </button>
        )}
        {canManage && (env.sync !== 'Synced' || drift || syncing) && (
          <button
            type="button"
            onClick={() => onSync(env)}
            disabled={syncing || Boolean(awaiting)}
            title={awaiting ? `Waiting on request: ${awaiting.summary}` : undefined}
            className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {awaiting && !syncing ? (
              <>
                <Clock size={12} aria-hidden /> {awaitingLabel}
              </>
            ) : (
              <>
                <RotateCw size={12} className={syncing ? 'animate-spin' : ''} aria-hidden /> {syncing ? 'Syncing' : 'Sync'}
              </>
            )}
          </button>
        )}
      </footer>
    </article>
  );
};
