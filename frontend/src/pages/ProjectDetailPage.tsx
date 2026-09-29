import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderGit2,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Server,
  Trash2,
  Wrench,
  ScrollText,
  LineChart,
  Boxes,
  FileCode2,
} from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Button } from '../components/common/Button';
import { Modal } from '../components/common/Modal';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ProjectFormModal } from '../components/projects/ProjectFormModal';
import { AddEnvironmentModal } from '../components/projects/AddEnvironmentModal';
import { ManifestsModal } from '../components/projects/ManifestsModal';
import { CheckList, CheckSummary, StepList } from '../components/projects/projectUi';
import { ActivityFeed, EnvironmentTile, PromoteHint, SetupStepper } from '../components/projects/EnvironmentPipeline';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getApiErrorMessage } from '../api/client';
import { EnvironmentSetup, Project, ProjectOverview, ProjectSetup, ProvisionResult, projectApi, projectOverviewApi } from '../api/projectApi';
import { repoLabel, repoWebUrl } from '../utils/project';

const InfoCard: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode }> = ({ icon, label, children }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-3 min-w-0">
    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
      {icon}
      {label}
    </div>
    <div className="text-sm font-mono text-slate-800 truncate">{children}</div>
  </div>
);

const RepoLink: React.FC<{ url?: string }> = ({ url }) =>
  url ? (
    <a href={repoWebUrl(url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-sky-700 hover:underline max-w-full">
      <span className="truncate">{repoLabel(url)}</span>
      <ExternalLink size={11} className="shrink-0" aria-hidden />
    </a>
  ) : (
    <span className="text-amber-700 font-sans text-xs">not set</span>
  );

export const ProjectDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { hasRole } = useAuth();
  const canManage = hasRole(['superadmin', 'devops']);

  const [project, setProject] = useState<Project | null>(null);
  const [setup, setSetup] = useState<ProjectSetup | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [provisioning, setProvisioning] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<{ title: string; result: ProvisionResult } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<EnvironmentSetup | null>(null);
  const [manifestsFor, setManifestsFor] = useState<string | null>(null);
  const [deleteNamespace, setDeleteNamespace] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [argoError, setArgoError] = useState<string | undefined>();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'setup' ? 'setup' : 'overview';
  const setTab = (t: 'overview' | 'setup') =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (t === 'setup') next.set('tab', 'setup');
        else next.delete('tab');
        return next;
      },
      { replace: true }
    );

  const loadOverview = useCallback(async () => {
    try {
      const r = await projectOverviewApi.get(id);
      setOverview(r.project);
      setArgoError(r.argoError);
    } catch {
      /* the page still works from the setup data */
    }
  }, [id]);

  const loadSetup = useCallback(async () => {
    setIsChecking(true);
    try {
      const next = await projectApi.setup(id);
      setSetup(next);
      // Open environments that need attention so the problem is visible straight away.
      setExpanded(new Set(next.environments.filter((e) => e.checks.some((c) => !c.ok)).map((e) => e.name)));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not check the environments'));
    } finally {
      setIsChecking(false);
    }
  }, [id]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setProject(await projectApi.get(id));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load the project'));
      setIsLoading(false);
      return;
    }
    setIsLoading(false);
    await Promise.all([loadOverview(), loadSetup()]);
  }, [id, loadSetup, loadOverview]);

  useEffect(() => {
    load();
  }, [load]);

  // Arriving from "New project" (?addEnv=1): open Add environment as soon as the project is ready for it.
  useEffect(() => {
    if (params.get('addEnv') !== '1' || !setup?.ready || !canManage) return;
    setAdding(true);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('addEnv');
        return next;
      },
      { replace: true }
    );
  }, [params, setup?.ready, canManage, setParams]);

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const handleProvision = async (env: EnvironmentSetup) => {
    setProvisioning(env.name);
    try {
      const result = await projectApi.provision(id, env.name);
      setRunResult({ title: `Provision ${env.name}`, result });
      await Promise.all([loadSetup(), loadOverview()]);
    } catch (err) {
      toast.error(getApiErrorMessage(err, `Could not provision ${env.name}`));
    } finally {
      setProvisioning(null);
    }
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    setIsRemoving(true);
    setRemoveError(null);
    try {
      const result = await projectApi.removeEnvironment(id, removeTarget.name, deleteNamespace);
      setRunResult({ title: `Remove ${removeTarget.name}`, result });
      setRemoveTarget(null);
      setProject(await projectApi.get(id));
      await Promise.all([loadSetup(), loadOverview()]);
    } catch (err) {
      setRemoveError(getApiErrorMessage(err, 'Could not remove the environment'));
    } finally {
      setIsRemoving(false);
    }
  };

  if (isLoading) return <LoadingSpinner />;
  if (!project)
    return (
      <div className="space-y-3">
        <Link to="/projects" className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-sky-700">
          <ArrowLeft size={13} /> Projects
        </Link>
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-center gap-2" role="alert">
          <AlertTriangle size={15} /> {error || 'Project not found'}
        </div>
      </div>
    );

  const appRepo = project.gitLabRepos.find((r) => r.role === 'app') || project.gitLabRepos.find((r) => r.role !== 'gitops');
  const gitopsRepo = project.gitLabRepos.find((r) => r.role === 'gitops');
  const envs = setup?.environments ?? [];
  const incomplete = envs.filter((e) => e.checks.some((c) => !c.ok)).length;
  const nextSetup = overview?.setup.find((s) => !s.done)?.key;
  const TABS: { key: 'overview' | 'setup'; label: string; badge: number }[] = [
    { key: 'overview', label: 'Overview', badge: 0 },
    { key: 'setup', label: 'Setup checklist', badge: incomplete },
  ];

  return (
    <div className="space-y-4">
      <Link to="/projects" className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-sky-700">
        <ArrowLeft size={13} /> Projects
      </Link>

      <PageHeader
        title={project.name}
        description={project.description || 'Application repository, GitOps repository and one environment per branch.'}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" leftIcon={<Rocket size={13} />} onClick={() => navigate(`/environments?project=${project._id}`)}>
              Deployments
            </Button>
            {canManage && (
              <Button variant="secondary" size="sm" leftIcon={<Pencil size={13} />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </div>
        }
      />

      <div className="grid sm:grid-cols-3 gap-3">
        <InfoCard icon={<FolderGit2 size={12} />} label="Application repo">
          <RepoLink url={setup?.appRepo?.url || appRepo?.repoUrl} />
        </InfoCard>
        <InfoCard icon={<Layers size={12} />} label="GitOps repo">
          <RepoLink url={setup?.gitopsRepo?.url || gitopsRepo?.repoUrl} />
        </InfoCard>
        <InfoCard icon={<Server size={12} />} label="Cluster">
          {setup?.cluster || project.kubernetesMappings[0]?.clusterName || <span className="text-amber-700 font-sans text-xs">not set</span>}
        </InfoCard>
      </div>

      {setup && !setup.ready && (
        <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-3" role="status">
          <span className="flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            {setup.message || 'Set the application repository, GitOps repository and cluster before adding environments.'}
          </span>
          {canManage && (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Complete setup
            </Button>
          )}
        </div>
      )}
      {error && setup && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2" role="alert">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {overview && overview.setup.some((s) => !s.done) && (
        <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-sky-900">Finish setting up {project.name}</div>
            <SetupStepper steps={overview.setup} />
          </div>
          {canManage && nextSetup === 'repos' && (
            <Button size="sm" onClick={() => setEditing(true)}>
              Add repositories
            </Button>
          )}
          {canManage && nextSetup === 'cluster' && (
            <Button size="sm" onClick={() => setEditing(true)}>
              Pick a cluster
            </Button>
          )}
          {canManage && nextSetup === 'environment' && (
            <Button size="sm" leftIcon={<Plus size={13} />} onClick={() => setAdding(true)} disabled={!setup?.ready}>
              Add first environment
            </Button>
          )}
          {nextSetup === 'deploy' && (
            <span className="text-xs text-sky-900">
              Push to the <span className="font-mono">{overview.environments[0]?.branch}</span> branch: CI builds it and ArgoCD deploys it.
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-slate-200" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px ${tab === t.key ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {t.label}
            {t.badge > 0 && <span className="ml-1.5 px-1.5 rounded-full bg-rose-100 text-rose-700 text-[10px]">{t.badge}</span>}
          </button>
        ))}
        {canManage && (
          <Button size="sm" className="ml-auto mb-1" leftIcon={<Plus size={13} />} onClick={() => setAdding(true)} disabled={!setup?.ready}>
            Add environment
          </Button>
        )}
      </div>

      {tab === 'overview' && (
        <div className="grid xl:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
          <div className="space-y-3">
            {argoError && (
              <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2" role="status">
                <AlertTriangle size={14} /> Live status unavailable: {argoError}
              </div>
            )}
            {!overview ? (
              <div className="grid md:grid-cols-2 2xl:grid-cols-3 gap-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-64 rounded-lg border border-slate-200 bg-white animate-pulse" />
                ))}
              </div>
            ) : overview.environments.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500">
                No environments yet. {canManage && setup?.ready ? 'Press Add environment and start with dev.' : ''}
              </div>
            ) : (
              <div className="grid md:grid-cols-2 2xl:grid-cols-3 gap-3">
                {overview.environments.map((env, i) => (
                  <EnvironmentTile
                    key={env.name}
                    env={env}
                    previous={overview.environments[i - 1]}
                    actions={[
                      { label: 'Logs', icon: <ScrollText size={13} />, to: `/logs?project=${project._id}&env=${encodeURIComponent(env.name)}` },
                      { label: 'Metrics', icon: <LineChart size={13} />, to: `/metrics?project=${project._id}&env=${encodeURIComponent(env.name)}` },
                      { label: 'Pods', icon: <Boxes size={13} />, to: `/resource-browser?namespace=${encodeURIComponent(env.namespace)}` },
                      { label: 'Manifests', icon: <FileCode2 size={13} />, onClick: () => setManifestsFor(env.name) },
                    ]}
                  />
                ))}
              </div>
            )}
          </div>
          <aside className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Recent deploys</h2>
              <button type="button" onClick={loadOverview} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Refresh recent deploys">
                <RefreshCw size={13} />
              </button>
            </div>
            <ActivityFeed environments={overview?.environments || []} />
            <div className="pt-2 border-t border-slate-100">
              <PromoteHint projectId={project._id} />
            </div>
          </aside>
        </div>
      )}

      {tab === 'setup' && (
      <section className="rounded-lg border border-slate-200 bg-white">
        <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Setup checklist</h2>
            <p className="text-[11px] text-slate-500">
              {envs.length
                ? incomplete
                  ? `${incomplete} of ${envs.length} environment(s) need attention`
                  : `${envs.length} environment(s), every item in place`
                : 'Each environment is a branch, a GitOps overlay, a namespace and an ArgoCD app.'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" leftIcon={<RefreshCw size={13} className={isChecking ? 'animate-spin' : ''} />} onClick={loadSetup} disabled={isChecking}>
              Re-check
            </Button>
          </div>
        </header>

        {!setup && isChecking ? (
          <div className="p-6 text-center text-xs text-slate-500">Checking namespaces, overlays, ArgoCD and GitLab…</div>
        ) : envs.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            No environments yet.{canManage && setup?.ready ? ' Add the first one, usually dev.' : ''}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {envs.map((env) => {
              const open = expanded.has(env.name);
              const missing = env.checks.some((c) => !c.ok);
              return (
                <li key={env.name}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggle(env.name)}
                      aria-expanded={open}
                      className="flex items-center gap-2 min-w-[120px] text-left"
                    >
                      {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                      <span className="font-mono font-semibold text-slate-900">{env.name}</span>
                    </button>
                    <div className="text-[11px] text-slate-500 font-mono flex-1 min-w-[200px] space-x-3">
                      <span title="Namespace">ns/{env.namespace}</span>
                      <span title="ArgoCD application">app/{env.appName}</span>
                      <span className="font-sans">{env.autoSync ? 'auto-sync' : 'manual sync'}</span>
                    </div>
                    <CheckSummary checks={env.checks} />
                    <div className="flex gap-0.5" aria-label={`Shortcuts for ${env.name}`}>
                      {[
                        { label: 'Logs', icon: <ScrollText size={13} />, to: `/logs?project=${project._id}&env=${encodeURIComponent(env.name)}` },
                        { label: 'Metrics', icon: <LineChart size={13} />, to: `/metrics?project=${project._id}&env=${encodeURIComponent(env.name)}` },
                        { label: 'Pods', icon: <Boxes size={13} />, to: `/resource-browser?namespace=${encodeURIComponent(env.namespace)}` },
                      ].map((a) => (
                        <Link key={a.label} to={a.to} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-slate-600 hover:text-sky-700 hover:bg-sky-50" title={`${a.label} for ${env.name}`}>
                          {a.icon}
                          {a.label}
                        </Link>
                      ))}
                      <button
                        type="button"
                        onClick={() => setManifestsFor(env.name)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-slate-600 hover:text-sky-700 hover:bg-sky-50"
                        title={`GitOps files and live manifests of ${env.name}`}
                      >
                        <FileCode2 size={13} />
                        Manifests
                      </button>
                    </div>
                    {canManage && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant={missing ? 'primary' : 'ghost'}
                          leftIcon={<Wrench size={13} />}
                          isLoading={provisioning === env.name}
                          disabled={Boolean(provisioning)}
                          onClick={() => handleProvision(env)}
                          title="Create whatever is missing for this environment"
                        >
                          {missing ? 'Fix' : 'Provision'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove ${env.name}`}
                          onClick={() => {
                            setDeleteNamespace(false);
                            setRemoveError(null);
                            setRemoveTarget(env);
                          }}
                        >
                          <Trash2 size={13} className="text-rose-600" />
                        </Button>
                      </div>
                    )}
                  </div>
                  {open && (
                    <div className="px-4 pb-3 pl-10">
                      <CheckList checks={env.checks} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      )}

      {editing && (
        <ProjectFormModal
          project={project}
          onClose={() => setEditing(false)}
          onSaved={(p, message) => {
            setEditing(false);
            setProject(p);
            toast.success(message);
            loadSetup();
          }}
        />
      )}

      {adding && setup && (
        <AddEnvironmentModal
          project={project}
          setup={setup}
          onClose={() => setAdding(false)}
          onAdded={async () => {
            setProject(await projectApi.get(id));
            loadSetup();
            loadOverview();
          }}
        />
      )}

      {manifestsFor && <ManifestsModal projectId={project._id} env={manifestsFor} onClose={() => setManifestsFor(null)} />}

      {runResult && (
        <Modal
          isOpen
          onClose={() => setRunResult(null)}
          icon={<Wrench size={18} />}
          title={runResult.title}
          subtitle={runResult.result.message}
          footer={<Button onClick={() => setRunResult(null)}>Close</Button>}
        >
          <StepList steps={runResult.result.steps} />
        </Modal>
      )}

      <ConfirmDialog
        isOpen={Boolean(removeTarget)}
        title={`Remove ${removeTarget?.name}?`}
        message={
          <div className="space-y-3">
            <p>
              Deletes the ArgoCD app <span className="font-mono">{removeTarget?.appName}</span> together with the resources it deployed, and
              stops CI from deploying the <span className="font-mono">{removeTarget?.name}</span> branch. The branch and the GitOps overlay are
              kept for history.
            </p>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={deleteNamespace} onChange={(e) => setDeleteNamespace(e.target.checked)} />
              Also delete namespace <span className="font-mono">{removeTarget?.namespace}</span> (secrets and anything else in it)
            </label>
          </div>
        }
        confirmLabel="Remove environment"
        isLoading={isRemoving}
        error={removeError}
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
};
