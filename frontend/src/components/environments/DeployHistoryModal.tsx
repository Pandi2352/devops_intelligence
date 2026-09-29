import React, { useEffect, useState } from 'react';
import { ExternalLink, History, Loader2, Undo2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { environmentApi, DeployHistoryEntry, EnvironmentView } from '../../api/environmentApi';
import { getApiErrorMessage } from '../../api/client';
import { formatDateTime, formatRelativeTime } from '../../utils/format';

interface DeployHistoryModalProps {
  projectId: string;
  env: EnvironmentView;
  canManage: boolean;
  onClose: () => void;
  onRolledBack: (message: string) => void;
}

const KIND_STYLE: Record<DeployHistoryEntry['kind'], string> = {
  deploy: 'bg-sky-50 text-sky-700 border-sky-200',
  rollback: 'bg-amber-50 text-amber-800 border-amber-200',
  other: 'bg-slate-100 text-slate-600 border-slate-200',
};

// The GitOps commits that changed this environment, newest first, with rollback to any earlier deploy.
export const DeployHistoryModal: React.FC<DeployHistoryModalProps> = ({ projectId, env, canManage, onClose, onRolledBack }) => {
  const [entries, setEntries] = useState<DeployHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<DeployHistoryEntry | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  useEffect(() => {
    environmentApi
      .history(projectId, env.key)
      .then(setEntries)
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load the deploy history')));
  }, [projectId, env.key]);

  const confirmRollback = async () => {
    if (!target) return;
    setIsRollingBack(true);
    setRollbackError(null);
    try {
      const res = await environmentApi.rollback(projectId, env.key, target.id);
      setTarget(null);
      onRolledBack(res.message);
    } catch (err) {
      setRollbackError(getApiErrorMessage(err, 'Rollback failed'));
    } finally {
      setIsRollingBack(false);
    }
  };

  const currentTag = env.desired?.tag;

  return (
    <>
      <Modal
        isOpen
        onClose={onClose}
        maxWidth="lg"
        title={`${env.key.toUpperCase()} deploy history`}
        subtitle={`Every change to ${env.gitopsPath}/kustomization.yaml in the GitOps repo. Roll back by re-deploying an earlier image.`}
        icon={
          <div className="w-9 h-9 rounded-md bg-slate-100 text-slate-600 flex items-center justify-center">
            <History size={18} />
          </div>
        }
      >
        {error ? (
          <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs">{error}</div>
        ) : !entries ? (
          <div className="flex items-center gap-2 py-6 justify-center text-xs text-slate-500">
            <Loader2 size={14} className="animate-spin" /> Loading history…
          </div>
        ) : (
          <ol className="relative border-l border-slate-200 ml-2 space-y-3">
            {entries.map((e) => {
              const isCurrent = Boolean(e.tag && e.tag === currentTag);
              const canRollBack = canManage && e.kind !== 'other' && e.tag && !isCurrent;
              return (
                <li key={e.id} className="ml-4">
                  <span
                    className={`absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                      e.isLive ? 'bg-emerald-500' : e.kind === 'rollback' ? 'bg-amber-500' : 'bg-slate-300'
                    }`}
                    aria-hidden
                  />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase ${KIND_STYLE[e.kind]}`}>{e.kind}</span>
                        {e.isLive && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-600 text-white">Running</span>}
                        {isCurrent && !e.isLive && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-600 text-white">In Git</span>}
                        <span className="text-[11px] text-slate-500" title={formatDateTime(e.date)}>
                          {formatRelativeTime(e.date)} · {e.author}
                        </span>
                      </div>
                      {e.appCommit ? (
                        <p className="text-xs text-slate-900">
                          <span className="font-mono text-indigo-700">{e.appCommit.sha}</span> {e.appCommit.title}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-700 truncate" title={e.title}>
                          {e.title}
                        </p>
                      )}
                      {e.tag && (
                        <p className="font-mono text-[10px] text-slate-500 truncate" title={e.tag}>
                          {e.tag}
                        </p>
                      )}
                      <a href={e.webUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-sky-700">
                        GitOps {e.sha} <ExternalLink size={9} aria-hidden />
                      </a>
                    </div>
                    {canRollBack && (
                      <button
                        type="button"
                        onClick={() => {
                          setRollbackError(null);
                          setTarget(e);
                        }}
                        className="shrink-0 h-7 px-2.5 inline-flex items-center gap-1 rounded-md border border-slate-300 text-[11px] font-semibold text-slate-700 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-900 cursor-pointer"
                      >
                        <Undo2 size={12} aria-hidden /> Roll back here
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(target)}
        title={`Roll back ${env.key}?`}
        tone="danger"
        confirmLabel="Roll back"
        isLoading={isRollingBack}
        error={rollbackError}
        onCancel={() => !isRollingBack && setTarget(null)}
        onConfirm={confirmRollback}
        message={
          target && (
            <>
              Commits image <span className="block font-mono text-xs my-1 break-all">{target.tag}</span>
              {target.appCommit && (
                <>
                  (<span className="font-mono">{target.appCommit.sha}</span> {target.appCommit.title}){' '}
                </>
              )}
              back into the {env.key} overlay and syncs ArgoCD right away. The {env.branch || 'source'} branch is not changed:
              fix forward and promote again, or use <em>Redeploy head</em>.
            </>
          )
        }
      />
    </>
  );
};
