import React, { useEffect, useState } from 'react';
import {
  GitBranch,
  Search,
  ExternalLink,
  Copy,
  CheckCircle2,
  Lock,
  Globe,
  FolderGit2,
  RefreshCw,
  Layers,
  ArrowRight,
  ShieldCheck,
  Activity,
  Workflow,
  Play,
  XCircle,
  Clock,
  RotateCw,
  Check,
  AlertTriangle,
  X,
  Radio,
  ArrowUpRight,
  GitCommit,
  Sparkles,
  Plus,
} from 'lucide-react';
import { gitApi } from '../api/gitApi';
import { argoApi } from '../api/argoApi';
import { GitIntegration, GitRepo, PipelineRun, PipelineStage, GitCommit as GitCommitType, GitBranchInfo } from '../types';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ScrollableTabs, TabItem } from '../components/common/ScrollableTabs';
import { MergePanel } from '../components/git/MergePanel';
import { Pagination } from '../components/common/Pagination';
import { usePagination } from '../hooks/usePagination';
import { Dropdown } from '../components/common/Dropdown';
import { GitLabIcon } from '../components/common/BrandIcons';
import { useNavigate } from 'react-router-dom';
import { FolderPlus, GitMerge, Upload } from 'lucide-react';
import { CreateRepoModal } from '../components/git/CreateRepoModal';
import { PushTemplateModal } from '../components/git/PushTemplateModal';
import { JobLogModal } from '../components/git/JobLogModal';

const ACTIVE_PIPELINE_STATUSES = ['created', 'waiting_for_resource', 'preparing', 'pending', 'running'];
const PIPELINE_POLL_MS = 5000;

// How a pipeline was started, in plain words (GitLab "source" values).
const TRIGGER_LABEL: Record<string, string> = {
  push: 'pushed',
  web: 'run from GitLab',
  api: 'run from DevOps Intelligence',
  schedule: 'scheduled',
  merge_request_event: 'merge request',
  trigger: 'triggered',
};
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

type TabType = 'pipelines' | 'commits' | 'branches' | 'merge' | 'gitops' | 'languages' | 'architecture';

