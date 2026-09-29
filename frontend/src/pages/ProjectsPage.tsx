import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  FolderKanban,
  LayoutGrid,
  Layers,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  ScrollText,
  Search,
  SearchX,
  Server,
  Trash2,
} from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Button } from '../components/common/Button';
import { Dropdown } from '../components/common/Dropdown';
import { Pagination } from '../components/common/Pagination';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { ProjectFormModal } from '../components/projects/ProjectFormModal';
import { EnvironmentStrip, SetupStepper } from '../components/projects/EnvironmentPipeline';
import { useListQuery, SortOption } from '../hooks/useListQuery';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getApiErrorMessage } from '../api/client';
import { Project, ProjectOverview, appRepoOf, clusterOf, gitopsRepoOf, projectApi, projectOverviewApi } from '../api/projectApi';
import { repoLabel, repoWebUrl } from '../utils/project';
import { formatRelativeTime } from '../utils/format';

type Filter = '' | 'attention' | 'healthy' | 'setup';

const isSetupIncomplete = (p: ProjectOverview) => p.setup.some((s) => !s.done);
const healthyEnvs = (p: ProjectOverview) => p.environments.filter((e) => e.state === 'healthy').length;

// Matches the Filter chips; useListQuery compares it with the selected filter.
const category = (p: ProjectOverview): string => {
  if (isSetupIncomplete(p)) return 'setup';
  if (p.attention > 0) return 'attention';
  return 'healthy';
};

const SORT_OPTIONS: SortOption<ProjectOverview>[] = [
  { value: 'attention', label: 'Needs attention first', compare: (a, b) => b.attention - a.attention || a.name.localeCompare(b.name) },
  { value: 'recent', label: 'Recently deployed', compare: (a, b) => (b.lastDeployAt || '').localeCompare(a.lastDeployAt || '') },
  { value: 'name', label: 'Name A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
  { value: 'envs', label: 'Most environments', compare: (a, b) => b.environments.length - a.environments.length },
];

const FILTERS: { value: Filter; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'healthy', label: 'All healthy' },
  { value: 'setup', label: 'Setup incomplete' },
];

const StatTile: React.FC<{ label: string; value: number | string; hint: string; icon: React.ReactNode; tone: string; active?: boolean; onClick?: () => void }> = ({
  label,
  value,
  hint,
  icon,
  tone,
  active,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick}
    className={`text-left rounded-lg border bg-white p-3 transition-colors ${active ? 'border-sky-500 ring-2 ring-sky-100' : 'border-slate-200'} ${onClick ? 'hover:border-sky-300' : 'cursor-default'}`}
  >
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <span className={`p-1.5 rounded-md ${tone}`}>{icon}</span>
    </div>
    <div className="text-2xl font-bold text-slate-900 mt-1">{value}</div>
    <div className="text-[11px] text-slate-500">{hint}</div>
  </button>
);

const RepoLine: React.FC<{ label: string; url?: string }> = ({ label, url }) => (
  <div className="flex items-center gap-1.5 text-[11px] min-w-0">
    <span className="w-12 shrink-0 text-slate-400">{label}</span>
    {url ? (
      <a href={repoWebUrl(url)} target="_blank" rel="noreferrer" className="font-mono text-slate-700 hover:text-sky-700 hover:underline truncate" onClick={(e) => e.stopPropagation()}>
        {repoLabel(url)}
      </a>
    ) : (
      <span className="text-amber-700">not set</span>
    )}
  </div>
);

