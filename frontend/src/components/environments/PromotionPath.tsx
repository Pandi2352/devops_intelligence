import React from 'react';
import { ArrowRight, ExternalLink, GitBranch, GitMerge, GitPullRequest, Loader2, Rocket, RotateCw } from 'lucide-react';
import { EnvironmentView, PromotionState, PromotionView } from '../../api/environmentApi';

const STATE: Record<PromotionState, { label: string; pill: string }> = {
  'up-to-date': { label: 'Up to date', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  ready: { label: 'Ready to promote', pill: 'bg-sky-50 text-sky-700 border-sky-200' },
  review: { label: 'Awaiting merge', pill: 'bg-sky-50 text-sky-700 border-sky-200' },
  blocked: { label: 'Blocked', pill: 'bg-amber-50 text-amber-800 border-amber-200' },
  diverged: { label: 'Diverged', pill: 'bg-rose-50 text-rose-700 border-rose-200' },
  publishing: { label: 'Building', pill: 'bg-sky-50 text-sky-700 border-sky-200' },
  syncing: { label: 'Deploying', pill: 'bg-sky-50 text-sky-700 border-sky-200' },
  'needs-sync': { label: 'Needs approval', pill: 'bg-violet-50 text-violet-700 border-violet-200' },
  failed: { label: 'Failed', pill: 'bg-rose-50 text-rose-700 border-rose-200' },
  'rolled-back': { label: 'Rolled back', pill: 'bg-amber-50 text-amber-800 border-amber-200' },
  unavailable: { label: 'Not available', pill: 'bg-slate-100 text-slate-600 border-slate-200' },
};

interface PromotionTileProps {
  promotion: PromotionView;
  target?: EnvironmentView;
  canManage: boolean;
  onAction: (p: PromotionView) => void;
  onSync: (env: EnvironmentView) => void;
}

const actionFor = (p: PromotionView): { label: string; icon: React.ReactNode } | null => {
  if (p.mode === 'branch') {
    if (p.state === 'ready') {
      return p.aheadBy === undefined
        ? { label: `Create ${p.toBranch} branch`, icon: <GitBranch size={13} aria-hidden /> }
        : { label: 'Open merge request', icon: <GitPullRequest size={13} aria-hidden /> };
    }
    if (p.state === 'review') return { label: `Merge !${p.mergeRequest?.iid}`, icon: <GitMerge size={13} aria-hidden /> };
    return null;
  }
  if (p.state === 'ready') return { label: `Publish to ${p.to}`, icon: <Rocket size={13} aria-hidden /> };
  if (p.state === 'failed') return { label: 'Retry publish', icon: <RotateCw size={13} aria-hidden /> };
  return null;
};

const PromotionTile: React.FC<PromotionTileProps> = ({ promotion, target, canManage, onAction, onSync }) => {
  const meta = STATE[promotion.state];
  const action = actionFor(promotion);
  const busy = promotion.state === 'publishing' || promotion.state === 'syncing';
  const showCommits = promotion.commits && promotion.commits.length > 0 && ['ready', 'review', 'blocked', 'diverged'].includes(promotion.state);

  return (
    <div className="bg-white border border-slate-200 rounded-md p-3 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900 uppercase tracking-wide">
          {promotion.from} <ArrowRight size={13} className="text-slate-400" aria-hidden /> {promotion.to}
        </span>
        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold whitespace-nowrap ${meta.pill}`}>
          {busy && <Loader2 size={10} className="inline animate-spin mr-1 -mt-px" aria-hidden />}
          {meta.label}
        </span>
      </div>

      <p className="text-[11px] leading-snug text-slate-600">{promotion.message}</p>

      {showCommits && (
        <ul className="space-y-0.5" aria-label="Commits to promote">
          {promotion.commits!.slice(0, 3).map((c) => (
            <li key={c.shortId} className="text-[11px] text-slate-700 truncate" title={`${c.title} (${c.author})`}>
              <span className="font-mono text-indigo-700">{c.shortId}</span> {c.title}
            </li>
          ))}
          {(promotion.aheadBy || 0) > 3 && <li className="text-[10px] text-slate-500">+{(promotion.aheadBy || 0) - 3} more</li>}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2 mt-auto pt-1">
        <span className="min-w-0">
          {promotion.mergeRequest && (
            <a href={promotion.mergeRequest.webUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-sky-700 hover:underline">
              !{promotion.mergeRequest.iid} <ExternalLink size={10} aria-hidden />
            </a>
          )}
          {promotion.job && (promotion.state === 'publishing' || promotion.state === 'failed') && (
            <a href={promotion.job.webUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-sky-700 hover:underline">
              job log <ExternalLink size={10} aria-hidden />
            </a>
          )}
        </span>
        {canManage && action && (
          <button
            type="button"
            onClick={() => onAction(promotion)}
            className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-semibold cursor-pointer whitespace-nowrap"
          >
            {action.icon} {action.label}
          </button>
        )}
        {canManage && promotion.state === 'needs-sync' && target && (
          <button
            type="button"
            onClick={() => onSync(target)}
            className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold cursor-pointer whitespace-nowrap"
          >
            <RotateCw size={13} aria-hidden /> Sync {promotion.to}
          </button>
        )}
      </div>
    </div>
  );
};

interface PromotionPathProps {
  environments: EnvironmentView[];
  promotions: PromotionView[];
  canPromoteTo: (env: string) => boolean;
  onAction: (p: PromotionView) => void;
  onSync: (env: EnvironmentView) => void;
}

export const PromotionPath: React.FC<PromotionPathProps> = ({ environments, promotions, canPromoteTo, onAction, onSync }) => {
  if (promotions.length === 0) return null;
  return (
    <section aria-labelledby="promotion-path-title" className="space-y-2">
      <h2 id="promotion-path-title" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        Promotion path · {environments.map((e) => e.key).join(' → ')}
      </h2>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {promotions.map((p) => (
          <PromotionTile
            key={`${p.from}-${p.to}`}
            promotion={p}
            target={environments.find((e) => e.key === p.to)}
            canManage={canPromoteTo(p.to)}
            onAction={onAction}
            onSync={onSync}
          />
        ))}
      </div>
    </section>
  );
};
