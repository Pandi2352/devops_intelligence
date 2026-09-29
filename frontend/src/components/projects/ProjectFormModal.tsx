import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, FolderGit2, FolderKanban, Layers, Loader2, Server, XCircle } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Dropdown, DropdownOption } from '../common/Dropdown';
import { FormField, TextArea, TextInput } from '../common/Form';
import { EnvironmentRowsEditor } from './EnvironmentRowsEditor';
import { useForm, FormErrors } from '../../hooks/useForm';
import { GitBranch, GitopsLayout, gitApi } from '../../api/gitApi';
import { clusterApi } from '../../api/clusterApi';
import { NamespaceInfo, observabilityApi } from '../../api/observabilityApi';
import { getApiErrorMessage } from '../../api/client';
import { Project, appRepoOf, clusterOf, gitopsRepoOf, projectApi } from '../../api/projectApi';
import { Cluster, GitIntegration, GitRepo } from '../../types';
import { EnvRow, STANDARD_ENVS, newEnvRow, validateEnvRows } from '../../utils/projectWizard';
import { sortEnvironments } from '../../utils/project';

type Values = {
  name: string;
  description: string;
  connectorId: string;
  appRepoUrl: string;
  appDefaultBranch: string;
  gitopsRepoUrl: string;
  gitopsPath: string;
  clusterName: string;
};

interface ProjectFormModalProps {
  project: Project | null; // null = create
  onClose: () => void;
  onSaved: (project: Project, message: string, opts?: { openAddEnvironment?: boolean }) => void;
}

type ProgressItem = { label: string; status: 'pending' | 'running' | 'done' | 'failed'; detail?: string };

const PROJECT_NAME = /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/;
const DEFAULT_OVERLAYS = 'k8s/overlays';
const normalize = (url: string) => url.trim().replace(/\.git$/, '').toLowerCase();

const STEPS: { title: string; hint: string }[] = [
  { title: 'Basics', hint: 'Name and description' },
  { title: 'Code & GitOps', hint: 'Repositories, branch, overlay folder' },
  { title: 'Cluster & environments', hint: 'Where each environment runs' },
  { title: 'Review', hint: 'Check and create' },
];

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <section className="space-y-3">
    <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-600">
      {icon}
      {title}
    </h3>
    {children}
  </section>
);

