import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight, FolderKanban, GitBranch, Pencil, Plus, SearchX, Server, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { ListToolbar } from '../components/common/ListToolbar';
import { DataTable, DataColumn } from '../components/common/DataTable';
import { Pagination } from '../components/common/Pagination';
import { Button } from '../components/common/Button';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { ProjectFormModal } from '../components/projects/ProjectFormModal';
import { EnvironmentChips } from '../components/projects/projectUi';
import { repoLabel } from '../utils/project';
import { useListQuery, SortOption } from '../hooks/useListQuery';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getApiErrorMessage } from '../api/client';
import { Project, appRepoOf, clusterOf, environmentsOf, gitopsRepoOf, projectApi } from '../api/projectApi';

const projectStatus = (p: Project) => {
  if (!appRepoOf(p) || !gitopsRepoOf(p) || !clusterOf(p)) return 'Incomplete';
  return p.argoApps.length ? 'Deploying' : 'No environments';
};

const STATUS_OPTIONS = ['Deploying', 'No environments', 'Incomplete'].map((s) => ({ value: s, label: s }));

const SORT_OPTIONS: SortOption<Project>[] = [
  { value: 'name', label: 'Name A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
  { value: 'recent', label: 'Recently updated', compare: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') },
  { value: 'envs', label: 'Most environments', compare: (a, b) => b.argoApps.length - a.argoApps.length },
];

export const ProjectsPage: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { hasRole } = useAuth();
  const canManage = hasRole(['superadmin', 'devops']);
  const canDelete = hasRole(['superadmin']);

  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ project: Project | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setProjects(await projectApi.list());
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load projects'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const list = useListQuery(projects, {
    searchText: (p) => `${p.name} ${p.description || ''} ${p.gitLabRepos.map((r) => r.repoUrl).join(' ')} ${clusterOf(p)} ${environmentsOf(p).join(' ')}`,
    status: projectStatus,
    sortOptions: SORT_OPTIONS,
    syncWithUrl: true,
  });

  const handleSaved = (project: Project, message: string) => {
    const isNew = !modal?.project;
    setModal(null);
    toast.success(message);
    if (isNew) navigate(`/projects/${project._id}`);
    else setProjects((prev) => prev.map((p) => (p._id === project._id ? project : p)));
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

  const columns: DataColumn<Project>[] = [
    {
      key: 'project',
      header: 'Project',
      render: (p) => (
        <Link to={`/projects/${p._id}`} className="flex items-center gap-3 min-w-[180px] group">
          <div className="p-2 rounded-md bg-sky-50 text-sky-700 shrink-0">
            <FolderKanban size={16} aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-slate-900 font-mono group-hover:text-sky-700 group-hover:underline">{p.name}</div>
            <div className="text-[11px] text-slate-500 truncate max-w-[260px]">{p.description || 'No description'}</div>
          </div>
        </Link>
      ),
    },
    {
      key: 'repos',
      header: 'Repositories',
      render: (p) => {
        const app = appRepoOf(p);
        const gitops = gitopsRepoOf(p);
        return (
          <div className="space-y-0.5 text-[11px] font-mono">
            <div className="flex items-center gap-1.5 text-slate-700">
              <span className="w-10 text-slate-400 font-sans">app</span>
              {app ? repoLabel(app.repoUrl) : <span className="text-amber-700 font-sans">not set</span>}
            </div>
            <div className="flex items-center gap-1.5 text-slate-700">
              <span className="w-10 text-slate-400 font-sans">gitops</span>
              {gitops ? repoLabel(gitops.repoUrl) : <span className="text-amber-700 font-sans">not set</span>}
            </div>
          </div>
        );
      },
    },
    {
      key: 'cluster',
      header: 'Cluster',
      render: (p) =>
        clusterOf(p) ? (
          <span className="inline-flex items-center gap-1 font-mono text-xs text-slate-700">
            <Server size={12} className="text-slate-400" aria-hidden />
            {clusterOf(p)}
          </span>
        ) : (
          <span className="text-xs text-amber-700">not set</span>
        ),
    },
    {
      key: 'envs',
      header: 'Environments',
      render: (p) =>
        p.argoApps.length ? (
          <EnvironmentChips names={environmentsOf(p)} />
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <GitBranch size={12} aria-hidden /> none yet
          </span>
        ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      headerClassName: 'text-right',
      className: 'text-right',
      render: (p) => (
        <div className="inline-flex items-center gap-1">
          {canManage && (
            <Button size="sm" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setModal({ project: p })}>
              <Pencil size={13} />
            </Button>
          )}
          {canDelete && (
            <Button size="sm" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => setDeleteTarget(p)}>
              <Trash2 size={13} className="text-rose-600" />
            </Button>
          )}
          <Button size="sm" variant="secondary" rightIcon={<ChevronRight size={13} />} onClick={() => navigate(`/projects/${p._id}`)}>
            Open
          </Button>
        </div>
      ),
    },
  ];

  const isEmpty = !isLoading && projects.length === 0;
  const empty = isEmpty ? (
    <div className="flex flex-col items-center gap-2 py-4">
      <div className="p-2.5 rounded-md bg-slate-100 text-slate-500">
        <FolderKanban size={22} />
      </div>
      <p className="text-sm font-semibold text-slate-800">No projects yet</p>
      <p className="text-xs text-slate-500 max-w-sm">
        Create a project from an application repository and a GitOps repository, then add environments to deploy it.
      </p>
      {canManage && (
        <Button size="sm" onClick={() => setModal({ project: null })} leftIcon={<Plus size={13} />} className="mt-1">
          New project
        </Button>
      )}
    </div>
  ) : (
    <div className="flex flex-col items-center gap-2 py-2">
      <SearchX size={20} className="text-slate-400" aria-hidden />
      <p className="text-xs text-slate-500">No projects match your search or filters.</p>
      <Button size="sm" variant="secondary" onClick={list.clearFilters}>
        Clear filters
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Projects"
        description="Each project deploys one application through GitLab CI, a GitOps repository and ArgoCD into one environment per branch."
      />

      <ListToolbar
        query={list.query}
        onQueryChange={list.setQuery}
        searchPlaceholder="Search by name, repository, cluster or environment"
        statusOptions={STATUS_OPTIONS}
        status={list.status}
        onStatusChange={list.setStatus}
        sortOptions={SORT_OPTIONS}
        sort={list.sort}
        onSortChange={list.setSort}
        onRefresh={load}
        isRefreshing={isLoading}
        actions={
          canManage && (
            <Button size="sm" onClick={() => setModal({ project: null })} leftIcon={<Plus size={14} />} className="h-8">
              New project
            </Button>
          )
        }
      />

      {error && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3" role="alert">
          <span className="flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            {error}
          </span>
          <Button size="sm" variant="danger" onClick={load}>
            Retry
          </Button>
        </div>
      )}

      <DataTable
        caption="Projects"
        columns={columns}
        rows={list.pageItems}
        rowKey={(p) => p._id}
        isLoading={isLoading}
        empty={empty}
        footer={
          list.totalCount > 0 ? (
            <Pagination
              page={list.page}
              pageSize={list.pageSize}
              total={list.filteredCount}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
              itemLabel="projects"
            />
          ) : undefined
        }
      />

      {modal && <ProjectFormModal project={modal.project} onClose={() => setModal(null)} onSaved={handleSaved} />}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete project?"
        message={
          <>
            <strong className="font-semibold">{deleteTarget?.name}</strong> is removed from KubeOrbit. Its repositories, ArgoCD apps and
            namespaces are left untouched; remove environments first on the project page if you want those cleaned up.
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
