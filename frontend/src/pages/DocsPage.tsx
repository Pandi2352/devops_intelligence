import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  Construction,
  Copy,
  AlertTriangle,
  RefreshCw,
  Route,
  Map as MapIcon,
} from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Button } from '../components/common/Button';
import api from '../api/client';
import { ObservabilityConnector, observabilityApi } from '../api/observabilityApi';
import { clusterApi } from '../api/clusterApi';
import { gitApi } from '../api/gitApi';
import { argoApi } from '../api/argoApi';
import { approvalApi } from '../api/approvalApi';
import { gitlabStatus } from '../components/connectors/gitlabStatus';
import {
  BUILD_ORDER,
  GUIDE_STEPS,
  GuideCommand,
  GuideStep,
  GuideStepId,
  PIPELINE_STAGES,
  ROADMAP,
  RoadmapStatus,
  THREE_REPOS,
} from '../data/kubeorbitGuide';
import { ApprovalRequest, ArgoApplication, ArgoIntegration, Cluster, GitIntegration, GitRepo, PipelineRun } from '../types';

interface ProjectSummary {
  _id: string;
  name: string;
  gitLabRepos: { name: string; repoUrl: string }[];
  kubernetesMappings: { clusterName: string; namespaces: string[] }[];
  argoApps: { appName: string }[];
}

interface UserSummary {
  _id: string;
  email: string;
  role: string;
  directPermissions?: { project: string; permission: string }[];
}

interface Snapshot {
  clusters: Cluster[];
  gitlab: GitIntegration[];
  argo: ArgoIntegration[];
  argoApps: ArgoApplication[];
  projects: ProjectSummary[];
  users: UserSummary[];
  approvals: ApprovalRequest[];
  repos: GitRepo[];
  mappedRepo: { project: string; repo: GitRepo } | null;
  pipelines: PipelineRun[];
  observability: ObservabilityConnector[];
}

type StepStatus = 'done' | 'attention' | 'todo' | 'blocked' | 'planned';

interface StepState {
  status: StepStatus;
  detail: string;
}

const normalizeRepoUrl = (url?: string) => (url || '').trim().toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');

const settled = async <T,>(promise: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await promise;
  } catch {
    return fallback;
  }
};

// Collects everything the step checks need. Failures degrade to empty data instead of breaking the page.
const loadSnapshot = async (): Promise<Snapshot> => {
  const [clusters, integrations, argo, argoApps, projects, users, approvals, observability] = await Promise.all([
    settled(clusterApi.getAll(), [] as Cluster[]),
    settled(gitApi.getAll(), [] as GitIntegration[]),
    settled(argoApi.getConnectors(), [] as ArgoIntegration[]),
    settled(argoApi.getApplications(), [] as ArgoApplication[]),
    settled(api.get('/projects').then((r) => r.data.projects as ProjectSummary[]), []),
    settled(api.get('/auth/users').then((r) => r.data.users as UserSummary[]), []),
    settled(approvalApi.getAll(), [] as ApprovalRequest[]),
    settled(observabilityApi.connectors(), [] as ObservabilityConnector[]),
  ]);

  const gitlab = integrations.filter((g) => g.provider === 'gitlab');
  const connector = gitlab.find((g) => g.isDefault && g.isActive) || gitlab.find((g) => g.isActive);
  const repos = connector ? await settled(gitApi.getRepos(connector._id), [] as GitRepo[]) : [];

  // A project counts as "real" once one of its repo URLs matches a repo the GitLab connector can see.
  let mappedRepo: Snapshot['mappedRepo'] = null;
  for (const project of projects) {
    for (const mapping of project.gitLabRepos || []) {
      const wanted = normalizeRepoUrl(mapping.repoUrl);
      const repo = repos.find((r) => normalizeRepoUrl(r.cloneUrl) === wanted || normalizeRepoUrl(r.htmlUrl) === wanted);
      if (repo) {
        mappedRepo = { project: project.name, repo };
        break;
      }
    }
    if (mappedRepo) break;
  }

  const pipelines =
    connector && mappedRepo ? await settled(gitApi.getPipelines(connector._id, mappedRepo.repo.id), [] as PipelineRun[]) : [];

  return { clusters, observability, gitlab, argo, argoApps, projects, users, approvals, repos, mappedRepo, pipelines };
};