export const ProjectFormModal: React.FC<ProjectFormModalProps> = ({ project, onClose, onSaved }) => {
  const isEdit = Boolean(project);
  const [step, setStep] = useState(0);
  const [connectors, setConnectors] = useState<GitIntegration[]>([]);
  const [repos, setRepos] = useState<GitRepo[] | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [branches, setBranches] = useState<GitBranch[] | null>(null);
  const [layout, setLayout] = useState<GitopsLayout | null>(null);
  const [namespaces, setNamespaces] = useState<NamespaceInfo[]>([]);
  const [envRows, setEnvRows] = useState<EnvRow[] | null>(null);
  const [envErrors, setEnvErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [progress, setProgress] = useState<ProgressItem[] | null>(null);
  const [created, setCreated] = useState<Project | null>(null);
  const [takenApps, setTakenApps] = useState<Map<string, string>>(new Map()); // ArgoCD app -> owning project

  const validate = (v: Values): FormErrors<Values> => {
    const errors: FormErrors<Values> = {};
    if (!isEdit && !PROJECT_NAME.test(v.name.trim())) errors.name = 'Use 1-50 lowercase letters, numbers or dashes (e.g. payments)';
    if (!v.appRepoUrl) errors.appRepoUrl = 'Pick the repository that holds the application code';
    if (!v.gitopsRepoUrl) errors.gitopsRepoUrl = 'Pick the repository that holds the Kubernetes manifests';
    else if (normalize(v.gitopsRepoUrl) === normalize(v.appRepoUrl)) errors.gitopsRepoUrl = 'Use a separate repository for the manifests';
    if (!v.clusterName) errors.clusterName = 'Pick the cluster this project deploys to';
    return errors;
  };

  const { values, errors, setValue, validateFields, isDirty } = useForm<Values>(
    {
      name: project?.name ?? '',
      description: project?.description ?? '',
      connectorId: '',
      appRepoUrl: project ? appRepoOf(project)?.repoUrl ?? '' : '',
      appDefaultBranch: project ? appRepoOf(project)?.branch ?? '' : '',
      gitopsRepoUrl: project ? gitopsRepoOf(project)?.repoUrl ?? '' : '',
      gitopsPath: project?.gitopsPath || '',
      clusterName: project ? clusterOf(project) : '',
    },
    validate
  );

  // ---------------------------------------------------------------- data for the dropdowns
  useEffect(() => {
    Promise.all([gitApi.getAll(), clusterApi.getAll()])
      .then(([git, cl]) => {
        const active = git.filter((g) => g.isActive && g.provider === 'gitlab');
        setConnectors(active);
        setClusters(cl);
        const preferred = active.find((g) => g.isDefault) || active[0];
        if (preferred) setValue('connectorId', preferred._id);
        else setRepos([]);
        if (!project && !values.clusterName) {
          const def = cl.find((c) => c.isDefault) || cl[0];
          if (def) setValue('clusterName', def.name);
        }
      })
      .catch((err) => setLoadError(getApiErrorMessage(err, 'Could not load connectors')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!values.connectorId) return;
    setRepos(null);
    gitApi
      .getRepos(values.connectorId)
      .then(setRepos)
      .catch((err) => {
        setRepos([]);
        setLoadError(getApiErrorMessage(err, 'Could not load repositories'));
      });
  }, [values.connectorId]);

  const repoFor = (url: string) => (repos || []).find((r) => normalize(r.cloneUrl) === normalize(url) || normalize(r.htmlUrl) === normalize(url));
  const appRepo = repoFor(values.appRepoUrl);
  const gitopsRepo = repoFor(values.gitopsRepoUrl);

  useEffect(() => {
    if (!appRepo || !values.connectorId) {
      setBranches(null);
      return;
    }
    setBranches(null);
    gitApi
      .getBranches(values.connectorId, appRepo.id)
      .then((b) => {
        setBranches(b as GitBranch[]);
        if (!values.appDefaultBranch) setValue('appDefaultBranch', appRepo.defaultBranch || (b as GitBranch[]).find((x) => x.default)?.name || 'main');
      })
      .catch(() => setBranches([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appRepo?.id, values.connectorId]);

  useEffect(() => {
    if (!gitopsRepo || !values.connectorId) {
      setLayout(null);
      return;
    }
    setLayout(null);
    gitApi
      .getGitopsLayout(values.connectorId, gitopsRepo.id)
      .then((l) => {
        setLayout(l);
        if (!values.gitopsPath) setValue('gitopsPath', l.overlayBases[0]?.path || DEFAULT_OVERLAYS);
      })
      .catch(() => setLayout({ empty: false, overlayBases: [], kustomizations: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitopsRepo?.id, values.connectorId]);

  useEffect(() => {
    observabilityApi
      .scopes()
      .then((s) => setTakenApps(new Map(s.projects.flatMap((p) => p.environments.map((e) => [e.appName, p.name] as [string, string])))))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!values.clusterName) return;
    observabilityApi
      .namespaces(values.clusterName)
      .then((r) => setNamespaces(r.namespaces))
      .catch(() => setNamespaces([]));
  }, [values.clusterName]);

  const overlayEnvs = useMemo(
    () => layout?.overlayBases.find((b) => b.path === (values.gitopsPath || DEFAULT_OVERLAYS))?.environments || [],
    [layout, values.gitopsPath]
  );

  // ---------------------------------------------------------------- dropdown options
  const repoOptions: DropdownOption[] = useMemo(() => {
    const options: DropdownOption[] = (repos || []).map((r) => ({ value: r.cloneUrl, label: r.fullName, sublabel: `${r.defaultBranch}${r.private ? ' · private' : ''}` }));
    for (const url of [values.appRepoUrl, values.gitopsRepoUrl]) {
      if (url && !options.some((o) => normalize(o.value) === normalize(url))) options.unshift({ value: url, label: url, sublabel: 'saved' });
    }
    return options;
  }, [repos, values.appRepoUrl, values.gitopsRepoUrl]);
  const selected = (url: string) => repoOptions.find((o) => normalize(o.value) === normalize(url))?.value ?? url;

  const branchOptions: DropdownOption[] = (branches || []).map((b) => ({
    value: b.name,
    label: b.name,
    sublabel: [b.default && 'default', b.protected && 'protected', b.commit?.title].filter(Boolean).join(' · '),
  }));
  if (values.appDefaultBranch && !branchOptions.some((o) => o.value === values.appDefaultBranch)) {
    branchOptions.unshift({ value: values.appDefaultBranch, label: values.appDefaultBranch, sublabel: 'saved' });
  }

  const gitopsPathOptions: DropdownOption[] = [
    ...(layout?.overlayBases || []).map((b) => ({ value: b.path, label: b.path, sublabel: `overlays: ${b.environments.join(', ')}` })),
    ...(!layout?.overlayBases.some((b) => b.path === DEFAULT_OVERLAYS) ? [{ value: DEFAULT_OVERLAYS, label: DEFAULT_OVERLAYS, sublabel: 'created with the first environment' }] : []),
  ];
  if (values.gitopsPath && !gitopsPathOptions.some((o) => o.value === values.gitopsPath)) {
    gitopsPathOptions.unshift({ value: values.gitopsPath, label: values.gitopsPath, sublabel: 'saved' });
  }

  const clusterOptions: DropdownOption[] = clusters.map((c) => ({ value: c.name, label: c.name, sublabel: `${c.type}${c.status ? ` · ${c.status}` : ''}` }));
  if (values.clusterName && !clusterOptions.some((o) => o.value === values.clusterName)) {
    clusterOptions.unshift({ value: values.clusterName, label: values.clusterName, sublabel: 'not found in connectors' });
  }

  // First visit to the environments step: suggest what the repos already have, else just the first branch.
  const suggestRows = () => {
    if (envRows) return;
    const branchNames = (branches || []).map((b) => b.name);
    const existing = sortEnvironments(STANDARD_ENVS.filter((e) => branchNames.includes(e) || overlayEnvs.includes(e)), (n) => n);
    const first = /^[a-z][a-z0-9-]{0,19}$/.test(values.appDefaultBranch) && !['main', 'master'].includes(values.appDefaultBranch) ? values.appDefaultBranch : 'dev';
    const names = existing.length ? existing : [first];
    setEnvRows(names.map((n) => newEnvRow(n, values.name.trim(), values.appDefaultBranch || 'main')));
  };

  // <app-repo>-<env>, unless another project already owns that ArgoCD app: then <project>-<env>.
  const appNameFor = (env: string) => {
    const repoName = (appRepo?.fullName || values.appRepoUrl).split('/').pop()?.replace(/\.git$/, '') || values.name.trim();
    const preferred = `${repoName}-${env}`;
    const owner = takenApps.get(preferred);
    return owner && owner !== values.name.trim() ? `${values.name.trim()}-${env}` : preferred;
  };

  // ---------------------------------------------------------------- navigation
  const stepFields: (keyof Values)[][] = [['name'], ['appRepoUrl', 'gitopsRepoUrl'], ['clusterName'], []];
  const next = () => {
    if (!validateFields(stepFields[step])) return;
    if (step === 1) suggestRows();
    if (step === 2) {
      const errs = validateEnvRows(envRows || [], namespaces, values.name.trim());
      setEnvErrors(errs);
      if (Object.keys(errs).length) return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const baseInput = () => ({
    description: values.description.trim(),
    appRepoUrl: values.appRepoUrl,
    appDefaultBranch: values.appDefaultBranch || 'main',
    gitopsRepoUrl: values.gitopsRepoUrl,
    gitopsPath: values.gitopsPath || DEFAULT_OVERLAYS,
    clusterName: values.clusterName,
  });

  const saveEdit = async () => {
    if (!validateFields()) return;
    setIsSaving(true);
    setFormError(null);
    try {
      const result = await projectApi.update(project!._id, baseInput());
      onSaved(result.project, result.message);
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Could not save the project'));
    } finally {
      setIsSaving(false);
    }
  };

  // Create the project, then provision each environment one by one, showing progress.
  const create = async () => {
    if (!validateFields()) return;
    const rows = envRows || [];
    setIsSaving(true);
    setFormError(null);
    const items: ProgressItem[] = [
      { label: `Create project ${values.name.trim()}`, status: 'running' },
      ...rows.map((r) => ({ label: `Set up ${r.name} (${r.namespace})`, status: 'pending' as const })),
    ];
    setProgress([...items]);
    let proj: Project;
    try {
      proj = (await projectApi.create({ ...baseInput(), name: values.name.trim() })).project;
      items[0] = { ...items[0], status: 'done' };
      setProgress([...items]);
      setCreated(proj);
    } catch (err) {
      items[0] = { ...items[0], status: 'failed', detail: getApiErrorMessage(err, 'Could not create the project') };
      setProgress([...items]);
      setIsSaving(false);
      return;
    }
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      items[i + 1] = { ...items[i + 1], status: 'running' };
      setProgress([...items]);
      try {
        const branchExists = (branches || []).some((b) => b.name === r.name);
        const res = await projectApi.addEnvironment(proj._id, {
          name: r.name,
          namespace: r.namespace,
          appName: appNameFor(r.name),
          autoSync: r.autoSync,
          sourceBranch: branchExists ? undefined : r.sourceBranch || values.appDefaultBranch,
        });
        const failed = res.steps.filter((s) => s.status === 'failed');
        items[i + 1] = failed.length
          ? { ...items[i + 1], status: 'failed', detail: `${failed.length} item(s) failed: ${failed.map((f) => f.label).join(', ')}. Use Fix on the project page.` }
          : { ...items[i + 1], status: 'done', detail: `${res.steps.filter((s) => s.status === 'created' || s.status === 'updated').length} created, ${res.steps.filter((s) => s.status === 'exists').length} reused` };
      } catch (err) {
        items[i + 1] = { ...items[i + 1], status: 'failed', detail: getApiErrorMessage(err, 'Could not set up the environment') };
      }
      setProgress([...items]);
    }
    setIsSaving(false);
  };

  // ---------------------------------------------------------------- render
  const formId = 'project-form';
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEdit) saveEdit();
    else if (step < STEPS.length - 1) next();
    else create();
  };

  const repoFields = (
    <>
      <FormField id="project-connector" label="GitLab connector" hint="Repositories and branches are listed from this connector">
        <Dropdown
          id="project-connector"
          fullWidth
          value={values.connectorId}
          onChange={(v) => setValue('connectorId', v)}
          placeholder={connectors.length ? 'Select connector' : 'No active GitLab connector'}
          disabled={!connectors.length}
          options={connectors.map((c) => ({ value: c._id, label: c.name, sublabel: c.username ? `@${c.username}` : undefined }))}
        />
      </FormField>
      <div className="grid sm:grid-cols-2 gap-4">
        <FormField id="project-app-repo" label="Application repository" required error={errors.appRepoUrl} hint="Code + .gitlab-ci.yml">
          <Dropdown
            id="project-app-repo"
            fullWidth
            mono
            searchable
            invalid={Boolean(errors.appRepoUrl)}
            value={selected(values.appRepoUrl)}
            onChange={(v) => {
              setValue('appRepoUrl', v);
              setValue('appDefaultBranch', '');
              setEnvRows(null);
            }}
            placeholder={repos === null ? 'Loading repositories…' : 'Select repository'}
            options={repoOptions}
            menuMinWidth={320}
          />
        </FormField>
        <FormField id="project-branch" label="First environment branch" hint="New environment branches are created from it">
          <Dropdown
            id="project-branch"
            fullWidth
            mono
            searchable
            value={values.appDefaultBranch}
            onChange={(v) => setValue('appDefaultBranch', v)}
            placeholder={!values.appRepoUrl ? 'Pick the repository first' : branches === null ? 'Loading branches…' : 'Select branch'}
            disabled={!values.appRepoUrl}
            options={branchOptions}
            menuMinWidth={300}
          />
        </FormField>
        <FormField id="project-gitops-repo" label="GitOps repository" required error={errors.gitopsRepoUrl} hint="Kubernetes manifests that ArgoCD deploys">
          <Dropdown
            id="project-gitops-repo"
            fullWidth
            mono
            searchable
            invalid={Boolean(errors.gitopsRepoUrl)}
            value={selected(values.gitopsRepoUrl)}
            onChange={(v) => {
              setValue('gitopsRepoUrl', v);
              setValue('gitopsPath', '');
              setEnvRows(null);
            }}
            placeholder={repos === null ? 'Loading repositories…' : 'Select repository'}
            options={repoOptions}
            menuMinWidth={320}
          />
        </FormField>
        <FormField id="project-gitops-path" label="Overlay folder" hint="One sub-folder per environment (Kustomize overlays)">
          <Dropdown
            id="project-gitops-path"
            fullWidth
            mono
            value={values.gitopsPath}
            onChange={(v) => {
              setValue('gitopsPath', v);
              setEnvRows(null);
            }}
            placeholder={!values.gitopsRepoUrl ? 'Pick the GitOps repository first' : layout === null ? 'Scanning the repository…' : 'Select folder'}
            disabled={!values.gitopsRepoUrl}
            options={gitopsPathOptions}
            menuMinWidth={320}
          />
        </FormField>
      </div>
      {values.gitopsRepoUrl && layout && (
        <p className="text-[11px] text-slate-500">
          {layout.empty
            ? 'The GitOps repository is empty: overlays are created as you add environments.'
            : overlayEnvs.length
              ? <>Found overlays in <span className="font-mono">{values.gitopsPath}</span>: <span className="font-mono">{overlayEnvs.join(', ')}</span></>
              : 'No environment overlays found yet: each environment gets one when you add it.'}
        </p>
      )}
    </>
  );

  const clusterField = (
    <FormField id="project-cluster" label="Cluster" required error={errors.clusterName} hint="From Connectors → Clusters">
      <Dropdown
        id="project-cluster"
        fullWidth
        mono
        invalid={Boolean(errors.clusterName)}
        value={values.clusterName}
        onChange={(v) => setValue('clusterName', v)}
        placeholder={clusters.length ? 'Select cluster' : 'No cluster connectors'}
        options={clusterOptions}
      />
    </FormField>
  );

  const done = progress && !isSaving;
  const anyFailed = progress?.some((p) => p.status === 'failed');

  return (
    <Modal
      isOpen
      onClose={onClose}
      preventClose={isSaving}
      maxWidth="xl"
      icon={<FolderKanban size={18} />}
      title={isEdit ? `Edit ${project!.name}` : 'New project'}
      subtitle={
        isEdit
          ? 'Repositories, overlay folder and cluster. Environments are managed on the project page.'
          : 'Pick everything from your connectors. Environments are set up for you at the end.'
      }
      footer={
        isEdit ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" form={formId} isLoading={isSaving} disabled={!isDirty}>
              Save changes
            </Button>
          </>
        ) : progress ? (
          <Button
            disabled={!done || !created}
            onClick={() => created && onSaved(created, `Project ${created.name} created`, { openAddEnvironment: (envRows || []).length === 0 })}
          >
            {done ? 'Open project' : 'Setting up…'}
          </Button>
        ) : (
          <>
            {step > 0 ? (
              <Button variant="secondary" onClick={() => setStep((s) => s - 1)} leftIcon={<ArrowLeft size={13} />} className="mr-auto">
                Back
              </Button>
            ) : (
              <Button variant="secondary" onClick={onClose} className="mr-auto">
                Cancel
              </Button>
            )}
            <Button type="submit" form={formId} rightIcon={step < STEPS.length - 1 ? <ArrowRight size={13} /> : undefined}>
              {step < STEPS.length - 1 ? 'Next' : (envRows || []).length ? `Create project + ${(envRows || []).length} environment${(envRows || []).length === 1 ? '' : 's'}` : 'Create project'}
            </Button>
          </>
        )
      }
    >
      {!isEdit && !progress && (
        <ol className="grid grid-cols-4 gap-2 mb-5" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="min-w-0">
              <div className={`h-1 rounded-full mb-1.5 ${i < step ? 'bg-emerald-500' : i === step ? 'bg-sky-600' : 'bg-slate-200'}`} />
              <div className="flex items-center gap-1.5" aria-current={i === step ? 'step' : undefined}>
                <span className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-sky-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                  {i < step ? <Check size={11} /> : i + 1}
                </span>
                <span className={`text-xs truncate ${i === step ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{s.title}</span>
              </div>
              <div className="text-[10px] text-slate-400 truncate pl-6">{s.hint}</div>
            </li>
          ))}
        </ol>
      )}

      <form id={formId} onSubmit={onSubmit} className="space-y-5" noValidate>
        {(loadError || formError) && (
          <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2" role="alert">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            {formError || loadError}
          </div>
        )}

        {progress ? (
          <div className="space-y-3">
            <ul className="space-y-2">
              {progress.map((p) => (
                <li key={p.label} className="flex items-start gap-2.5 rounded-md border border-slate-200 bg-white px-3 py-2">
                  {p.status === 'done' ? (
                    <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                  ) : p.status === 'failed' ? (
                    <XCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                  ) : p.status === 'running' ? (
                    <Loader2 size={16} className="text-sky-600 shrink-0 mt-0.5 animate-spin" />
                  ) : (
                    <span className="w-4 h-4 rounded-full border-2 border-slate-300 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm text-slate-900">{p.label}</div>
                    {p.detail && <div className={`text-[11px] ${p.status === 'failed' ? 'text-rose-700' : 'text-slate-500'}`}>{p.detail}</div>}
                  </div>
                </li>
              ))}
            </ul>
            {done && (
              <div className={`rounded-md p-3 text-xs ${anyFailed ? 'bg-amber-50 border border-amber-200 text-amber-900' : 'bg-emerald-50 border border-emerald-200 text-emerald-900'}`}>
                {anyFailed
                  ? 'Some items need attention. Open the project: the Setup checklist tab shows what is missing and Fix re-runs only that.'
                  : `All set. Push to ${values.appDefaultBranch || 'the first branch'} to build and deploy, then promote from Environments.`}
              </div>
            )}
          </div>
        ) : isEdit ? (
          <>
            <Section title="Basics" icon={<FolderKanban size={13} />}>
              <FormField id="project-description" label="Description">
                <TextArea id="project-description" rows={2} maxLength={500} value={values.description} onChange={(e) => setValue('description', e.target.value)} />
              </FormField>
            </Section>
            <Section title="Code & GitOps" icon={<FolderGit2 size={13} />}>
              {repoFields}
            </Section>
            <Section title="Cluster" icon={<Server size={13} />}>
              {clusterField}
            </Section>
          </>
        ) : step === 0 ? (
          <>
            <FormField
              id="project-name"
              label="Project name"
              required
              error={errors.name}
              hint="Lowercase. Used as the namespace prefix: payments → payments-dev, payments-prod. It cannot be renamed later."
            >
              <TextInput
                id="project-name"
                mono
                autoFocus
                value={values.name}
                invalid={Boolean(errors.name)}
                placeholder="payments"
                onChange={(e) => {
                  setValue('name', e.target.value.toLowerCase().replace(/\s+/g, '-'));
                  setEnvRows(null);
                }}
              />
            </FormField>
            <FormField id="project-description" label="Description" hint="Optional: what it runs and who owns it">
              <TextArea id="project-description" rows={2} maxLength={500} value={values.description} placeholder="Payments API used by the checkout team" onChange={(e) => setValue('description', e.target.value)} />
            </FormField>
          </>
        ) : step === 1 ? (
          <>
            <div className="grid sm:grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-md border border-orange-200 bg-orange-50 p-2.5 text-orange-950">
                <div className="flex items-center gap-1.5 font-semibold mb-0.5">
                  <FolderGit2 size={13} /> Application repository
                </div>
                Your code and <span className="font-mono">.gitlab-ci.yml</span>. One branch per environment; CI builds an image per branch.
              </div>
              <div className="rounded-md border border-teal-200 bg-teal-50 p-2.5 text-teal-950">
                <div className="flex items-center gap-1.5 font-semibold mb-0.5">
                  <Layers size={13} /> GitOps repository
                </div>
                Kubernetes manifests: a base plus one overlay folder per environment. ArgoCD deploys what is here.
              </div>
            </div>
            {repoFields}
            <p className="text-[11px] text-slate-500">
              No repositories yet? Create them from a template in <span className="font-semibold">GitLab Repositories → New repository</span>.
            </p>
          </>
        ) : step === 2 ? (
          <>
            {clusterField}
            <Section title="Environments" icon={<Layers size={13} />}>
              <p className="text-[11px] text-slate-500 -mt-1">
                Each environment deploys its own branch into its own namespace. Existing branches, overlays and namespaces are reused; anything missing is created.
              </p>
              <EnvironmentRowsEditor
                rows={envRows || []}
                onChange={(rows) => {
                  setEnvRows(rows);
                  setEnvErrors({});
                }}
                projectName={values.name.trim()}
                cluster={values.clusterName}
                namespaces={namespaces}
                branches={branches || []}
                firstBranch={values.appDefaultBranch || 'main'}
                overlayBase={values.gitopsPath || DEFAULT_OVERLAYS}
                overlayEnvs={overlayEnvs}
                errors={envErrors}
              />
            </Section>
          </>
        ) : (
          <div className="space-y-4">
            <dl className="rounded-md border border-slate-200 divide-y divide-slate-100 text-xs">
              {[
                { k: 'Project', v: values.name },
                { k: 'Description', v: values.description || '—' },
                { k: 'Application repo', v: `${appRepo?.fullName || values.appRepoUrl} (branch ${values.appDefaultBranch || 'main'})` },
                { k: 'GitOps repo', v: `${gitopsRepo?.fullName || values.gitopsRepoUrl} → ${values.gitopsPath || DEFAULT_OVERLAYS}/<env>` },
                { k: 'Cluster', v: values.clusterName },
              ].map((row) => (
                <div key={row.k} className="flex gap-3 px-3 py-2">
                  <dt className="w-32 shrink-0 text-slate-500">{row.k}</dt>
                  <dd className="text-slate-900 font-mono min-w-0 break-all">{row.v}</dd>
                </div>
              ))}
            </dl>
            {(envRows || []).length > 0 ? (
              <div className="rounded-md border border-slate-200 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2">Environment</th>
                      <th className="text-left px-3 py-2">Branch</th>
                      <th className="text-left px-3 py-2">Namespace</th>
                      <th className="text-left px-3 py-2">Overlay</th>
                      <th className="text-left px-3 py-2">ArgoCD app</th>
                      <th className="text-left px-3 py-2">Deploy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {(envRows || []).map((r) => {
                      const bExists = (branches || []).some((b) => b.name === r.name);
                      const nExists = namespaces.some((n) => n.name === r.namespace);
                      const appName = appNameFor(r.name);
                      const renamed = !appName.startsWith(`${(appRepo?.fullName || values.appRepoUrl).split('/').pop()?.replace(/\.git$/, '')}-`);
                      return (
                        <tr key={r.key}>
                          <td className="px-3 py-2 font-semibold">{r.name}</td>
                          <td className="px-3 py-2">{bExists ? `${r.name} (reuse)` : `${r.name} (new from ${r.sourceBranch || values.appDefaultBranch})`}</td>
                          <td className="px-3 py-2">{r.namespace} {nExists ? '(reuse)' : '(new)'}</td>
                          <td className="px-3 py-2">{overlayEnvs.includes(r.name) ? 'reuse' : 'new'}</td>
                          <td className="px-3 py-2" title={renamed ? 'The usual name belongs to another project' : undefined}>
                            {appName}
                            {renamed && <span className="font-sans text-amber-700"> (renamed)</span>}
                          </td>
                          <td className="px-3 py-2 font-sans">{r.autoSync ? 'auto' : 'manual'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-slate-500">No environments selected: the project is created empty and you add environments on its page.</p>
            )}
            <p className="text-[11px] text-slate-500">
              For every environment DevOps Intelligence also sets the registry pull secret, ArgoCD repository access, the <span className="font-mono">DEPLOY_BRANCHES</span> CI rule and branch
              protection.
            </p>
          </div>
        )}
      </form>
    </Modal>
  );
};