const HowItWorks: React.FC = () => {
  const [open, setOpen] = useState(false);
  const steps = [
    { icon: <FolderKanban size={16} />, title: 'Create a project', text: 'Pick the app repository (code + CI), the GitOps repository (Kubernetes manifests) and the cluster.' },
    { icon: <Layers size={16} />, title: 'Add environments', text: 'dev, qa, staging, uat, prod. Each one gets a branch, namespace, overlay and ArgoCD app, set up for you.' },
    { icon: <Rocket size={16} />, title: 'Push and promote', text: 'Push to dev: CI builds, ArgoCD deploys. Promote with merge requests; prod waits for a Sync (approval).' },
  ];
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/60">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-2.5 text-left" aria-expanded={open}>
        <span className="text-xs font-semibold text-sky-900">How projects work (3 steps)</span>
        {open ? <ChevronDown size={14} className="text-sky-700" /> : <ChevronRight size={14} className="text-sky-700" />}
      </button>
      {open && (
        <div className="grid md:grid-cols-3 gap-3 px-4 pb-4">
          {steps.map((s, i) => (
            <div key={s.title} className="rounded-md bg-white border border-sky-100 p-3">
              <div className="flex items-center gap-2 text-sky-800">
                <span className="w-5 h-5 rounded-full bg-sky-600 text-white text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                {s.icon}
                <span className="text-xs font-semibold">{s.title}</span>
              </div>
              <p className="text-[11px] text-slate-600 mt-1.5">{s.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const ProjectsPage: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { hasRole } = useAuth();
  const canManage = hasRole(['superadmin', 'devops']);
  const canDelete = hasRole(['superadmin']);

  const [projects, setProjects] = useState<ProjectOverview[]>([]);
  const [argoError, setArgoError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'cards' | 'table'>(() => {
    try {
      return localStorage.getItem('projects.view') === 'table' ? 'table' : 'cards';
    } catch {
      return 'cards';
    }
  });
  const [modal, setModal] = useState<{ project: Project | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectOverview | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const r = await projectOverviewApi.list();
      setProjects(r.projects);
      setArgoError(r.argoError);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load projects'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const switchView = (v: 'cards' | 'table') => {
    setView(v);
    try {
      localStorage.setItem('projects.view', v);
    } catch {
      /* per-viewer convenience only */
    }
  };

  const list = useListQuery(projects, {
    searchText: (p) => `${p.name} ${p.description || ''} ${p.gitLabRepos.map((r) => r.repoUrl).join(' ')} ${clusterOf(p)} ${p.environments.map((e) => `${e.name} ${e.namespace}`).join(' ')}`,
    status: category,
    sortOptions: SORT_OPTIONS,
    defaultPageSize: 10,
    syncWithUrl: true,
  });

  const stats = useMemo(() => {
    const envs = projects.flatMap((p) => p.environments);
    return {
      projects: projects.length,
      environments: envs.length,
      healthy: envs.filter((e) => e.state === 'healthy').length,
      attention: projects.filter((p) => p.attention > 0 && !isSetupIncomplete(p)).length,
      setup: projects.filter(isSetupIncomplete).length,
    };
  }, [projects]);

  const handleSaved = (project: Project, message: string, opts?: { openAddEnvironment?: boolean }) => {
    const isNew = !modal?.project;
    setModal(null);
    toast.success(message);
    if (isNew) navigate(`/projects/${project._id}${opts?.openAddEnvironment ? '?addEnv=1' : ''}`);
    else load();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const { message } = await projectApi.remove(deleteTarget._id);
      setProjects((prev) => prev.filter((p) => p._id !== deleteTarget._id));
      setDeleteTarget(null);
      toast.success(message);
    } catch (err) {
      setDeleteError(getApiErrorMessage(err, 'Could not delete the project'));
    } finally {
      setIsDeleting(false);
    }
  };

  const actions = (p: ProjectOverview) => (
    <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      <Link to={`/environments?project=${p._id}`} className="p-1.5 rounded-md text-slate-500 hover:text-sky-700 hover:bg-sky-50" title="Environments: promote, roll back" aria-label={`Environments of ${p.name}`}>
        <Rocket size={14} />
      </Link>
      {p.environments.length > 0 && (
        <Link
          to={`/logs?project=${p._id}&env=${encodeURIComponent(p.environments[0].name)}`}
          className="p-1.5 rounded-md text-slate-500 hover:text-sky-700 hover:bg-sky-50"
          title="Logs"
          aria-label={`Logs of ${p.name}`}
        >
          <ScrollText size={14} />
        </Link>
      )}
      {canManage && (
        <button type="button" onClick={() => setModal({ project: p })} className="p-1.5 rounded-md text-slate-500 hover:text-sky-700 hover:bg-sky-50" title="Edit" aria-label={`Edit ${p.name}`}>
          <Pencil size={14} />
        </button>
      )}
      {canDelete && (
        <button type="button" onClick={() => setDeleteTarget(p)} className="p-1.5 rounded-md text-slate-500 hover:text-rose-700 hover:bg-rose-50" title="Delete" aria-label={`Delete ${p.name}`}>
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );

  const statusLine = (p: ProjectOverview) => {
    if (isSetupIncomplete(p)) {
      const next = p.setup.find((s) => !s.done);
      return <span className="text-sky-800">Next step: {next?.label.toLowerCase()}</span>;
    }
    if (p.attention > 0) {
      const first = p.environments.find((e) => e.state === 'failing') || p.environments.find((e) => e.state !== 'healthy' && e.state !== 'deploying');
      return (
        <span className="text-amber-800">
          <AlertTriangle size={12} className="inline -mt-0.5 mr-1" />
          <span className="font-mono font-semibold">{first?.name}</span>: {first?.message}
        </span>
      );
    }
    return (
      <span className="text-emerald-700">
        <CheckCircle2 size={12} className="inline -mt-0.5 mr-1" />
        All {p.environments.length} environments healthy
      </span>
    );
  };

  const card = (p: ProjectOverview) => (
    <article
      key={p._id}
      onClick={() => navigate(`/projects/${p._id}`)}
      className={`rounded-lg border bg-white p-4 flex flex-col gap-3 cursor-pointer hover:shadow-sm transition-shadow ${p.attention > 0 && !isSetupIncomplete(p) ? 'border-amber-300' : 'border-slate-200'}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 rounded-md bg-sky-50 text-sky-700 shrink-0">
            <FolderKanban size={18} aria-hidden />
          </div>
          <div className="min-w-0">
            <Link to={`/projects/${p._id}`} onClick={(e) => e.stopPropagation()} className="text-sm font-bold font-mono text-slate-900 hover:text-sky-700 hover:underline">
              {p.name}
            </Link>
            <p className="text-xs text-slate-500 line-clamp-2">{p.description || 'No description'}</p>
          </div>
        </div>
        {actions(p)}
      </header>

      <div className="text-xs">{statusLine(p)}</div>

      {isSetupIncomplete(p) ? (
        <div className="rounded-md bg-slate-50 border border-slate-200 p-2.5">
          <SetupStepper steps={p.setup} />
        </div>
      ) : null}
      {p.environments.length > 0 && <EnvironmentStrip environments={p.environments} projectId={p._id} />}

      <footer className="grid sm:grid-cols-2 gap-x-4 gap-y-1 pt-2 border-t border-slate-100">
        <RepoLine label="app" url={appRepoOf(p)?.repoUrl} />
        <RepoLine label="gitops" url={gitopsRepoOf(p)?.repoUrl} />
        <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <Server size={11} className="text-slate-400" /> <span className="font-mono">{clusterOf(p) || 'no cluster'}</span>
        </div>
        <div className="text-[11px] text-slate-500">{p.lastDeployAt ? `Last deploy ${formatRelativeTime(p.lastDeployAt)}` : 'Never deployed'}</div>
      </footer>
    </article>
  );

  const empty = !isLoading && projects.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Projects"
        description="Each project is one application: its code repo, its GitOps repo and one environment per branch. See at a glance what runs where and what needs attention."
        actions={
          canManage && (
            <Button onClick={() => setModal({ project: null })} leftIcon={<Plus size={14} />}>
              New project
            </Button>
          )
        }
      />

      <HowItWorks />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Projects" value={stats.projects} hint={`${stats.setup} with setup incomplete`} icon={<FolderKanban size={15} />} tone="bg-sky-50 text-sky-700" active={!list.status} onClick={() => list.setStatus('')} />
        <StatTile label="Environments" value={stats.environments} hint={`${stats.healthy} healthy`} icon={<Layers size={15} />} tone="bg-indigo-50 text-indigo-700" />
        <StatTile
          label="Needs attention"
          value={stats.attention}
          hint="failing, waiting or not set up"
          icon={<AlertTriangle size={15} />}
          tone="bg-amber-50 text-amber-700"
          active={list.status === 'attention'}
          onClick={() => list.setStatus('attention')}
        />
        <StatTile
          label="Setup incomplete"
          value={stats.setup}
          hint="repos, cluster, environment or first deploy missing"
          icon={<FolderGit2 size={15} />}
          tone="bg-slate-100 text-slate-700"
          active={list.status === 'setup'}
          onClick={() => list.setStatus('setup')}
        />
      </div>

      {argoError && (
        <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2" role="status">
          <AlertTriangle size={14} className="shrink-0" />
          Live environment status is unavailable: {argoError} Check Connectors → ArgoCD and the port-forward.
        </div>
      )}
      {error && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3" role="alert">
          <span className="flex items-center gap-2">
            <AlertTriangle size={14} /> {error}
          </span>
          <Button size="sm" variant="danger" onClick={load}>
            Retry
          </Button>
        </div>
      )}

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" aria-hidden />
          <input
            value={list.query}
            onChange={(e) => list.setQuery(e.target.value)}
            placeholder="Search project, repo, cluster, environment or namespace"
            aria-label="Search projects"
            className="w-full h-9 pl-8 pr-3 rounded-md border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
          />
        </div>
        <div className="inline-flex rounded-md border border-slate-200 bg-white overflow-hidden" role="group" aria-label="Filter">
          {FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              type="button"
              onClick={() => list.setStatus(f.value)}
              aria-pressed={list.status === f.value}
              className={`h-9 px-3 text-xs font-medium border-r border-slate-200 last:border-r-0 ${list.status === f.value ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Dropdown size="md" ariaLabel="Sort" value={list.sort} onChange={list.setSort} options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
        <div className="inline-flex rounded-md border border-slate-200 bg-white overflow-hidden ml-auto" role="group" aria-label="View">
          <button type="button" onClick={() => switchView('cards')} aria-pressed={view === 'cards'} className={`h-9 px-2.5 ${view === 'cards' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`} aria-label="Card view">
            <LayoutGrid size={15} />
          </button>
          <button type="button" onClick={() => switchView('table')} aria-pressed={view === 'table'} className={`h-9 px-2.5 ${view === 'table' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`} aria-label="Table view">
            <List size={15} />
          </button>
        </div>
        <Button variant="secondary" onClick={load} disabled={isLoading} aria-label="Refresh" className="h-9">
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
        </Button>
      </div>

      {/* content */}
      {isLoading && !projects.length ? (
        <div className="grid xl:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-56 rounded-lg border border-slate-200 bg-white animate-pulse" />
          ))}
        </div>
      ) : empty ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center space-y-3">
          <div className="mx-auto w-12 h-12 rounded-full bg-sky-50 text-sky-700 flex items-center justify-center">
            <FolderKanban size={22} />
          </div>
          <h2 className="text-sm font-semibold text-slate-900">No projects yet</h2>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            A project connects your application repository, its GitOps repository and a cluster. Then you add environments and every push is built, deployed and promoted from here.
          </p>
          {canManage && (
            <Button onClick={() => setModal({ project: null })} leftIcon={<Plus size={14} />}>
              Create your first project
            </Button>
          )}
        </div>
      ) : list.filteredCount === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center space-y-2">
          <SearchX size={20} className="mx-auto text-slate-400" />
          <p className="text-xs text-slate-500">No projects match your search or filter.</p>
          <Button size="sm" variant="secondary" onClick={list.clearFilters}>
            Clear filters
          </Button>
        </div>
      ) : view === 'cards' ? (
        <div className="grid xl:grid-cols-2 gap-4">{list.pageItems.map(card)}</div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Projects</caption>
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Project</th>
                <th className="text-left font-semibold px-4 py-2.5">Environments</th>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-left font-semibold px-4 py-2.5">Last deploy</th>
                <th className="px-4 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.pageItems.map((p) => (
                <tr key={p._id} onClick={() => navigate(`/projects/${p._id}`)} className="hover:bg-slate-50 cursor-pointer align-top">
                  <td className="px-4 py-3">
                    <div className="font-mono font-semibold text-slate-900">{p.name}</div>
                    <div className="text-[11px] text-slate-500 truncate max-w-[240px]">{p.description || '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    {p.environments.length ? (
                      <div className="flex flex-wrap gap-1">
                        {p.environments.map((e) => (
                          <span key={e.name} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-200 text-[11px] font-mono" title={e.message}>
                            <span className={`w-1.5 h-1.5 rounded-full ${e.state === 'healthy' ? 'bg-emerald-500' : e.state === 'failing' ? 'bg-rose-500' : e.state === 'deploying' ? 'bg-sky-500' : e.state === 'waiting' ? 'bg-amber-500' : 'bg-slate-400'}`} />
                            {e.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">none</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs max-w-sm">
                    {statusLine(p)}
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {healthyEnvs(p)}/{p.environments.length} healthy
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{p.lastDeployAt ? formatRelativeTime(p.lastDeployAt) : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end items-center gap-1">
                      {actions(p)}
                      <ArrowRight size={14} className="text-slate-300" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.filteredCount > list.pageSize && (
        <Pagination page={list.page} pageSize={list.pageSize} total={list.filteredCount} onPageChange={list.setPage} onPageSizeChange={list.setPageSize} itemLabel="projects" />
      )}

      {modal && <ProjectFormModal project={modal.project} onClose={() => setModal(null)} onSaved={handleSaved} />}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete project?"
        message={
          <>
            <strong className="font-semibold">{deleteTarget?.name}</strong> is removed from DevOps Intelligence. Its repositories, ArgoCD apps and namespaces are left
            untouched; remove environments first on the project page if you want those cleaned up.
          </>
        }
        confirmLabel="Delete project"
        isLoading={isDeleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
      />
    </div>
  );
};