const evaluate = (id: GuideStepId, s: Snapshot): StepState => {
  switch (id) {
    case 'cluster': {
      const healthy = s.clusters.filter((c) => c.status === 'Healthy');
      if (healthy.length) return { status: 'done', detail: `${healthy.map((c) => c.name).join(', ')} reachable (${healthy[0].version}).` };
      if (s.clusters.length) return { status: 'attention', detail: 'Clusters are registered but none is reachable. Is Minikube running?' };
      return { status: 'todo', detail: 'No clusters registered yet.' };
    }
    case 'gitlab': {
      const ok = s.gitlab.find((g) => gitlabStatus(g) === 'Connected');
      if (ok) return { status: 'done', detail: `Connected as @${ok.username} (${ok.name}).` };
      if (s.gitlab.length) return { status: 'attention', detail: 'A connector exists but is not verified. Test it from Connectors → GitLab.' };
      return { status: 'todo', detail: 'No GitLab connector yet.' };
    }
    case 'argocd': {
      const ok = s.argo.find((a) => a.status === 'Connected');
      if (ok) return { status: 'done', detail: `${ok.name} connected (${ok.version}).` };
      const broken = s.argo[0];
      if (broken) return { status: 'attention', detail: `${broken.name} (${broken.serverUrl}) is not reachable${broken.lastError ? `: ${broken.lastError}` : '.'}` };
      return { status: 'todo', detail: 'No ArgoCD instance connected.' };
    }
    case 'project': {
      if (s.mappedRepo) return { status: 'done', detail: `Project "${s.mappedRepo.project}" maps ${s.mappedRepo.repo.fullName}.` };
      if (s.projects.length) {
        return {
          status: 'attention',
          detail: `${s.projects.map((p) => p.name).join(', ')} exist, but their repo URLs are not in your GitLab connector (example data). Map a real repo${s.repos[0] ? `, e.g. ${s.repos[0].cloneUrl}` : ''}.`,
        };
      }
      return { status: 'todo', detail: 'No projects yet.' };
    }
    case 'team': {
      const granted = s.users.filter((u) => u.role !== 'superadmin' && (u.directPermissions?.length || 0) > 0);
      if (granted.length) return { status: 'done', detail: `${granted.length} team member(s) have project permissions.` };
      if (s.users.length > 1) return { status: 'attention', detail: 'Team members exist but none has a project permission.' };
      return { status: 'todo', detail: 'Only the admin account exists.' };
    }
    case 'pipeline': {
      if (!s.mappedRepo) return { status: 'todo', detail: 'Map a real repository to a project first.' };
      const last = s.pipelines[0];
      if (last) return { status: last.status === 'failed' ? 'attention' : 'done', detail: `Latest pipeline #${last.id} on ${last.ref}: ${last.status}.` };
      return { status: 'todo', detail: `No pipelines yet for ${s.mappedRepo.repo.name}.` };
    }
    case 'gitops': {
      if (s.argoApps.length) return { status: 'done', detail: `${s.argoApps.length} ArgoCD application(s) found.` };
      return { status: 'todo', detail: 'ArgoCD has no applications yet.' };
    }
    case 'approvals': {
      if (s.approvals.length) return { status: 'done', detail: `${s.approvals.length} request(s) in the queue history.` };
      return { status: 'todo', detail: 'No approval requests yet.' };
    }
    case 'observability': {
      const prom = s.observability.find((c) => c.kind === 'prometheus' && c.status === 'Connected');
      const loki = s.observability.some((c) => c.kind === 'loki');
      if (prom) return { status: 'done', detail: `${prom.name} connected${loki ? ', Loki connected' : '; add Loki for log history'}.` };
      if (s.observability.length) return { status: 'attention', detail: 'An observability connector is failing its test.' };
      return { status: 'todo', detail: 'Live logs already work. Add Prometheus in Connectors → Observability for metrics.' };
    }
  }
};

const STATUS_META: Record<StepStatus, { label: string; badge: string; icon: React.ReactNode }> = {
  done: { label: 'Done', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <CheckCircle2 size={16} className="text-emerald-600" /> },
  attention: { label: 'Needs attention', badge: 'bg-amber-50 text-amber-800 border-amber-200', icon: <AlertTriangle size={16} className="text-amber-600" /> },
  todo: { label: 'To do', badge: 'bg-sky-50 text-sky-700 border-sky-200', icon: <Circle size={16} className="text-sky-500" /> },
  blocked: { label: 'Waiting', badge: 'bg-slate-100 text-slate-600 border-slate-200', icon: <Clock size={16} className="text-slate-400" /> },
  planned: { label: 'Not built yet', badge: 'bg-violet-50 text-violet-700 border-violet-200', icon: <Construction size={16} className="text-violet-500" /> },
};

