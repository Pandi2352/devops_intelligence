import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, GitBranch, Layers, Loader2, RefreshCw, Rocket } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Button } from '../components/common/Button';
import { Dropdown } from '../components/common/Dropdown';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { EmptyState } from '../components/common/EmptyState';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { EnvironmentCard } from '../components/environments/EnvironmentCard';
import { PromotionPath } from '../components/environments/PromotionPath';
import { DeployHistoryModal } from '../components/environments/DeployHistoryModal';
import { EnvironmentDetailsModal } from '../components/environments/EnvironmentDetailsModal';
import api, { getApiErrorMessage } from '../api/client';
import { argoApi } from '../api/argoApi';
import { environmentApi, EnvironmentView, ProjectEnvironments, PromotionView } from '../api/environmentApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface ProjectOption {
  _id: string;
  name: string;
  argoApps: { appName: string }[];
}

const POLL_MS = 5000;

const isTransient = (data: ProjectEnvironments | null) =>
  Boolean(
    data &&
      (data.environments.some(
        (e) => e.operation?.phase === 'Running' || e.health === 'Progressing' || ['running', 'pending', 'created'].includes(e.branchPipeline?.status || '')
      ) ||
        data.promotions.some((p) => p.state === 'publishing' || p.state === 'syncing'))
  );

type PendingAction =
  | { kind: 'promote'; promotion: PromotionView }
  | { kind: 'sync'; env: EnvironmentView }
  | { kind: 'redeploy'; env: EnvironmentView }
  | null;

// Title, button label and explanation for each confirmable action.
const describeAction = (pending: PendingAction): { title: string; label: string; message: React.ReactNode } => {
  if (!pending) return { title: '', label: '', message: null };
  if (pending.kind === 'sync') {
    const env = pending.env;
    return {
      title: `Sync ${env.key}?`,
      label: `Sync ${env.key}`,
      message: (
        <>
          ArgoCD re-reads the GitOps repo and applies it to <span className="font-mono">{env.namespace}</span>
          {env.desired && (
            <>
              , deploying <span className="block font-mono text-xs my-1 break-all">{env.desired.tag}</span>
            </>
          )}
          {!env.autoSync && ' This is the approval step for this environment.'}
        </>
      ),
    };
  }
  if (pending.kind === 'redeploy') {
    const env = pending.env;
    return {
      title: `Redeploy ${env.branch} to ${env.key}?`,
      label: 'Run pipeline',
      message: (
        <>
          Runs the <span className="font-mono">{env.branch}</span> pipeline for its head{' '}
          <span className="font-mono">{env.branchHead?.sha}</span>. It builds a new {env.key} image and publishes it, replacing the rolled-back
          version{env.autoSync ? '' : ' once you sync'}.
        </>
      ),
    };
  }
  const p = pending.promotion;
  const commits = (
    <ul className="my-2 space-y-0.5 text-xs">
      {(p.commits || []).map((c) => (
        <li key={c.shortId}>
          <span className="font-mono text-indigo-700">{c.shortId}</span> {c.title}
        </li>
      ))}
    </ul>
  );
  if (p.mode === 'branch' && p.state === 'review') {
    return {
      title: `Merge !${p.mergeRequest?.iid} into ${p.toBranch}?`,
      label: `Merge into ${p.toBranch}`,
      message: (
        <>
          Fast-forwards <span className="font-mono">{p.toBranch}</span> to:
          {commits}
          The <span className="font-mono">{p.toBranch}</span> pipeline then builds the {p.to} image and deploys it.
        </>
      ),
    };
  }
  if (p.mode === 'branch' && p.aheadBy === undefined) {
    return {
      title: `Create the ${p.toBranch} branch?`,
      label: `Create ${p.toBranch}`,
      message: (
        <>
          Creates <span className="font-mono">{p.toBranch}</span> from <span className="font-mono">{p.fromBranch}</span>. Its first pipeline builds
          and deploys {p.to}.
        </>
      ),
    };
  }
  if (p.mode === 'branch') {
    return {
      title: `Open a merge request ${p.fromBranch} → ${p.toBranch}?`,
      label: 'Open merge request',
      message: (
        <>
          Opens a merge request with {p.aheadBy} commit(s):
          {commits}
          Nothing is deployed until it is merged.
        </>
      ),
    };
  }
  return {
    title: `Publish to ${p.to}?`,
    label: `Publish to ${p.to}`,
    message: (
      <>
        Runs <span className="font-mono">{p.job?.name}</span> in pipeline #{p.pipelineId}, committing
        <span className="block font-mono text-xs my-1 break-all">{p.fromTag}</span>
        to the {p.to} overlay. Nothing changes in the cluster until {p.to} is synced.
      </>
    ),
  };
};

