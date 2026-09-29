import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  Loader2,
  Play,
  RefreshCw,
  Rocket,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../common/Button';
import { Dropdown } from '../common/Dropdown';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Pagination } from '../common/Pagination';
import { usePagination } from '../../hooks/usePagination';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage } from '../../api/client';
import { BranchComparison, MergeRequestInfo, MergeResult, PipelineRef, gitApi } from '../../api/gitApi';
import { GitBranchInfo, GitRepo } from '../../types';
import { formatRelativeTime } from '../../utils/format';
import { ApprovalRequestedBanner, ReasonField } from '../environments/ApprovalNotice';

interface MergePanelProps {
  integrationId: string;
  repo: GitRepo;
  branches: GitBranchInfo[];
  canManage: boolean;
  onPipelinesChanged: () => void;
  onShowPipelines: () => void;
}

const RUNNING = ['running', 'pending', 'created', 'waiting_for_resource', 'preparing', 'scheduled'];

const PipelinePill: React.FC<{ pipeline: PipelineRef | null | undefined }> = ({ pipeline }) => {
  if (!pipeline) return <span className="text-[11px] text-slate-500">no pipeline yet</span>;
  const tone =
    pipeline.status === 'success'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : pipeline.status === 'failed'
        ? 'bg-rose-50 text-rose-700 border-rose-200'
        : RUNNING.includes(pipeline.status)
          ? 'bg-sky-50 text-sky-800 border-sky-200'
          : 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <a href={pipeline.webUrl} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-semibold ${tone}`}>
      {RUNNING.includes(pipeline.status) && <Loader2 size={11} className="animate-spin" />}#{pipeline.id} {pipeline.status}
      <span className="font-normal font-mono">· {pipeline.sha}</span>
    </a>
  );
};

const MR_STATUS: Record<string, { label: string; tone: string }> = {
  mergeable: { label: 'ready to merge', tone: 'text-emerald-700' },
  conflict: { label: 'conflicts', tone: 'text-rose-700' },
  broken_status: { label: 'conflicts', tone: 'text-rose-700' },
  need_rebase: { label: 'needs rebase', tone: 'text-amber-700' },
  ci_must_pass: { label: 'waiting for pipeline', tone: 'text-amber-700' },
  ci_still_running: { label: 'pipeline running', tone: 'text-sky-700' },
  checking: { label: 'checking…', tone: 'text-slate-500' },
  unchecked: { label: 'checking…', tone: 'text-slate-500' },
  not_approved: { label: 'needs approval', tone: 'text-amber-700' },
  draft_status: { label: 'draft', tone: 'text-slate-500' },
};

export const MergePanel: React.FC<MergePanelProps> = ({ integrationId, repo, branches, canManage, onPipelinesChanged, onShowPipelines }) => {
  const toast = useToast();
  const repoId = repo.id || repo.name;
  const defaultBranch = repo.defaultBranch || branches.find((b) => b.default)?.name || '';
  const [source, setSource] = useState(() => branches.find((b) => !b.default)?.name || defaultBranch);
  const [target, setTarget] = useState(defaultBranch);
  const [compare, setCompare] = useState<BranchComparison | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [showCommits, setShowCommits] = useState(false);
  const [title, setTitle] = useState('');
  const [squash, setSquash] = useState(false);
  const [removeSource, setRemoveSource] = useState(false);
  const [whenPipelineSucceeds, setWhenPipelineSucceeds] = useState(false);
  const [busy, setBusy] = useState<'open' | 'merge' | 'run' | null>(null);
  const [confirm, setConfirm] = useState<{ iid?: number; source: string; target: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [reason, setReason] = useState('');
  // A gated pipeline run went to the approvers instead of starting.
  const [runRequested, setRunRequested] = useState<string | null>(null);
  const [targetPipeline, setTargetPipeline] = useState<PipelineRef | null>(null);
  const [openMrs, setOpenMrs] = useState<MergeRequestInfo[]>([]);
  // The parent re-renders on its own refresh cycle; keep the latest callback without restarting timers.
  const changedRef = useRef(onPipelinesChanged);
  useEffect(() => {
    changedRef.current = onPipelinesChanged;
  });

  const branchOptions = branches.map((b) => ({ value: b.name, label: b.name, sublabel: [b.default && 'default', b.protected && 'protected', b.commit?.title].filter(Boolean).join(' · ') }));
  const sourceBranch = branches.find((b) => b.name === source);
  const pairKey = `${source}->${target}`;
  const commitPage = usePagination(compare?.commits || [], 10, pairKey);
  const filePage = usePagination(compare?.files || [], 10, pairKey);
  const mrPage = usePagination(openMrs, 5);

  const loadCompare = useCallback(async () => {
    if (!source || !target || source === target) {
      setCompare(null);
      return;
    }
    setComparing(true);
    setCompareError(null);
    try {
      const c = await gitApi.compareBranches(integrationId, repoId, source, target);
      setCompare(c);
      setTargetPipeline(c.targetPipeline);
    } catch (err) {
      setCompare(null);
      setCompareError(getApiErrorMessage(err, 'Could not compare the branches'));
    } finally {
      setComparing(false);
    }
  }, [integrationId, repoId, source, target]);

  const loadMrs = useCallback(async () => {
    try {
      setOpenMrs(await gitApi.listMergeRequests(integrationId, repoId, 'opened'));
    } catch {
      setOpenMrs([]);
    }
  }, [integrationId, repoId]);

  useEffect(() => {
    loadCompare();
  }, [loadCompare]);

  useEffect(() => {
    loadMrs();
  }, [loadMrs]);

  // Follow the target branch pipeline until it finishes.
  useEffect(() => {
    if (!targetPipeline || !RUNNING.includes(targetPipeline.status)) return;
    const t = setInterval(async () => {
      try {
        const p = await gitApi.branchPipeline(integrationId, repoId, targetPipeline.ref);
        if (p) setTargetPipeline(p);
        if (p && !RUNNING.includes(p.status)) changedRef.current();
      } catch {
        /* keep the last known state */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [targetPipeline, integrationId, repoId]);

  const swap = () => {
    setSource(target);
    setTarget(source);
    setResult(null);
  };

  const openMr = async () => {
    setBusy('open');
    setActionError(null);
    try {
      const r = await gitApi.createMergeRequest(integrationId, repoId, { source, target, title: title.trim() || undefined, squash, removeSourceBranch: removeSource });
      toast.success(r.message);
      await Promise.all([loadCompare(), loadMrs()]);
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Could not open the merge request'));
    } finally {
      setBusy(null);
    }
  };

  // Merge now: reuse the open merge request for this pair, or open one first.
  const merge = async () => {
    if (!confirm) return;
    setBusy('merge');
    setActionError(null);
    try {
      let iid = confirm.iid;
      if (!iid) {
        iid = (await gitApi.createMergeRequest(integrationId, repoId, { source: confirm.source, target: confirm.target, title: title.trim() || undefined, squash, removeSourceBranch: removeSource }))
          .mergeRequest.iid;
      }
      const r = await gitApi.mergeMergeRequest(integrationId, repoId, iid, { squash, removeSourceBranch: removeSource, whenPipelineSucceeds, reason: reason.trim() || undefined });
      setResult(r);
      setTargetPipeline(r.targetPipeline || null);
      if (r.approvalRequired) toast.info(r.message || 'Merge requested: waiting for approval');
      else toast.success(r.message);
      setConfirm(null);
      setReason('');
      changedRef.current();
      await Promise.all([loadCompare(), loadMrs()]);
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Merge failed'));
      await loadMrs();
    } finally {
      setBusy(null);
    }
  };

  const runPipeline = async (ref: string) => {
    setBusy('run');
    try {
      const r = await gitApi.triggerPipeline(integrationId, repoId, ref);
      if (r.approvalRequired) {
        toast.info(r.message);
        setRunRequested(r.message);
        return;
      }
      toast.success(r.message);
      const p = await gitApi.branchPipeline(integrationId, repoId, ref);
      setTargetPipeline(p);
      changedRef.current();
    } catch (err) {
      toast.error(getApiErrorMessage(err, `Could not run the pipeline on ${ref}`));
    } finally {
      setBusy(null);
    }
  };

  const mrAction = async (mr: MergeRequestInfo, action: 'rebase' | 'close') => {
    try {
      const r = action === 'rebase' ? await gitApi.rebaseMergeRequest(integrationId, repoId, mr.iid) : await gitApi.closeMergeRequest(integrationId, repoId, mr.iid);
      toast.success(r.message);
      await loadMrs();
    } catch (err) {
      toast.error(getApiErrorMessage(err, `Could not ${action} !${mr.iid}`));
    }
  };

  const nothingToMerge = compare && compare.ahead === 0;
  const existing = compare?.openMergeRequest;

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex items-center gap-2">
          <GitMerge size={16} className="text-purple-600" />
          <h3 className="text-sm font-semibold text-slate-900">Merge branches</h3>
          <span className="text-[11px] text-slate-500">through a GitLab merge request, so the history and review stay in GitLab</span>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">From (source)</label>
            <Dropdown fullWidth mono searchable placeholder="Select the branch to merge from" searchPlaceholder="Filter branches, e.g. feature/" ariaLabel="Source branch" value={source} onChange={(v) => { setSource(v); setResult(null); }} options={branchOptions} menuMinWidth={280} />
          </div>
          <button type="button" onClick={swap} className="h-9 px-2 rounded-md border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50" aria-label="Swap source and target" title="Swap">
            <ArrowLeftRight size={15} />
          </button>
          <div className="min-w-[200px] flex-1">
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Into (target)</label>
            <Dropdown fullWidth mono searchable placeholder="Select the branch to merge into" searchPlaceholder="Filter branches, e.g. qa" ariaLabel="Target branch" value={target} onChange={(v) => { setTarget(v); setResult(null); }} options={branchOptions} menuMinWidth={280} />
          </div>
          <Button variant="secondary" onClick={loadCompare} disabled={comparing} aria-label="Refresh comparison" className="h-9">
            <RefreshCw size={14} className={comparing ? 'animate-spin' : ''} />
          </Button>
        </div>

        {source === target ? (
          <p className="text-xs text-slate-500">Pick two different branches.</p>
        ) : compareError ? (
          <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2" role="alert">
            <AlertTriangle size={14} /> {compareError}
          </div>
        ) : !compare ? (
          <p className="text-xs text-slate-500">{comparing ? 'Comparing…' : ''}</p>
        ) : (
          <div className="space-y-3">
            <div className={`rounded-md border p-3 text-xs ${nothingToMerge ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-purple-200 bg-purple-50/50 text-slate-800'}`}>
              {nothingToMerge ? (
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-emerald-600" />
                  Nothing to merge: <span className="font-mono">{target}</span> already contains everything in <span className="font-mono">{source}</span>.
                </span>
              ) : (
                <div className="space-y-1">
                  <div>
                    <strong>{compare.ahead}</strong> commit{compare.ahead === 1 ? '' : 's'} and <strong>{compare.filesChanged}</strong> changed file{compare.filesChanged === 1 ? '' : 's'} go from{' '}
                    <span className="font-mono">{source}</span> <ArrowRight size={11} className="inline" /> <span className="font-mono">{target}</span>.
                  </div>
                  <div className="text-slate-600">
                    {compare.fastForward
                      ? `${target} has nothing new, so this can be a clean fast-forward.`
                      : `${target} also has ${compare.behind} commit${compare.behind === 1 ? '' : 's'} that ${source} does not: a merge commit is created (or rebase first).`}
                  </div>
                </div>
              )}
            </div>

            {compare.deploysTo && !nothingToMerge && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
                <Rocket size={14} className="shrink-0 mt-0.5" />
                <span>
                  <span className="font-mono">{target}</span> is the <strong>{compare.deploysTo.environment}</strong> environment of project{' '}
                  <Link to={`/projects/${compare.deploysTo.projectId}`} className="underline font-semibold">
                    {compare.deploysTo.project}
                  </Link>
                  : merging starts its pipeline, which builds and deploys to <span className="font-mono">{compare.deploysTo.namespace}</span>. For environment promotion you can also use{' '}
                  <Link to={`/environments?project=${compare.deploysTo.projectId}`} className="underline">
                    Environments
                  </Link>
                  .
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">Pipeline on <span className="font-mono">{target}</span>:</span>
              <PipelinePill pipeline={targetPipeline} />
              {canManage && (
                <Button size="sm" variant="secondary" leftIcon={<Play size={11} />} onClick={() => runPipeline(target)} isLoading={busy === 'run'} disabled={Boolean(busy)}>
                  Run pipeline on {target}
                </Button>
              )}
              <button type="button" onClick={onShowPipelines} className="text-sky-700 hover:underline">
                All pipelines
              </button>
              {compare.targetProtected && <span className="text-slate-500">· {target} is protected (merge requests only)</span>}
            </div>

            {!nothingToMerge && compare.commits.length > 0 && (
              <div>
                <button type="button" onClick={() => setShowCommits((s) => !s)} className="text-xs font-semibold text-slate-700 inline-flex items-center gap-1" aria-expanded={showCommits}>
                  {showCommits ? <ChevronDown size={13} /> : <ChevronRight size={13} />} What will be merged ({compare.commits.length} commits, {compare.files.length} files)
                </button>
                {showCommits && (
                  <div className="grid md:grid-cols-2 gap-3 mt-2">
                    <div className="space-y-1.5">
                    <ul className="rounded-md border border-slate-200 divide-y divide-slate-100 max-h-56 overflow-auto">
                      {commitPage.pageItems.map((c) => (
                        <li key={c.sha} className="px-2.5 py-1.5 text-[11px]">
                          <a href={c.webUrl} target="_blank" rel="noreferrer" className="font-mono text-sky-700 hover:underline mr-1.5">
                            {c.shortId}
                          </a>
                          <span className="text-slate-800">{c.title}</span>
                          <div className="text-slate-400">
                            {c.author} · {formatRelativeTime(c.date)}
                          </div>
                        </li>
                      ))}
                    </ul>
                    {commitPage.totalPages > 1 && (
                      <Pagination compact page={commitPage.page} pageSize={commitPage.pageSize} total={commitPage.total} onPageChange={commitPage.setPage} itemLabel="commits" />
                    )}
                    </div>
                    <div className="space-y-1.5">
                    <ul className="rounded-md border border-slate-200 divide-y divide-slate-100 max-h-56 overflow-auto">
                      {filePage.pageItems.map((f) => (
                        <li key={f.path} className="px-2.5 py-1.5 text-[11px] font-mono flex gap-2">
                          <span className={`w-14 shrink-0 font-sans font-semibold ${f.status === 'added' ? 'text-emerald-700' : f.status === 'deleted' ? 'text-rose-700' : 'text-slate-500'}`}>{f.status}</span>
                          <span className="truncate text-slate-800">{f.path}</span>
                        </li>
                      ))}
                    </ul>
                    {filePage.totalPages > 1 && (
                      <Pagination compact page={filePage.page} pageSize={filePage.pageSize} total={filePage.total} onPageChange={filePage.setPage} itemLabel="files" />
                    )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!nothingToMerge && canManage && (
              <div className="space-y-3 pt-3 border-t border-slate-100">
                {existing ? (
                  <div className="text-xs text-slate-700">
                    Merge request{' '}
                    <a href={existing.webUrl} target="_blank" rel="noreferrer" className="font-semibold text-sky-700 hover:underline">
                      !{existing.iid}
                    </a>{' '}
                    is already open for these branches ({MR_STATUS[existing.status]?.label || existing.status}).
                  </div>
                ) : (
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1" htmlFor="mr-title">
                      Title
                    </label>
                    <input
                      id="mr-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={`Merge ${source} into ${target}`}
                      className="w-full h-9 px-3 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
                    />
                  </div>
                )}
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-700">
                  <label className="inline-flex items-center gap-1.5" title="Combine all commits into one on the target">
                    <input type="checkbox" checked={squash} onChange={(e) => setSquash(e.target.checked)} /> Squash commits
                  </label>
                  <label className={`inline-flex items-center gap-1.5 ${sourceBranch?.protected || sourceBranch?.default ? 'opacity-50' : ''}`} title="Delete the source branch after the merge">
                    <input type="checkbox" checked={removeSource} disabled={sourceBranch?.protected || sourceBranch?.default} onChange={(e) => setRemoveSource(e.target.checked)} /> Delete {source} after merge
                  </label>
                  <label className="inline-flex items-center gap-1.5" title="If the source pipeline is still running, GitLab merges once it succeeds">
                    <input type="checkbox" checked={whenPipelineSucceeds} onChange={(e) => setWhenPipelineSucceeds(e.target.checked)} /> Merge when pipeline succeeds
                  </label>
                </div>
                {actionError && (
                  <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2" role="alert">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {actionError}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button leftIcon={<GitMerge size={14} />} onClick={() => setConfirm({ iid: existing?.iid, source, target })} disabled={Boolean(busy)}>
                    Merge {source} into {target}
                  </Button>
                  {!existing && (
                    <Button variant="secondary" leftIcon={<GitPullRequest size={14} />} onClick={openMr} isLoading={busy === 'open'} disabled={Boolean(busy)}>
                      Only open merge request
                    </Button>
                  )}
                  <a href={compare.compareUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-sky-700 px-2">
                    <ExternalLink size={12} /> Compare in GitLab
                  </a>
                </div>
              </div>
            )}
            {!canManage && !nothingToMerge && <p className="text-[11px] text-slate-500">Merging needs a DevOps or Super Admin role.</p>}
          </div>
        )}

        {result?.approvalRequired && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1" role="status">
            <div className="flex items-center gap-1.5 font-semibold">
              <Clock size={14} /> Merge requested: waiting for approval
            </div>
            <p>
              {result.message}{' '}
              <Link to="/approvals" className="font-semibold underline">
                View request
              </Link>
            </p>
          </div>
        )}
        {runRequested && <ApprovalRequestedBanner message={runRequested} onDismiss={() => setRunRequested(null)} />}

        {result && !result.approvalRequired && result.mergeRequest && (
          <div className={`rounded-md border p-3 text-xs space-y-2 ${result.merged ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-sky-200 bg-sky-50 text-sky-900'}`}>
            <div className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 size={14} /> {result.message}
              {result.mergeRequest?.mergeCommitSha && <span className="font-mono font-normal">({result.mergeRequest.mergeCommitSha})</span>}
            </div>
            {result.merged && (
              <div className="flex flex-wrap items-center gap-2">
                <span>Pipeline on {result.mergeRequest?.target}:</span>
                {result.targetPipelineStarted ? (
                  <PipelinePill pipeline={targetPipeline} />
                ) : (
                  <span>no pipeline started automatically (the CI rules may not run for this branch).</span>
                )}
                {canManage && (
                  <Button size="sm" variant="secondary" leftIcon={<Play size={11} />} onClick={() => runPipeline(result.mergeRequest!.target)} isLoading={busy === 'run'} disabled={Boolean(busy)}>
                    Run pipeline
                  </Button>
                )}
                <button type="button" onClick={onShowPipelines} className="underline">
                  Follow it in Pipelines
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            <GitPullRequest size={15} className="text-purple-600" /> Open merge requests ({openMrs.length})
          </h3>
          <button type="button" onClick={loadMrs} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Refresh merge requests">
            <RefreshCw size={13} />
          </button>
        </header>
        {openMrs.length === 0 ? (
          <p className="px-4 py-4 text-xs text-slate-500">No open merge requests.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {mrPage.pageItems.map((mr) => {
              const st = MR_STATUS[mr.status] || { label: mr.status, tone: 'text-slate-500' };
              return (
                <li key={mr.iid} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <a href={mr.webUrl} target="_blank" rel="noreferrer" className="font-mono text-xs font-semibold text-sky-700 hover:underline">
                    !{mr.iid}
                  </a>
                  <span className="text-xs text-slate-800 min-w-0 truncate max-w-md">{mr.title}</span>
                  <span className="text-[11px] font-mono text-slate-500">
                    {mr.source} → {mr.target}
                  </span>
                  <span className={`text-[11px] font-semibold ${st.tone}`}>{st.label}</span>
                  <span className="text-[11px] text-slate-400">
                    {mr.author} · {formatRelativeTime(mr.createdAt)}
                  </span>
                  {canManage && (
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" leftIcon={<GitMerge size={12} />} onClick={() => setConfirm({ iid: mr.iid, source: mr.source, target: mr.target })} disabled={Boolean(busy)}>
                        Merge
                      </Button>
                      {mr.status === 'need_rebase' && (
                        <Button size="sm" variant="secondary" onClick={() => mrAction(mr, 'rebase')}>
                          Rebase
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => mrAction(mr, 'close')} aria-label={`Close !${mr.iid}`}>
                        <X size={13} />
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {mrPage.total > mrPage.pageSize && (
          <div className="px-4 py-2 border-t border-slate-100">
            <Pagination
              compact
              page={mrPage.page}
              pageSize={mrPage.pageSize}
              total={mrPage.total}
              onPageChange={mrPage.setPage}
              onPageSizeChange={mrPage.setPageSize}
              itemLabel="merge requests"
            />
          </div>
        )}
      </section>

      <ConfirmDialog
        isOpen={Boolean(confirm)}
        tone="primary"
        title={confirm?.iid ? `Merge !${confirm.iid}?` : `Merge ${confirm?.source} into ${confirm?.target}?`}
        message={
          <div className="space-y-2">
            <p>
              {confirm?.iid ? 'The open merge request' : 'A merge request is opened and'} merges <span className="font-mono">{confirm?.source}</span> into{' '}
              <span className="font-mono">{confirm?.target}</span>
              {squash ? ' as one squashed commit' : ''}
              {whenPipelineSucceeds ? ', as soon as its pipeline succeeds' : ''}.
            </p>
            {compare?.deploysTo && confirm?.target === compare.target && (
              <p className="text-amber-800">
                This deploys the <strong>{compare.deploysTo.environment}</strong> environment of {compare.deploysTo.project}.
              </p>
            )}
            <ReasonField id="merge-reason" value={reason} onChange={setReason} hint="If the target branch deploys an environment that needs approval, the merge goes to the approvers first." />
            {actionError && <p className="text-rose-700">{actionError}</p>}
          </div>
        }
        confirmLabel="Merge"
        isLoading={busy === 'merge'}
        onConfirm={merge}
        onCancel={() => {
          if (busy === 'merge') return;
          setConfirm(null);
          setActionError(null);
          setReason('');
        }}
      />
    </div>
  );
};