const ROADMAP_META: Record<RoadmapStatus, { label: string; badge: string }> = {
  done: { label: 'Done', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  partial: { label: 'In progress', badge: 'bg-amber-50 text-amber-800 border-amber-200' },
  'not-started': { label: 'Not started', badge: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

const CodeBlock: React.FC<{ command: GuideCommand }> = ({ command }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800 text-[11px]">
        <span className="text-slate-300 font-medium">{command.label}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
          aria-label={`Copy: ${command.label}`}
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 text-[11px] leading-relaxed text-slate-100 font-mono overflow-x-auto whitespace-pre">{command.code}</pre>
    </div>
  );
};

interface StepCardProps {
  step: GuideStep;
  index: number;
  state: StepState | undefined;
  isOpen: boolean;
  isNext: boolean;
  waitingOn: number[];
  onToggle: () => void;
}

const StepCard: React.FC<StepCardProps> = ({ step, index, state, isOpen, isNext, waitingOn, onToggle }) => {
  const status: StepStatus = state?.status ?? 'todo';
  const meta = STATUS_META[status];
  const panelId = `step-panel-${step.id}`;

  return (
    <section
      id={`step-${step.id}`}
      className={`scroll-mt-4 bg-white border rounded-md ${isNext ? 'border-sky-500 ring-1 ring-sky-500' : 'border-slate-200'}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="w-full flex items-start gap-3 p-4 text-left cursor-pointer hover:bg-slate-50/60"
      >
        <span
          className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
            status === 'done' ? 'bg-emerald-600 text-white' : isNext ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {status === 'done' ? <Check size={14} /> : index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-900">{step.title}</h3>
            <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${meta.badge}`}>{meta.label}</span>
            {isNext && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-600 text-white">Your next step</span>}
          </div>
          <p className="text-xs text-slate-600 mt-1">{state ? state.detail : 'Checking…'}</p>
          {waitingOn.length > 0 && status !== 'done' && (
            <p className="text-[11px] text-slate-500 mt-0.5">Finish step {waitingOn.join(' and ')} first.</p>
          )}
        </div>
        <ChevronDown size={16} className={`shrink-0 mt-1 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {isOpen && (
        <div id={panelId} className="px-4 pb-4 pl-14 space-y-4 text-xs text-slate-700">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Goal</div>
              <p>{step.goal}</p>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Why it matters</div>
              <p>{step.why}</p>
            </div>
          </div>

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">What to do</div>
            <ol className="space-y-1.5 list-decimal pl-4 marker:text-slate-400 marker:font-semibold">
              {step.actions.map((action) => (
                <li key={action} className="pl-1 leading-relaxed">
                  {action}
                </li>
              ))}
            </ol>
          </div>

          {step.commands && (
            <div className="space-y-2">
              {step.commands.map((cmd) => (
                <CodeBlock key={cmd.label} command={cmd} />
              ))}
            </div>
          )}

          {step.platformGap && (
            <div className="p-2.5 rounded-md border border-violet-200 bg-violet-50 text-violet-900 flex items-start gap-2">
              <Construction size={14} className="shrink-0 mt-px text-violet-500" aria-hidden />
              <span>
                <strong className="font-semibold">Current limitation:</strong> {step.platformGap}
              </span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-slate-500">
              Workflow stage: <span className="font-medium text-slate-700">{step.workflowRef}</span>
            </span>
            {step.link && (
              <Link
                to={step.link.to}
                className="inline-flex items-center gap-1.5 self-start sm:self-auto px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-700 text-white font-semibold"
              >
                {step.link.label}
                <ArrowRight size={13} aria-hidden />
              </Link>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export const DocsPage: React.FC = () => {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const [open, setOpen] = useState<Set<GuideStepId>>(new Set());
  const [initialised, setInitialised] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setSnapshot(await loadSnapshot());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const states = useMemo(() => {
    const result = new Map<GuideStepId, StepState>();
    if (!snapshot) return result;
    GUIDE_STEPS.forEach((step) => result.set(step.id, evaluate(step.id, snapshot)));
    return result;
  }, [snapshot]);

  const indexOf = (id: GuideStepId) => GUIDE_STEPS.findIndex((s) => s.id === id);
  const pendingDeps = (step: GuideStep) =>
    (step.dependsOn || []).filter((d) => states.get(d)?.status !== 'done').map((d) => indexOf(d) + 1);

  // Next step: first unfinished step whose prerequisites are done.
  const nextStep = useMemo(() => {
    if (!snapshot) return undefined;
    return GUIDE_STEPS.find((step) => {
      const status = states.get(step.id)?.status;
      return (status === 'attention' || status === 'todo') && (step.dependsOn || []).every((d) => states.get(d)?.status === 'done');
    });
  }, [snapshot, states]);

  // Open the next step and anything needing attention once the first check completes.
  if (snapshot && !initialised) {
    const initial = new Set<GuideStepId>();
    if (nextStep) initial.add(nextStep.id);
    GUIDE_STEPS.forEach((s) => states.get(s.id)?.status === 'attention' && initial.add(s.id));
    setOpen(initial);
    setInitialised(true);
  }

  const doneCount = GUIDE_STEPS.filter((s) => states.get(s.id)?.status === 'done').length;
  const percent = Math.round((doneCount / GUIDE_STEPS.length) * 100);

  const toggle = (id: GuideStepId) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const goToStep = (id: GuideStepId) => {
    setOpen((prev) => new Set(prev).add(id));
    requestAnimationFrame(() => scrollToId(`step-${id}`));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Getting Started"
        description="Step-by-step setup for KubeOrbit, following the company GitLab CI → ArgoCD → Kubernetes workflow. Each step is checked live against your environment."
        actions={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => navigate('/guide')} leftIcon={<BookOpen size={13} />}>
              Full user guide
            </Button>
            <Button variant="secondary" size="sm" onClick={refresh} isLoading={isLoading} leftIcon={<RefreshCw size={13} />}>
              Re-check
            </Button>
          </div>
        }
      />

      <div className="bg-white border border-slate-200 rounded-md p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Setup progress</div>
            <div className="text-lg font-bold text-slate-900">
              {snapshot ? `${doneCount} of ${GUIDE_STEPS.length} steps done` : 'Checking your environment…'}
            </div>
          </div>
          {nextStep && (
            <div className="flex items-center gap-3 p-3 rounded-md bg-sky-50 border border-sky-200 md:max-w-lg">
              <Route size={18} className="text-sky-600 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold text-sky-700 uppercase tracking-wider">Your next step</div>
                <div className="text-xs font-semibold text-slate-900">
                  {indexOf(nextStep.id) + 1}. {nextStep.title}
                </div>
              </div>
              <Button size="sm" onClick={() => goToStep(nextStep.id)} rightIcon={<ArrowRight size={13} />}>
                Show me
              </Button>
            </div>
          )}
        </div>
        <div
          className="h-2 rounded-full bg-slate-100 overflow-hidden"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Setup progress"
        >
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-5 items-start">
        <nav aria-label="Guide contents" className="hidden lg:block sticky top-0 bg-white border border-slate-200 rounded-md p-3 text-xs">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-1.5 mb-1.5">Setup steps</div>
          <ul className="space-y-0.5">
            {GUIDE_STEPS.map((step, i) => {
              const status = states.get(step.id)?.status;
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    onClick={() => goToStep(step.id)}
                    className={`w-full flex items-center gap-2 px-1.5 py-1 rounded text-left cursor-pointer hover:bg-slate-100 ${
                      nextStep?.id === step.id ? 'text-sky-700 font-semibold' : 'text-slate-700'
                    }`}
                  >
                    <span className="shrink-0">{status ? STATUS_META[status].icon : <Circle size={16} className="text-slate-300" />}</span>
                    <span className="truncate">
                      {i + 1}. {step.title}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-1.5 mt-3 mb-1.5">Reference</div>
          <ul className="space-y-0.5">
            <li>
              <button type="button" onClick={() => scrollToId('how-it-works')} className="w-full flex items-center gap-2 px-1.5 py-1 rounded text-left text-slate-700 hover:bg-slate-100 cursor-pointer">
                <BookOpen size={14} className="text-slate-400" /> How delivery works
              </button>
            </li>
            <li>
              <button type="button" onClick={() => scrollToId('roadmap')} className="w-full flex items-center gap-2 px-1.5 py-1 rounded text-left text-slate-700 hover:bg-slate-100 cursor-pointer">
                <MapIcon size={14} className="text-slate-400" /> Roadmap & what's next
              </button>
            </li>
          </ul>
        </nav>

        <div className="space-y-8 min-w-0">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-bold text-slate-900">Setup steps</h2>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setOpen(new Set(GUIDE_STEPS.map((s) => s.id)))}>
                  Expand all
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(new Set())}>
                  Collapse all
                </Button>
              </div>
            </div>
            {GUIDE_STEPS.map((step, i) => (
              <StepCard
                key={step.id}
                step={step}
                index={i}
                state={states.get(step.id)}
                isOpen={open.has(step.id)}
                isNext={nextStep?.id === step.id}
                waitingOn={snapshot ? pendingDeps(step) : []}
                onToggle={() => toggle(step.id)}
              />
            ))}
          </div>

          <section id="how-it-works" className="scroll-mt-4 space-y-3">
            <h2 className="text-base font-bold text-slate-900">How delivery works</h2>
            <p className="text-xs text-slate-600 max-w-3xl">
              CI and CD are separate. GitLab CI never runs <code className="font-mono">kubectl apply</code>: it builds and scans the image, renders the
              manifest with yq and commits it to the GitOps repo. ArgoCD watches that repo and makes the cluster match it.
            </p>

            <ol className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold" aria-label="Delivery flow">
              {['git push', 'GitLab CI', 'Container registry', 'GitOps repo', 'ArgoCD', 'Kubernetes', 'Prometheus / Loki'].map((node, i, all) => (
                <li key={node} className="flex items-center gap-1.5">
                  <span className="px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-800">{node}</span>
                  {i < all.length - 1 && <ArrowRight size={12} className="text-slate-400" aria-hidden />}
                </li>
              ))}
            </ol>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {THREE_REPOS.map((repo) => (
                <div key={repo.name} className="p-3 bg-white border border-slate-200 rounded-md text-xs space-y-1">
                  <div className="font-semibold text-slate-900">{repo.name}</div>
                  <div className="font-mono text-[11px] text-sky-700 break-all">{repo.example}</div>
                  <p className="text-slate-600">{repo.holds}</p>
                </div>
              ))}
            </div>

            <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">GitLab CI pipeline stages</caption>
                  <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th scope="col" className="px-4 py-2.5">#</th>
                      <th scope="col" className="px-4 py-2.5">Stage</th>
                      <th scope="col" className="px-4 py-2.5">Tool</th>
                      <th scope="col" className="px-4 py-2.5">What it does</th>
                      <th scope="col" className="px-4 py-2.5">Where to see it</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {PIPELINE_STAGES.map((st, i) => (
                      <tr key={st.stage}>
                        <td className="px-4 py-2.5 text-slate-400 font-mono">{i + 1}</td>
                        <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">{st.stage}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">{st.tool}</td>
                        <td className="px-4 py-2.5 min-w-[240px]">{st.purpose}</td>
                        <td className="px-4 py-2.5 text-slate-500 min-w-[180px]">{st.inKubeOrbit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section id="roadmap" className="scroll-mt-4 space-y-3">
            <h2 className="text-base font-bold text-slate-900">Roadmap & what's next</h2>
            <p className="text-xs text-slate-600 max-w-3xl">
              Where each sprint from the project plan really stands, and the order to build the missing pieces. Items marked "Current
              limitation" in the steps above are covered here.
            </p>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {ROADMAP.map((item) => (
                <div key={item.sprint} className="p-4 bg-white border border-slate-200 rounded-md text-xs space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{item.sprint}</div>
                      <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                    </div>
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${ROADMAP_META[item.status].badge}`}>
                      {ROADMAP_META[item.status].label}
                    </span>
                  </div>
                  {item.done.length > 0 && (
                    <ul className="space-y-1">
                      {item.done.map((d) => (
                        <li key={d} className="flex items-start gap-1.5">
                          <Check size={13} className="text-emerald-600 shrink-0 mt-px" aria-label="Done" />
                          <span>{d}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.remaining.length > 0 && (
                    <ul className="space-y-1">
                      {item.remaining.map((r) => (
                        <li key={r} className="flex items-start gap-1.5 text-slate-600">
                          <Circle size={11} className="text-slate-400 shrink-0 mt-0.5" aria-label="To do" />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>

            <div className="p-4 bg-white border border-slate-200 rounded-md text-xs">
              <h3 className="text-sm font-semibold text-slate-900 mb-2.5">Recommended build order</h3>
              <ol className="space-y-2">
                {BUILD_ORDER.map((item, i) => (
                  <li key={item.title} className="flex items-start gap-2.5">
                    <span className="w-5 h-5 shrink-0 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <div>
                      <div className="font-semibold text-slate-900">{item.title}</div>
                      <p className="text-slate-600">{item.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