export const EnvironmentsPage: React.FC = () => {
  const { levelOn } = useAuth();
  const toast = useToast();
  // Build-and-deploy on an environment allows sync, redeploy, rollback and promoting into it.
  const canDeployTo = (env: string) => (data ? levelOn(data.project.name, env) >= 2 : false);
  const [searchParams, setSearchParams] = useSearchParams();

  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [data, setData] = useState<ProjectEnvironments | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [isActing, setIsActing] = useState(false);
  const [historyFor, setHistoryFor] = useState<EnvironmentView | null>(null);
  const [detailsFor, setDetailsFor] = useState<EnvironmentView | null>(null);

  const withApps = useMemo(() => (projects || []).filter((p) => p.argoApps?.length > 0), [projects]);
  const projectId = searchParams.get('project') || withApps[0]?._id || '';

  useEffect(() => {
    api
      .get('/projects')
      .then((res) => setProjects(res.data.projects || []))
      .catch((err) => {
        setProjects([]);
        setError(getApiErrorMessage(err, 'Could not load projects'));
      });
  }, []);

  const load = useCallback(
    async (quiet = false) => {
      if (!projectId) return;
      if (!quiet) setIsLoading(true);
      try {
        setData(await environmentApi.get(projectId));
        setError(null);
      } catch (err) {
        setError(getApiErrorMessage(err, 'Could not load environments'));
      } finally {
        if (!quiet) setIsLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const transient = isTransient(data);
  useEffect(() => {
    if (!transient) return;
    const timer = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(timer);
  }, [transient, load]);

  const confirmAction = async () => {
    if (!pending || !data) return;
    setIsActing(true);
    try {
      let message: string;
      if (pending.kind === 'promote') {
        message = (await environmentApi.promote(data.project._id, pending.promotion.from, pending.promotion.to)).message;
      } else if (pending.kind === 'redeploy') {
        message = (await environmentApi.redeploy(data.project._id, pending.env.key)).message;
      } else {
        message = (await argoApi.syncApp(pending.env.appName)).message;
      }
      toast.success(message);
      setPending(null);
      await load(true);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Action failed'));
    } finally {
      setIsActing(false);
    }
  };

  const action = describeAction(pending);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Environments"
        description="What runs in each environment, where it came from, and how changes move towards production."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {data && (
              <span className="hidden md:inline-flex items-center gap-1 px-2 h-8 rounded-md border border-slate-200 bg-white text-[11px] text-slate-600">
                {data.flow === 'branch' ? <GitBranch size={12} aria-hidden /> : <Rocket size={12} aria-hidden />}
                {data.flow === 'branch' ? 'Branch per environment' : 'Promote by publish job'}
              </span>
            )}
            {withApps.length > 0 && (
              <Dropdown<string>
                ariaLabel="Project"
                value={projectId}
                onChange={(id) => setSearchParams({ project: id })}
                placeholder="Pick a project"
                searchPlaceholder="Search projects"
                options={withApps.map((p) => ({ value: p._id, label: p.name, sublabel: `${p.argoApps.length} environment(s)` }))}
                align="right"
                buttonClassName="min-w-[180px]"
              />
            )}
            <Button variant="secondary" size="sm" className="h-8" onClick={() => load()} isLoading={isLoading} leftIcon={<RefreshCw size={13} />}>
              Refresh
            </Button>
          </div>
        }
      />

      {error && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
          {error}
        </div>
      )}

      {projects === null ? (
        <LoadingSpinner message="Loading projects…" />
      ) : withApps.length === 0 ? (
        <EmptyState
          icon={<Layers size={24} />}
          title="No project has environments yet"
          description="Map ArgoCD apps (one per environment, e.g. my-app-dev and my-app-prod) on a project to see its environments here."
          action={
            <Link to="/projects" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-sky-600 text-white text-xs font-semibold">
              Open projects <ArrowRight size={13} />
            </Link>
          }
        />
      ) : !data ? (
        <LoadingSpinner message="Reading ArgoCD, GitLab and the cluster…" />
      ) : (
        <>
          {data.errors.length > 0 && (
            <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-0.5" role="alert">
              {data.errors.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          )}

          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {data.environments.map((env) => (
              <EnvironmentCard
                key={env.appName}
                env={env}
                canManage={canDeployTo(env.key)}
                onSync={(e) => setPending({ kind: 'sync', env: e })}
                onRedeploy={(e) => setPending({ kind: 'redeploy', env: e })}
                onHistory={setHistoryFor}
                onDetails={setDetailsFor}
              />
            ))}
          </div>

          <PromotionPath
            environments={data.environments}
            promotions={data.promotions}
            canPromoteTo={canDeployTo}
            onAction={(p) => setPending({ kind: 'promote', promotion: p })}
            onSync={(e) => setPending({ kind: 'sync', env: e })}
          />

          {transient && (
            <p className="text-[11px] text-sky-700 flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" /> Updating every {POLL_MS / 1000}s while a pipeline or deploy is running
            </p>
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={Boolean(pending)}
        title={action.title}
        message={action.message}
        confirmLabel={action.label}
        tone="primary"
        isLoading={isActing}
        onConfirm={confirmAction}
        onCancel={() => !isActing && setPending(null)}
      />

      {historyFor && data && (
        <DeployHistoryModal
          projectId={data.project._id}
          env={historyFor}
          canManage={canDeployTo(historyFor.key)}
          onClose={() => setHistoryFor(null)}
          onRolledBack={(message) => {
            setHistoryFor(null);
            toast.success(message);
            load(true);
          }}
        />
      )}

      {detailsFor && data && <EnvironmentDetailsModal projectId={data.project._id} env={detailsFor} onClose={() => setDetailsFor(null)} />}
    </div>
  );
};