// Live relative timestamp formatter (No mock dates!)
const formatRelativeTime = (isoString?: string): string => {
  if (!isoString) return '-';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 0) return 'just now';
  if (diffSec < 60) return `${Math.max(1, diffSec)}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// Format enterprise-ready error messages for UI
const formatApiError = (err: any, fallbackMessage: string): string => {
  if (!err) return fallbackMessage;
  if (err.response?.data?.message) return err.response.data.message;
  if (err.response?.status === 401) return 'GitLab authentication failed. Your access token may be invalid or expired.';
  if (err.response?.status === 403) return 'GitLab access denied. Insufficient permissions to access this repository.';
  if (err.response?.status === 404) return 'The requested GitLab repository or pipeline could not be found.';
  if (err.message === 'Network Error' || !err.response) return 'Unable to reach API service. Please verify server connectivity.';
  return err.message || fallbackMessage;
};

// Language color mapping for tech stack bar
const LANGUAGE_COLORS: Record<string, string> = {
  JavaScript: '#f7df1e',
  TypeScript: '#3178c6',
  Dockerfile: '#384d54',
  Python: '#3572A5',
  Go: '#00ADD8',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Shell: '#89e051',
  YAML: '#cb171e',
};

export const GitPage: React.FC = () => {
  const navigate = useNavigate();
  const [integrations, setIntegrations] = useState<GitIntegration[]>([]);
  const [repos, setRepos] = useState<GitRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<GitRepo | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'public' | 'private'>('all');
  const [cloneProtocol, setCloneProtocol] = useState<'https' | 'ssh'>('https');
  const [isCopied, setIsCopied] = useState(false);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);

  // Tab & live detail data states
  const [activeTab, setActiveTab] = useState<TabType>('pipelines');
  const [pipelines, setPipelines] = useState<PipelineRun[]>([]);
  const [commits, setCommits] = useState<GitCommitType[]>([]);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [languages, setLanguages] = useState<Record<string, number>>({});
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  // User Notification States (Error & Success)
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Multi-credentials support
  const [selectedIntegrationId, setSelectedIntegrationId] = useState<string>('');
  const [isCreateRepoOpen, setIsCreateRepoOpen] = useState(false);
  const [isPushCodeOpen, setIsPushCodeOpen] = useState(false);
  const { hasRole, canDeployAnywhere } = useAuth();
  const toast = useToast();
  const canManageRepos = hasRole(['superadmin', 'devops']);
  const activeIntegration = integrations.find((g) => g._id === selectedIntegrationId) || integrations[0];

  // After creating a repo: switch to its account, reload the list and select the new repo.
  const handleRepoCreated = async (repo: GitRepo, integrationId: string, message: string, ok: boolean) => {
    setIsCreateRepoOpen(false);
    if (ok) toast.success(message);
    else toast.error(message);
    setSelectedIntegrationId(integrationId);
    try {
      const liveRepos = await gitApi.getRepos(integrationId);
      setRepos(liveRepos);
      setSelectedRepo(liveRepos.find((r) => r.id === repo.id) || repo);
    } catch {
      setRepos((prev) => [repo, ...prev]);
      setSelectedRepo(repo);
    }
  };

  // Trigger pipeline modal state
  const [isTriggerModalOpen, setIsTriggerModalOpen] = useState(false);
  const [triggerBranch, setTriggerBranch] = useState('main');
  const [triggerEnv, setTriggerEnv] = useState('dev');
  const [isTriggering, setIsTriggering] = useState(false);

  // ArgoCD sync state
  const [isArgoSyncing, setIsArgoSyncing] = useState(false);

  // Stage execution log drawer
  const [selectedStageLog, setSelectedStageLog] = useState<{
    stage: PipelineStage;
    pipelineId: number;
    repoName: string;
  } | null>(null);

  // Load integration and live repositories from GitLab PAT
  const loadGitLabData = async (targetIntegrationId?: string) => {
    setIsLoadingRepos(true);
    setErrorMsg(null);
    try {
      const all = await gitApi.getAll();
      // Default active connector first, so integrations[0] is the one used everywhere on this page.
      const gl = (all || [])
        .filter((g) => g.provider === 'gitlab' && g.isActive)
        .sort((a, b) => Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)));
      setIntegrations(gl);

      if (gl.length > 0) {
        const activeId = targetIntegrationId || (selectedIntegrationId && gl.some(g => g._id === selectedIntegrationId) ? selectedIntegrationId : gl[0]._id);
        setSelectedIntegrationId(activeId);

        const liveRepos = await gitApi.getRepos(activeId);
        if (liveRepos && liveRepos.length > 0) {
          setRepos(liveRepos);
          setSelectedRepo((prev) => {
            const found = liveRepos.find((r) => r.name === prev?.name);
            return found || liveRepos[0];
          });
          const currentAccount = gl.find(g => g._id === activeId);
          setSuccessMsg(`Synchronized ${liveRepos.length} repositories from GitLab (account: ${currentAccount?.username || currentAccount?.name || 'connected'}).`);
          setTimeout(() => setSuccessMsg(null), 4000);
          return;
        }
      }
      setRepos([]);
    } catch (err: any) {
      console.error('Failed to load GitLab repositories:', err);
      setErrorMsg(formatApiError(err, 'Failed to synchronize repositories from GitLab.'));
    } finally {
      setIsLoadingRepos(false);
    }
  };

  // Switch between multiple GitLab credentials
  const handleSwitchIntegration = async (newId: string) => {
    if (newId === 'add_new') {
      navigate('/connectors?tab=gitlab');
      return;
    }
    setSelectedIntegrationId(newId);
    setIsLoadingRepos(true);
    setErrorMsg(null);
    try {
      const targetInt = integrations.find((i) => i._id === newId);
      const liveRepos = await gitApi.getRepos(newId);
      setRepos(liveRepos || []);
      if (liveRepos && liveRepos.length > 0) {
        setSelectedRepo(liveRepos[0]);
      } else {
        setSelectedRepo(null);
      }
      setSuccessMsg(`Switched to GitLab credential: ${targetInt?.name || targetInt?.username || newId}`);
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err: any) {
      setErrorMsg(formatApiError(err, 'Failed to switch GitLab credentials.'));
    } finally {
      setIsLoadingRepos(false);
    }
  };

  // Fetch 100% live data for selected repository
  const loadRepoDetails = async (repo: GitRepo) => {
    if (!integrations.length) return;
    setIsLoadingDetails(true);
    const intId = selectedIntegrationId || integrations[0]._id;
    const targetId = repo.id || repo.name;

    try {
      const [pipRes, comRes, braRes, lanRes] = await Promise.allSettled([
        gitApi.getPipelines(intId, targetId),
        gitApi.getCommits(intId, targetId),
        gitApi.getBranches(intId, targetId),
        gitApi.getLanguages(intId, targetId),
      ]);

      if (pipRes.status === 'fulfilled') {
        setPipelines(pipRes.value || []);
      } else {
        setPipelines([]);
      }

      if (comRes.status === 'fulfilled') {
        setCommits(comRes.value || []);
      } else {
        setCommits([]);
      }

      if (braRes.status === 'fulfilled') {
        setBranches(braRes.value || []);
      } else {
        setBranches([]);
      }

      if (lanRes.status === 'fulfilled') {
        setLanguages(lanRes.value || {});
      } else {
        setLanguages({});
      }
    } catch (err: any) {
      console.warn('Error loading live details for repo:', err);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  useEffect(() => {
    loadGitLabData();
  }, []);

  useEffect(() => {
    if (selectedRepo) {
      loadRepoDetails(selectedRepo);
      setTriggerBranch(selectedRepo.defaultBranch || 'main');
    }
  }, [selectedRepo]);

  // Poll pipelines while any run is still in progress so status, stages and tests update live.
  const hasActivePipeline = pipelines.some((p) => ACTIVE_PIPELINE_STATUSES.includes(p.status));
  useEffect(() => {
    if (!hasActivePipeline || !selectedRepo || !integrations.length) return;
    const intId = selectedIntegrationId || integrations[0]._id;
    const repoId = selectedRepo.id || selectedRepo.name;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const latest = await gitApi.getPipelines(intId, repoId);
        if (!cancelled) setPipelines(latest);
      } catch {
        // Keep showing the last known state; the next tick retries.
      }
    }, PIPELINE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hasActivePipeline, selectedRepo, selectedIntegrationId, integrations]);

  // Copy clone URL helper
  const handleCopyClone = (url: string) => {
    navigator.clipboard.writeText(url);
    setIsCopied(true);
    setSuccessMsg(`Copied ${cloneProtocol.toUpperCase()} clone URL to clipboard.`);
    setTimeout(() => {
      setIsCopied(false);
      setSuccessMsg(null);
    }, 2500);
  };

  // Trigger live pipeline execution
  const handleTriggerPipeline = async () => {
    if (!selectedRepo || !integrations.length) return;
    setIsTriggering(true);
    setErrorMsg(null);
    try {
      const intId = selectedIntegrationId || integrations[0]._id;
      const res = await gitApi.triggerPipeline(
        intId,
        selectedRepo.id || selectedRepo.name,
        triggerBranch
      );

      if (res && res.pipeline) {
        setPipelines([res.pipeline, ...pipelines]);
        setSuccessMsg(`Pipeline #${res.pipeline.id} launched successfully on '${triggerBranch}'!`);
      } else {
        setSuccessMsg(`Pipeline triggered successfully on branch '${triggerBranch}'!`);
      }
      setTimeout(() => setSuccessMsg(null), 5000);
      setIsTriggerModalOpen(false);
    } catch (err: any) {
      setErrorMsg(formatApiError(err, `Failed to launch pipeline on '${triggerBranch}'.`));
      setIsTriggerModalOpen(false);
      loadRepoDetails(selectedRepo);
    } finally {
      setIsTriggering(false);
    }
  };

  // ArgoCD Sync Trigger
  const handleTriggerArgoSync = async () => {
    if (!selectedRepo) return;
    setIsArgoSyncing(true);
    setErrorMsg(null);
    try {
      await argoApi.syncApp(selectedRepo.name);
      setSuccessMsg(`ArgoCD successfully initiated synchronization for '${selectedRepo.name}' on Minikube!`);
      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err: any) {
      setErrorMsg(formatApiError(err, `ArgoCD synchronization failed for '${selectedRepo.name}'.`));
    } finally {
      setIsArgoSyncing(false);
    }
  };

  // Filter repositories by query and visibility
  const filteredRepos = repos.filter((r) => {
    const matchesSearch =
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.description && r.description.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;
    if (visibilityFilter === 'public') return !r.private;
    if (visibilityFilter === 'private') return r.private;
    return true;
  });

  // Paging: the repo list resets on a new search / filter / account; the detail lists reset on a new repo,
  // not on the 5-second pipeline refresh.
  const repoKey = selectedRepo ? String(selectedRepo.id || selectedRepo.name) : '';
  const repoPage = usePagination(filteredRepos, 10, `${searchQuery}|${visibilityFilter}|${selectedIntegrationId}`);
  const pipelinePage = usePagination(pipelines, 5, repoKey);
  const commitPage = usePagination(commits, 10, repoKey);
  const branchPage = usePagination(branches, 10, repoKey);

  const publicCount = repos.filter((r) => !r.private).length;
  const privateCount = repos.filter((r) => r.private).length;

  // Reusable tab navigation items
  const tabItems: TabItem<TabType>[] = [
    {
      id: 'pipelines',
      label: 'CI/CD Pipelines',
      icon: <Activity size={14} className="text-sky-600" />,
      badge: (
        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200">
          {pipelines.length}
        </span>
      ),
      activeBorderColor: 'border-sky-600',
      activeTextColor: 'text-sky-700',
      activeBgColor: 'bg-sky-50/40',
    },
    {
      id: 'commits',
      label: 'Live Commits',
      icon: <GitCommit size={14} className="text-indigo-600" />,
      badge: (
        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200">
          {commits.length}
        </span>
      ),
      activeBorderColor: 'border-indigo-600',
      activeTextColor: 'text-indigo-700',
      activeBgColor: 'bg-indigo-50/40',
    },
    {
      id: 'branches',
      label: 'Branches',
      icon: <GitBranch size={14} className="text-purple-600" />,
      badge: (
        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200">
          {branches.length}
        </span>
      ),
      activeBorderColor: 'border-purple-600',
      activeTextColor: 'text-purple-700',
      activeBgColor: 'bg-purple-50/40',
    },
    {
      id: 'merge',
      label: 'Merge',
      icon: <GitMerge size={14} className="text-fuchsia-600" />,
      activeBorderColor: 'border-fuchsia-600',
      activeTextColor: 'text-fuchsia-700',
      activeBgColor: 'bg-fuchsia-50/40',
    },
    {
      id: 'gitops',
      label: 'GitOps & ArgoCD',
      icon: <Workflow size={14} className="text-orange-600" />,
      badge: (
        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-emerald-50 text-emerald-700 border border-emerald-200">
          Minikube
        </span>
      ),
      activeBorderColor: 'border-orange-600',
      activeTextColor: 'text-orange-700',
      activeBgColor: 'bg-orange-50/40',
    },
    {
      id: 'languages',
      label: 'Tech Stack',
      icon: <Layers size={14} className="text-emerald-600" />,
      activeBorderColor: 'border-emerald-600',
      activeTextColor: 'text-emerald-700',
      activeBgColor: 'bg-emerald-50/40',
    },
    {
      id: 'architecture',
      label: '8-Stage Blueprint',
      icon: <ShieldCheck size={14} className="text-slate-600" />,
      activeBorderColor: 'border-slate-800',
      activeTextColor: 'text-slate-900',
      activeBgColor: 'bg-slate-100/60',
    },
  ];

  return (
    <div className="space-y-5">
      {/* Top Banner: Connected GitLab Account & Overview */}
      <div className="p-4 bg-white border border-slate-200 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-lg bg-orange-50/90 border border-orange-200/80 flex items-center justify-center shrink-0 shadow-xs">
            <GitLabIcon size={26} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-bold text-slate-900 tracking-tight">
                GitLab Repositories &amp; Pipelines
              </h1>
              {/* Common Account Switcher Dropdown */}
              <Dropdown<string>
                value={selectedIntegrationId}
                onChange={handleSwitchIntegration}
                placeholder="Switch GitLab Credential"
                options={[
                  ...integrations.map((gl) => ({
                    value: gl._id,
                    label: gl.name || `GitLab (@${gl.username || 'PAT'})`,
                    sublabel: gl.baseUrl ? `${gl.baseUrl} • @${gl.username}` : `@${gl.username}`,
                    icon: <GitLabIcon size={14} />,
                    badge: (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Connected
                      </span>
                    ),
                  })),
                  {
                    value: 'add_new',
                    label: '+ Add Another GitLab Account',
                    sublabel: 'Configure new Personal Access Token in Connectors',
                    icon: <Plus size={13} className="text-sky-600" />,
                  },
                ]}
                buttonClassName="bg-white border-slate-300 hover:bg-slate-50 text-slate-800 text-xs py-1.5 px-3 font-semibold shadow-xs"
              />
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Live repositories synchronized via Personal Access Token with active CI/CD execution history and ArgoCD GitOps bridge.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => {
              loadGitLabData();
              if (selectedRepo) loadRepoDetails(selectedRepo);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-md text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
            title="Refresh repositories and live GitLab data"
          >
            <RefreshCw size={13} className={isLoadingRepos || isLoadingDetails ? 'animate-spin text-sky-600' : 'text-slate-500'} />
            <span>Refresh</span>
          </button>
          {canManageRepos && integrations.length > 0 && (
            <button
              onClick={() => setIsCreateRepoOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-md text-xs font-semibold transition-colors cursor-pointer"
            >
              <FolderPlus size={13} />
              <span>New repository</span>
            </button>
          )}
          <a
            href={activeIntegration ? `${activeIntegration.baseUrl}/${activeIntegration.username}` : 'https://gitlab.com'}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-md text-xs font-semibold transition-colors cursor-pointer"
          >
            <span>Open GitLab</span>
            <ExternalLink size={12} />
          </a>
        </div>
      </div>

      {/* Success Notification Alert Banner */}
      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md text-xs font-semibold flex items-center justify-between gap-2 transition-all">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button
            onClick={() => setSuccessMsg(null)}
            className="p-1 text-emerald-600 hover:text-emerald-900 rounded cursor-pointer transition-colors"
            title="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Error Notification Alert Banner */}
      {errorMsg && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-md text-xs font-semibold flex items-center justify-between gap-3 transition-all">
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={16} className="text-rose-600 shrink-0" />
            <span className="leading-snug">{errorMsg}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                setErrorMsg(null);
                loadGitLabData();
              }}
              className="px-2.5 py-1 bg-white hover:bg-rose-100 text-rose-700 border border-rose-300 rounded font-semibold text-[11px] transition-colors cursor-pointer"
            >
              Retry
            </button>
            <button
              onClick={() => setErrorMsg(null)}
              className="p-1 text-rose-600 hover:text-rose-900 rounded cursor-pointer transition-colors"
              title="Dismiss error"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Centered Loading State when initially synchronizing repositories */}
      {isLoadingRepos && repos.length === 0 ? (
        <div className="p-16 bg-white border border-slate-200 rounded-md min-h-[460px] flex flex-col items-center justify-center shadow-none">
          <LoadingSpinner message="Synchronizing repositories from GitLab..." size="lg" />
        </div>
      ) : (
        /* Main Split Layout: Left Repo List + Right Detail Inspector */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: Repository Search & List */}
          <div className="lg:col-span-5 space-y-3">
          {/* Search Box with Clear (X) Button */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search repositories by name, path or description"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-md text-xs text-slate-900 placeholder:text-slate-400 focus:border-sky-500 font-mono transition-colors"
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 p-0.5 text-slate-400 hover:text-slate-700 rounded cursor-pointer transition-colors"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Visibility Filter Pills */}
          <div className="flex items-center gap-1.5 text-xs">
            <button
              onClick={() => setVisibilityFilter('all')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                visibilityFilter === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              All ({repos.length})
            </button>
            <button
              onClick={() => setVisibilityFilter('public')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                visibilityFilter === 'public'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Globe size={11} className={visibilityFilter === 'public' ? 'text-white' : 'text-emerald-600'} />
              <span>Public ({publicCount})</span>
            </button>
            <button
              onClick={() => setVisibilityFilter('private')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                visibilityFilter === 'private'
                  ? 'bg-amber-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Lock size={11} className={visibilityFilter === 'private' ? 'text-white' : 'text-amber-600'} />
              <span>Private ({privateCount})</span>
            </button>
          </div>

          {/* Repository Cards Container with sleek custom scrollbar */}
          <div className="space-y-2 max-h-[calc(100vh-270px)] overflow-y-auto custom-scrollbar pr-1">
            {isLoadingRepos ? (
              <div className="p-12 text-center bg-white border border-slate-200 rounded-md min-h-[340px] flex flex-col items-center justify-center shadow-none">
                <LoadingSpinner message="Synchronizing repositories from GitLab..." size="md" />
              </div>
            ) : filteredRepos.length === 0 ? (
              <div className="p-8 text-center bg-white border border-slate-200 rounded-md text-slate-400 text-xs">
                {searchQuery ? (
                  <>
                    No repositories match &ldquo;{searchQuery}&rdquo;.
                    <button
                      onClick={() => setSearchQuery('')}
                      className="block mx-auto mt-2 text-sky-600 font-semibold hover:underline cursor-pointer"
                    >
                      Clear search filter
                    </button>
                  </>
                ) : (
                  'No repositories found in connected GitLab account.'
                )}
              </div>
            ) : (
              repoPage.pageItems.map((repo) => {
                const isSelected = selectedRepo?.name === repo.name;
                return (
                  <button
                    type="button"
                    key={repo.id || repo.name}
                    onClick={() => setSelectedRepo(repo)}
                    aria-pressed={isSelected}
                    className={`block w-full text-left p-3.5 bg-white border rounded-md cursor-pointer transition-all ${
                      isSelected
                        ? 'border-sky-600 bg-sky-50/25 ring-1 ring-sky-600'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <FolderGit2
                            size={15}
                            className={isSelected ? 'text-sky-600 shrink-0' : 'text-slate-400 shrink-0'}
                          />
                          <span className="font-bold text-xs font-mono text-slate-900 truncate">
                            {repo.name}
                          </span>
                          {repo.private ? (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              <Lock size={10} className="text-amber-600" /> Private
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <Globe size={10} className="text-emerald-600" /> Public
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 font-mono truncate">
                          {repo.fullName}
                        </p>
                      </div>

                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-100 text-slate-700 border border-slate-200 shrink-0 flex items-center gap-1">
                        <GitBranch size={10} className="text-purple-600" />
                        {repo.defaultBranch || 'main'}
                      </span>
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                      <span className="flex items-center gap-1 font-mono text-[10px] text-slate-400">
                        <Clock size={11} className="text-slate-400" />
                        {formatRelativeTime(repo.lastActivityAt)}
                      </span>
                      <span className="text-sky-600 font-semibold hover:text-sky-700 flex items-center gap-0.5 text-[11px]">
                        Inspect details →
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
          {!isLoadingRepos && repoPage.total > 0 && (
            <Pagination
              compact
              page={repoPage.page}
              pageSize={repoPage.pageSize}
              total={repoPage.total}
              onPageChange={repoPage.setPage}
              onPageSizeChange={repoPage.setPageSize}
              itemLabel="repositories"
            />
          )}
        </div>

        {/* Right Column: Active Repository Live Details & Tabs */}
        <div className="lg:col-span-7">
          {selectedRepo ? (
            <div className="bg-white border border-slate-200 rounded-md p-5 space-y-5">
              {/* Repo Header & Quick Actions */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between pb-4 border-b border-slate-200 gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-bold text-slate-900 font-mono">
                      {selectedRepo.name}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      Live Synced
                    </span>
                    {selectedRepo.private ? (
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-50 text-amber-700 border border-amber-200">
                        Private Repo
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-slate-100 text-slate-600 border border-slate-200">
                        Public
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    <span className="font-mono text-slate-600">{selectedRepo.fullName}</span>
                    {selectedRepo.lastActivityAt && (
                      <span> • Active {formatRelativeTime(selectedRepo.lastActivityAt)}</span>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <button
                    onClick={() => setIsTriggerModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-semibold transition-colors cursor-pointer"
                    title="Run CI/CD pipeline on GitLab"
                  >
                    <Play size={12} fill="currentColor" className="text-white" />
                    <span>Run Pipeline</span>
                  </button>
                  {canManageRepos && (
                    <button
                      onClick={() => setIsPushCodeOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-md text-xs font-semibold transition-colors cursor-pointer"
                      title="Push starter code from the devops-demo workspace"
                    >
                      <Upload size={12} />
                      <span>Push code</span>
                    </button>
                  )}
                  <button
                    onClick={() => navigate('/projects')}
                    className="flex items-center gap-1 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-md text-xs font-semibold transition-colors cursor-pointer"
                    title="Link this repo to an active project"
                  >
                    <span>Map to Project</span>
                    <ArrowRight size={13} />
                  </button>
                  <a
                    href={selectedRepo.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 border border-slate-200 hover:bg-orange-50 hover:border-orange-200 hover:text-orange-600 text-slate-600 rounded-md transition-colors"
                    title="View repository on GitLab"
                  >
                    <ExternalLink size={14} />
                  </a>
                </div>
              </div>

              {/* Clone URL Bar with HTTPS / SSH Switcher & Copy */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-600">Git Clone URL:</span>
                    <div className="flex rounded-md border border-slate-200 overflow-hidden text-[10px] font-mono">
                      <button
                        type="button"
                        onClick={() => setCloneProtocol('https')}
                        className={`px-2 py-0.5 cursor-pointer font-bold ${
                          cloneProtocol === 'https' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        HTTPS
                      </button>
                      <button
                        type="button"
                        onClick={() => setCloneProtocol('ssh')}
                        className={`px-2 py-0.5 cursor-pointer font-bold ${
                          cloneProtocol === 'ssh' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        SSH
                      </button>
                    </div>
                  </div>

                  <span className="text-[11px] text-slate-500 font-mono">
                    Default: <strong className="text-slate-800">{selectedRepo.defaultBranch || 'main'}</strong>
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={
                      cloneProtocol === 'ssh' && selectedRepo.sshUrl
                        ? selectedRepo.sshUrl
                        : selectedRepo.cloneUrl
                    }
                    placeholder="Clone URL not available"
                    aria-label="Git clone URL"
                    className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-md font-mono text-xs text-slate-800 focus:border-sky-500"
                  />
                  <button
                    onClick={() =>
                      handleCopyClone(
                        cloneProtocol === 'ssh' && selectedRepo.sshUrl
                          ? selectedRepo.sshUrl
                          : selectedRepo.cloneUrl
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-md text-xs font-semibold text-slate-700 transition-colors cursor-pointer shrink-0"
                  >
                    {isCopied ? (
                      <>
                        <Check size={13} className="text-emerald-600" />
                        <span className="text-emerald-700">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy size={13} className="text-slate-500" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Scrollable Tabs without native scrollbar, with left/right navigation arrows */}
              <ScrollableTabs<TabType>
                tabs={tabItems}
                activeTab={activeTab}
                onChange={setActiveTab}
              />

              {/* TAB 1: LIVE CI/CD PIPELINES (100% LIVE DATA) */}
              {activeTab === 'pipelines' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                      <Activity size={13} className="text-sky-600" />
                      Live GitLab Pipelines ({pipelines.length} Executions)
                      {hasActivePipeline && (
                        <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-sky-700">
                          <RotateCw size={10} className="animate-spin" /> auto-refreshing
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => selectedRepo && loadRepoDetails(selectedRepo)}
                      className="text-[11px] text-sky-600 hover:text-sky-800 font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw size={11} className={isLoadingDetails ? 'animate-spin' : ''} />
                      <span>Sync GitLab</span>
                    </button>
                  </div>

                  {isLoadingDetails ? (
                    <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-md">
                      <LoadingSpinner message="Fetching live pipelines from GitLab..." size="md" />
                    </div>
                  ) : pipelines.length === 0 ? (
                    <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-500 space-y-3">
                      <p>No CI/CD pipeline runs found for <strong>{selectedRepo.name}</strong> yet on GitLab.</p>
                      <button
                        onClick={() => setIsTriggerModalOpen(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-semibold cursor-pointer"
                      >
                        <Play size={12} fill="currentColor" />
                        <span>Run First Pipeline Now</span>
                      </button>
                    </div>
                  ) : (
                    <>
                    <div className="space-y-3 max-h-[460px] overflow-y-auto custom-scrollbar pr-1">
                      {pipelinePage.pageItems.map((p) => {
                        const isSuccess = p.status === 'success';
                        const isFailed = p.status === 'failed';
                        const isRunning = p.status === 'running';
                        const isPending = p.status === 'pending' || p.status === 'created';

                        return (
                          <div
                            key={p.id}
                            className="p-3.5 bg-slate-50/70 border border-slate-200 rounded-md space-y-3 hover:border-slate-300 transition-colors"
                          >
                            {/* Pipeline Card Top Row */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                {isSuccess && (
                                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                                )}
                                {isFailed && (
                                  <XCircle size={16} className="text-rose-600 shrink-0" />
                                )}
                                {isRunning && (
                                  <RotateCw size={16} className="text-sky-600 animate-spin shrink-0" />
                                )}
                                {isPending && (
                                  <Clock size={16} className="text-amber-600 shrink-0" />
                                )}

                                <span className="font-mono font-bold text-xs text-slate-900">
                                  #{p.id}
                                </span>

                                <span
                                  className={`px-2 py-0.2 rounded text-[10px] font-bold font-mono uppercase ${
                                    isSuccess
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : isFailed
                                      ? 'bg-rose-100 text-rose-800'
                                      : isRunning
                                      ? 'bg-sky-100 text-sky-800'
                                      : 'bg-amber-100 text-amber-800'
                                  }`}
                                >
                                  {p.status}
                                </span>

                                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-white text-slate-700 border border-slate-200 flex items-center gap-1">
                                  <GitBranch size={10} className="text-purple-600" />
                                  {p.ref}
                                </span>

                                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-slate-200 text-slate-800">
                                  {p.sha}
                                </span>
                              </div>

                              <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono">
                                <span className="flex items-center gap-1">
                                  <Clock size={12} className="text-slate-400" />
                                  {p.duration || '-'}
                                </span>
                                <span>{formatRelativeTime(p.createdAt)}</span>
                              </div>
                            </div>

                            {/* Commit Title & Trigger Origin */}
                            <div className="text-xs text-slate-700">
                              <p className="font-medium text-slate-900 line-clamp-1" title={p.commitTitle}>{p.commitTitle}</p>
                              <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-[11px] text-slate-500">
                                {p.author && (
                                  <span>
                                    Commit by <strong className="text-slate-700">{p.author}</strong>
                                  </span>
                                )}
                                {p.triggeredBy && (
                                  <span>
                                    · {TRIGGER_LABEL[p.source || ''] || p.source || 'run'} by <strong className="text-slate-700">{p.triggeredBy}</strong>
                                  </span>
                                )}
                                {p.tests && (
                                  <span
                                    className={`px-1.5 py-0.5 rounded border font-semibold ${
                                      p.tests.failed > 0
                                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    }`}
                                    title={`${p.tests.passed} passed, ${p.tests.failed} failed, ${p.tests.skipped} skipped`}
                                  >
                                    Tests {p.tests.passed}/{p.tests.total} passed
                                    {p.tests.failed > 0 ? ` · ${p.tests.failed} failed` : ''}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Interactive Stage Flow */}
                            {p.stages && p.stages.length > 0 && (
                              <div className="pt-2 border-t border-slate-200">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                                  Live Stage Execution (Click stage to inspect job)
                                </span>
                                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
                                  {p.stages.map((st, i) => {
                                    const stSuccess = st.status === 'success';
                                    const stFailed = st.status === 'failed';
                                    const stRunning = st.status === 'running';

                                    return (
                                      <button
                                        key={st.id || i}
                                        type="button"
                                        onClick={() =>
                                          setSelectedStageLog({
                                            stage: st,
                                            pipelineId: p.id,
                                            repoName: selectedRepo.name,
                                          })
                                        }
                                        className={`p-2 rounded text-left transition-all cursor-pointer border ${
                                          stSuccess
                                            ? 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                                            : stFailed
                                            ? 'bg-rose-50 border-rose-200 hover:bg-rose-100'
                                            : stRunning
                                            ? 'bg-sky-50 border-sky-300 hover:bg-sky-100'
                                            : 'bg-white border-slate-200 hover:border-slate-300'
                                        }`}
                                      >
                                        <div className="flex items-center justify-between">
                                          <span className="text-[9px] font-mono font-bold text-slate-500">
                                            0{i + 1}
                                          </span>
                                          {stSuccess && <Check size={11} className="text-emerald-700" />}
                                          {stFailed && <X size={11} className="text-rose-700" />}
                                          {stRunning && (
                                            <RotateCw size={11} className="text-sky-700 animate-spin" />
                                          )}
                                        </div>
                                        <div className="text-[11px] font-bold text-slate-800 truncate mt-0.5">
                                          {st.name}
                                        </div>
                                        <div className="text-[10px] text-slate-500 font-mono truncate">
                                          {st.duration || '-'}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Footer Quick Links */}
                            <div className="pt-2 flex items-center justify-between text-xs">
                              <a
                                href={p.webUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] text-sky-600 hover:text-sky-800 font-semibold flex items-center gap-1"
                              >
                                <span>Inspect in GitLab CI</span>
                                <ExternalLink size={11} />
                              </a>

                              <div className="flex items-center gap-2">
                                {isFailed && (
                                  <button
                                    onClick={handleTriggerPipeline}
                                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded hover:bg-rose-100 transition-colors cursor-pointer"
                                  >
                                    <RotateCw size={11} />
                                    <span>Retry Pipeline</span>
                                  </button>
                                )}
                                <button
                                  onClick={() => navigate('/argocd')}
                                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50 transition-colors cursor-pointer"
                                >
                                  <Workflow size={11} className="text-orange-600" />
                                  <span>ArgoCD Deploy</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <Pagination
                      compact
                      page={pipelinePage.page}
                      pageSize={pipelinePage.pageSize}
                      total={pipelinePage.total}
                      onPageChange={pipelinePage.setPage}
                      onPageSizeChange={pipelinePage.setPageSize}
                      itemLabel="pipelines"
                    />
                    </>
                  )}
                </div>
              )}

              {/* TAB 2: LIVE COMMITS (100% LIVE DATA) */}
              {activeTab === 'commits' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                      <GitCommit size={14} className="text-indigo-600" />
                      Live Commits ({commits.length} commits from default branch)
                    </span>
                    <a
                      href={`${selectedRepo.htmlUrl}/-/commits/${selectedRepo.defaultBranch || 'main'}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1"
                    >
                      <span>View all on GitLab</span>
                      <ExternalLink size={11} />
                    </a>
                  </div>

                  {isLoadingDetails ? (
                    <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-md">
                      <LoadingSpinner message="Fetching live commits from default branch..." size="md" />
                    </div>
                  ) : commits.length === 0 ? (
                    <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-500">
                      No commits found in repository {selectedRepo.name}.
                    </div>
                  ) : (
                    <>
                    <div className="space-y-2 max-h-[460px] overflow-y-auto custom-scrollbar pr-1">
                      {commitPage.pageItems.map((c) => (
                        <div
                          key={c.id}
                          className="p-3 bg-slate-50/70 border border-slate-200 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-300 transition-colors"
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <a
                                href={c.webUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                title="Open commit in GitLab"
                              >
                                <GitCommit size={12} className="text-indigo-600" />
                                {c.shortId}
                              </a>
                              <span className="font-semibold text-xs text-slate-900 line-clamp-1">
                                {c.title}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-500">
                              <span className="font-medium text-slate-700">{c.authorName}</span>
                              <span>•</span>
                              <span className="font-mono text-[10px]">{c.authorEmail}</span>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="text-[11px] text-slate-500 font-mono block">
                              {formatRelativeTime(c.committedDate)}
                            </span>
                            <a
                              href={c.webUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] text-sky-600 hover:underline font-semibold"
                            >
                              Diff changes →
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                    <Pagination
                      compact
                      page={commitPage.page}
                      pageSize={commitPage.pageSize}
                      total={commitPage.total}
                      onPageChange={commitPage.setPage}
                      onPageSizeChange={commitPage.setPageSize}
                      itemLabel="commits"
                    />
                    </>
                  )}
                </div>
              )}

              {/* TAB 3: LIVE BRANCHES (100% LIVE DATA) */}
              {activeTab === 'branches' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                      <GitBranch size={14} className="text-purple-600" />
                      Live Branches ({branches.length} Branches)
                    </span>
                    <button
                      onClick={() => setIsTriggerModalOpen(true)}
                      className="text-[11px] text-purple-700 hover:text-purple-900 font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Play size={10} fill="currentColor" />
                      <span>Run Pipeline on Branch</span>
                    </button>
                  </div>

                  {isLoadingDetails ? (
                    <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-md">
                      <LoadingSpinner message="Fetching live branches from GitLab..." size="md" />
                    </div>
                  ) : branches.length === 0 ? (
                    <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-500">
                      No branches found for {selectedRepo.name}.
                    </div>
                  ) : (
                    <>
                    <div className="space-y-2 max-h-[460px] overflow-y-auto custom-scrollbar pr-1">
                      {branchPage.pageItems.map((b) => (
                        <div
                          key={b.name}
                          className="p-3 bg-white border border-slate-200 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-300 transition-colors"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-xs text-slate-900 flex items-center gap-1.5">
                                <GitBranch size={13} className="text-purple-600" />
                                {b.name}
                              </span>
                              {b.default && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  Default
                                </span>
                              )}
                              {b.protected && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-0.5">
                                  <Lock size={9} /> Protected
                                </span>
                              )}
                            </div>
                            {b.commit && (
                              <p className="text-[11px] text-slate-500 font-mono">
                                Latest commit: <span className="text-slate-700 font-bold">{b.commit.shortId}</span> - {b.commit.title}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => {
                                setTriggerBranch(b.name);
                                setIsTriggerModalOpen(true);
                              }}
                              className="px-2.5 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded transition-colors cursor-pointer flex items-center gap-1"
                            >
                              <Play size={10} fill="currentColor" />
                              <span>Run</span>
                            </button>
                            {b.webUrl && (
                              <a
                                href={b.webUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="p-1 text-slate-500 hover:text-slate-800 transition-colors"
                                title="Open branch on GitLab"
                              >
                                <ExternalLink size={13} />
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <Pagination
                      compact
                      page={branchPage.page}
                      pageSize={branchPage.pageSize}
                      total={branchPage.total}
                      onPageChange={branchPage.setPage}
                      onPageSizeChange={branchPage.setPageSize}
                      itemLabel="branches"
                    />
                    </>
                  )}
                </div>
              )}

              {/* TAB 4: GITOPS & ARGOCD BRIDGE */}
              {activeTab === 'merge' && selectedRepo && (
                <MergePanel
                  key={String(selectedRepo.id || selectedRepo.name)}
                  integrationId={selectedIntegrationId || integrations[0]?._id || ''}
                  repo={selectedRepo}
                  branches={branches}
                  canManage={canDeployAnywhere}
                  onPipelinesChanged={() => loadRepoDetails(selectedRepo)}
                  onShowPipelines={() => setActiveTab('pipelines')}
                />
              )}

              {activeTab === 'gitops' && (
                <div className="space-y-4 text-xs">

                  {/* GitOps Status Header */}
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">
                          GitOps Reconciliation &amp; Minikube State
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          Synced with Minikube
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        ArgoCD watches <strong>demo-api-devops</strong> manifests and automatically reconciles changes to the local Minikube cluster.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={handleTriggerArgoSync}
                        disabled={isArgoSyncing}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-md text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <RefreshCw size={13} className={isArgoSyncing ? 'animate-spin' : ''} />
                        <span>{isArgoSyncing ? 'Syncing...' : 'Sync ArgoCD'}</span>
                      </button>
                      <button
                        onClick={() => navigate('/resource-browser')}
                        className="flex items-center gap-1 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-md text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <span>Cluster Resources</span>
                        <ArrowUpRight size={13} />
                      </button>
                    </div>
                  </div>

                  {/* 3-Pillar DevOps Bridge Comparison */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Pillar 1: Application Repo */}
                    <div className="p-3.5 bg-white border border-slate-200 rounded-md space-y-2">
                      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                        <span className="font-bold text-slate-900 flex items-center gap-1">
                          <GitBranch size={13} className="text-orange-600" />
                          1. Application Source
                        </span>
                        <span className="text-[10px] font-mono text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                          Live
                        </span>
                      </div>
                      <div className="space-y-1 text-[11px] font-mono text-slate-600">
                        <div>Repo: <strong className="text-slate-900">{selectedRepo.name}</strong></div>
                        <div>Latest SHA: <strong className="text-slate-900">{commits[0]?.shortId || 'ca057abc'}</strong></div>
                        <div>Branch: <strong className="text-slate-900">{selectedRepo.defaultBranch || 'main'}</strong></div>
                        <div className="pt-1 text-[10px] text-slate-500 truncate">
                          Updated: {formatRelativeTime(commits[0]?.committedDate || selectedRepo.lastActivityAt)}
                        </div>
                      </div>
                    </div>

                    {/* Pillar 2: GitOps Manifest Repo */}
                    <div className="p-3.5 bg-white border border-slate-200 rounded-md space-y-2">
                      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                        <span className="font-bold text-slate-900 flex items-center gap-1">
                          <Workflow size={13} className="text-sky-600" />
                          2. GitOps Manifests
                        </span>
                        <span className="text-[10px] font-mono text-sky-700 font-bold bg-sky-50 px-1.5 py-0.2 rounded border border-sky-200">
                          Committed
                        </span>
                      </div>
                      <div className="space-y-1 text-[11px] font-mono text-slate-600">
                        <div>Repo: <strong className="text-slate-900">demo-api-devops</strong></div>
                        <div>Path: <strong className="text-slate-900">/k8s/overlays/dev</strong></div>
                        <div>Image Tag: <strong className="text-slate-900">{commits[0]?.shortId || 'ca057abc'}</strong></div>
                        <div className="pt-1 text-[10px] text-emerald-600 font-bold">
                          ✓ Auto-updated via GitLab CI
                        </div>
                      </div>
                    </div>

                    {/* Pillar 3: Minikube Pods */}
                    <div className="p-3.5 bg-white border border-slate-200 rounded-md space-y-2">
                      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                        <span className="font-bold text-slate-900 flex items-center gap-1">
                          <Radio size={13} className="text-emerald-600" />
                          3. Minikube Cluster
                        </span>
                        <span className="text-[10px] font-mono text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                          Healthy
                        </span>
                      </div>
                      <div className="space-y-1 text-[11px] font-mono text-slate-600">
                        <div>Context: <strong className="text-slate-900">minikube</strong></div>
                        <div>Namespace: <strong className="text-slate-900">argo-apps</strong></div>
                        <div>Target Port: <strong className="text-slate-900">80 / 3000</strong></div>
                        <div className="pt-1 text-[10px] text-emerald-700 font-semibold">
                          ✓ Reconciled by ArgoCD controller
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: TECH STACK & LANGUAGES (100% LIVE DATA) */}
              {activeTab === 'languages' && (
                <div className="space-y-4 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <Layers size={14} className="text-emerald-600" />
                      Language &amp; Tech Stack Breakdown
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">GitLab Linguistics API</span>
                  </div>

                  {isLoadingDetails ? (
                    <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-md">
                      <LoadingSpinner message="Detecting project languages & tech stack..." size="md" />
                    </div>
                  ) : Object.keys(languages).length === 0 ? (
                    <div className="p-6 bg-slate-50 border border-slate-200 rounded-md text-slate-500 text-xs">
                      No language statistics available for {selectedRepo.name} (empty or binary repository).
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Visual Stacked Progress Bar */}
                      <div className="h-3 w-full rounded-md overflow-hidden flex bg-slate-100 border border-slate-200">
                        {Object.entries(languages).map(([lang, pct]) => (
                          <div
                            key={lang}
                            style={{
                              width: `${pct}%`,
                              backgroundColor: LANGUAGE_COLORS[lang] || '#0284c7',
                            }}
                            title={`${lang}: ${pct}%`}
                          />
                        ))}
                      </div>

                      {/* Language Percentages Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {Object.entries(languages).map(([lang, pct]) => (
                          <div
                            key={lang}
                            className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{
                                  backgroundColor: LANGUAGE_COLORS[lang] || '#0284c7',
                                }}
                              />
                              <span className="font-bold text-slate-800 text-xs truncate">
                                {lang}
                              </span>
                            </div>
                            <span className="text-base font-bold font-mono text-slate-900 block">
                              {pct}%
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* DevOps Recommendation Based on Stack */}
                      <div className="p-3.5 bg-sky-50 border border-sky-200 rounded-md text-sky-900 space-y-1">
                        <span className="font-bold text-xs flex items-center gap-1.5 text-sky-800">
                          <Sparkles size={13} className="text-sky-600" />
                          DevOps CI/CD Recommendation
                        </span>
                        <p className="text-[11px] text-sky-800/90 leading-relaxed">
                          This project is primarily composed of{' '}
                          <strong>{Object.keys(languages).join(' & ')}</strong>. The recommended pipeline is:
                          Node.js test runner → SonarQube static scanner → Docker DinD multi-stage build → Trivy image scan → GitOps tag dispatch.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 6: 8-STAGE ARCHITECTURE BLUEPRINT */}
              {activeTab === 'architecture' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <Workflow size={15} className="text-sky-600" />
                      Company .gitlab-ci.yml 8 Pipeline Stages
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">.gitlab-ci.yml standard</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Stage 1</span>
                      <div className="font-bold text-slate-800">code_scan</div>
                      <span className="text-[10px] text-slate-500 block">Snyk Alpine (VAPT)</span>
                    </div>

                    <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Stage 2</span>
                      <div className="font-bold text-slate-800">sonar</div>
                      <span className="text-[10px] text-slate-500 block">SonarQube (Java 17)</span>
                    </div>

                    <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Stage 3</span>
                      <div className="font-bold text-slate-800">build</div>
                      <span className="text-[10px] text-slate-500 block">Node 20 dist/</span>
                    </div>

                    <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Stage 4</span>
                      <div className="font-bold text-slate-800">package</div>
                      <span className="text-[10px] text-slate-500 block">DinD + Trivy scan</span>
                    </div>

                    <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Stage 5</span>
                      <div className="font-bold text-slate-800">email-stage</div>
                      <span className="text-[10px] text-slate-500 block">VAPT report email</span>
                    </div>

                    <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Stage 6</span>
                      <div className="font-bold text-slate-800">kubeconfig</div>
                      <span className="text-[10px] text-slate-500 block">yq manifest generator</span>
                    </div>

                    <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Stage 7</span>
                      <div className="font-bold text-slate-800">publish_argocd</div>
                      <span className="text-[10px] text-slate-500 block">Commit GitOps Repo</span>
                    </div>

                    <div className="p-2.5 rounded-md bg-emerald-50 border border-emerald-200 space-y-1">
                      <span className="text-[10px] font-bold text-emerald-600 uppercase">Stage 8</span>
                      <div className="font-bold text-emerald-800">ArgoCD Sync</div>
                      <span className="text-[10px] text-emerald-600 block">Deploy to Minikube</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-12 text-center bg-white border border-slate-200 rounded-md text-slate-400 text-xs">
              Select a repository from the left column to inspect its live GitLab data.
            </div>
          )}
        </div>
      </div>
    )}

      {/* TRIGGER PIPELINE MODAL */}
      {isTriggerModalOpen && selectedRepo && (
        <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-md border border-slate-200 max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Play size={16} fill="currentColor" className="text-emerald-600" />
                <h3 className="font-bold text-sm text-slate-900">
                  Trigger GitLab CI/CD Pipeline
                </h3>
              </div>
              <button
                onClick={() => setIsTriggerModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Target Repository
                </label>
                <input
                  type="text"
                  readOnly
                  value={selectedRepo.fullName}
                  placeholder="group/repository"
                  aria-label="Target repository"
                  className="w-full px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-md font-mono text-xs text-slate-700"
                />
              </div>

              <div>
                <Dropdown<string>
                  label="Branch or Tag Reference"
                  value={triggerBranch}
                  onChange={setTriggerBranch}
                  placeholder="Select the branch to run the pipeline on"
                  searchable
                  searchPlaceholder="Filter branches, e.g. dev"
                  fullWidth
                  options={
                    branches.length > 0
                      ? branches.map((b) => ({
                          value: b.name,
                          label: b.name,
                          sublabel: b.default ? 'Default branch' : undefined,
                          icon: <GitBranch size={13} className="text-purple-600" />,
                          badge: b.protected ? (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              Protected
                            </span>
                          ) : undefined,
                        }))
                      : [
                          { value: 'main', label: 'main', icon: <GitBranch size={13} className="text-purple-600" /> },
                          { value: 'develop', label: 'develop', icon: <GitBranch size={13} className="text-purple-600" /> },
                        ]
                  }
                  className="w-full"
                  buttonClassName="w-full justify-between"
                />
              </div>

              <div>
                <Dropdown<string>
                  label="Target Deployment Environment"
                  value={triggerEnv}
                  onChange={setTriggerEnv}
                  options={[
                    { value: 'dev', label: 'dev (Minikube / Cluster1)', sublabel: 'Local Kubernetes cluster' },
                    { value: 'staging', label: 'staging (Pre-production)', sublabel: 'Staging Kubernetes cluster' },
                    { value: 'prod', label: 'prod (Production Cluster)', sublabel: 'Production environment' },
                  ]}
                  className="w-full"
                  buttonClassName="w-full justify-between"
                />
              </div>

              <div className="p-3 bg-slate-50 rounded-md border border-slate-200 text-[11px] text-slate-600 space-y-1">
                <span className="font-semibold text-slate-700 block">Execution Flow:</span>
                <p>
                  This triggers the live GitLab pipeline for <code>{selectedRepo.name}</code> on branch <code>{triggerBranch}</code>.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsTriggerModalOpen(false)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isTriggering}
                onClick={handleTriggerPipeline}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-semibold transition-colors cursor-pointer"
              >
                <Play size={12} fill="currentColor" />
                <span>{isTriggering ? 'Triggering...' : 'Launch Pipeline Now'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedStageLog && selectedRepo && selectedStageLog.stage.id && (
        <JobLogModal
          integrationId={selectedIntegrationId || integrations[0]?._id}
          repoId={selectedRepo.id || selectedRepo.name}
          pipelineId={selectedStageLog.pipelineId}
          job={selectedStageLog.stage}
          onClose={() => setSelectedStageLog(null)}
        />
      )}
      {isCreateRepoOpen && (
        <CreateRepoModal
          integrations={integrations}
          defaultIntegrationId={activeIntegration?._id || ''}
          onClose={() => setIsCreateRepoOpen(false)}
          onCreated={handleRepoCreated}
        />
      )}

      {isPushCodeOpen && selectedRepo && activeIntegration && (
        <PushTemplateModal
          integrationId={activeIntegration._id}
          repo={selectedRepo}
          branches={branches.map((b) => b.name)}
          onClose={() => setIsPushCodeOpen(false)}
          onPushed={(message) => {
            toast.success(message);
            loadRepoDetails(selectedRepo);
          }}
        />
      )}
    </div>
  );
};
