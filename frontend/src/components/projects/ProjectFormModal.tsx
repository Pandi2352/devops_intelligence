import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FolderKanban } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Dropdown, DropdownOption } from '../common/Dropdown';
import { FormField, TextArea, TextInput } from '../common/Form';
import { useForm, FormErrors } from '../../hooks/useForm';
import { gitApi } from '../../api/gitApi';
import { clusterApi } from '../../api/clusterApi';
import { getApiErrorMessage } from '../../api/client';
import { Project, appRepoOf, clusterOf, gitopsRepoOf, projectApi } from '../../api/projectApi';
import { Cluster, GitIntegration, GitRepo } from '../../types';

type ProjectFormValues = {
  name: string;
  description: string;
  connectorId: string;
  appRepoUrl: string;
  appDefaultBranch: string;
  gitopsRepoUrl: string;
  clusterName: string;
};

interface ProjectFormModalProps {
  project: Project | null; // null = create
  onClose: () => void;
  onSaved: (project: Project, message: string) => void;
}

const PROJECT_NAME = /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/;
const normalize = (url: string) => url.trim().replace(/\.git$/, '').toLowerCase();

export const ProjectFormModal: React.FC<ProjectFormModalProps> = ({ project, onClose, onSaved }) => {
  const isEdit = Boolean(project);
  const [connectors, setConnectors] = useState<GitIntegration[]>([]);
  const [repos, setRepos] = useState<GitRepo[] | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const validate = (v: ProjectFormValues): FormErrors<ProjectFormValues> => {
    const errors: FormErrors<ProjectFormValues> = {};
    if (!isEdit && !PROJECT_NAME.test(v.name.trim())) errors.name = 'Use 1-50 lowercase letters, numbers or dashes (e.g. payments)';
    if (!v.appRepoUrl) errors.appRepoUrl = 'Pick the repository that holds the application code';
    if (!v.gitopsRepoUrl) errors.gitopsRepoUrl = 'Pick the repository that holds the Kubernetes manifests';
    else if (v.gitopsRepoUrl === v.appRepoUrl) errors.gitopsRepoUrl = 'The GitOps repository must be different from the application repository';
    if (!v.clusterName) errors.clusterName = 'Pick the cluster this project deploys to';
    return errors;
  };

  const { values, errors, setValue, validateFields, isDirty } = useForm<ProjectFormValues>(
    {
      name: project?.name ?? '',
      description: project?.description ?? '',
      connectorId: '',
      appRepoUrl: project ? appRepoOf(project)?.repoUrl ?? '' : '',
      appDefaultBranch: project ? appRepoOf(project)?.branch ?? '' : '',
      gitopsRepoUrl: project ? gitopsRepoOf(project)?.repoUrl ?? '' : '',
      clusterName: project ? clusterOf(project) : '',
    },
    validate
  );

  useEffect(() => {
    Promise.all([gitApi.getAll(), clusterApi.getAll()])
      .then(([git, cl]) => {
        const active = git.filter((g) => g.isActive);
        setConnectors(active);
        setClusters(cl);
        const preferred = active.find((g) => g.isDefault) || active[0];
        if (preferred) setValue('connectorId', preferred._id);
        else setRepos([]);
      })
      .catch((err) => setLoadError(getApiErrorMessage(err, 'Could not load connectors')));
  }, [setValue]);

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

  // Keep a saved URL selectable even when it is not in the connector's list (other account, renamed, ...).
  const repoOptions = useMemo(() => {
    const options: DropdownOption[] = (repos || []).map((r) => ({
      value: r.cloneUrl,
      label: r.fullName,
      sublabel: `${r.defaultBranch}${r.private ? ' · private' : ''}`,
    }));
    for (const url of [values.appRepoUrl, values.gitopsRepoUrl]) {
      if (url && !options.some((o) => normalize(o.value) === normalize(url))) options.unshift({ value: url, label: url, sublabel: 'saved' });
    }
    return options;
  }, [repos, values.appRepoUrl, values.gitopsRepoUrl]);

  const selectRepo = (key: 'appRepoUrl' | 'gitopsRepoUrl', url: string) => {
    const match = repoOptions.find((o) => normalize(o.value) === normalize(url));
    setValue(key, match?.value ?? url);
    if (key === 'appRepoUrl') {
      const repo = repos?.find((r) => r.cloneUrl === url);
      if (repo) setValue('appDefaultBranch', repo.defaultBranch);
    }
  };
  const selectedValue = (url: string) => repoOptions.find((o) => normalize(o.value) === normalize(url))?.value ?? url;

  const clusterOptions: DropdownOption[] = useMemo(() => {
    const options: DropdownOption[] = clusters.map((c) => ({
      value: c.name,
      label: c.name,
      sublabel: `${c.type}${c.status ? ` · ${c.status}` : ''}`,
    }));
    if (values.clusterName && !options.some((o) => o.value === values.clusterName)) {
      options.unshift({ value: values.clusterName, label: values.clusterName, sublabel: 'not found in connectors' });
    }
    return options;
  }, [clusters, values.clusterName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateFields()) return;
    setIsSaving(true);
    setFormError(null);
    const input = {
      description: values.description.trim(),
      appRepoUrl: values.appRepoUrl,
      appDefaultBranch: values.appDefaultBranch || 'main',
      gitopsRepoUrl: values.gitopsRepoUrl,
      clusterName: values.clusterName,
    };
    try {
      const result = project ? await projectApi.update(project._id, input) : await projectApi.create({ ...input, name: values.name.trim() });
      onSaved(result.project, result.message);
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Could not save the project'));
    } finally {
      setIsSaving(false);
    }
  };

  const formId = 'project-form';
  return (
    <Modal
      isOpen
      onClose={onClose}
      preventClose={isSaving}
      maxWidth="lg"
      icon={<FolderKanban size={18} />}
      title={isEdit ? `Edit ${project!.name}` : 'New project'}
      subtitle="A project ties an application repository, its GitOps repository and a cluster together. Environments are added on the project page."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} isLoading={isSaving} disabled={isEdit && !isDirty}>
            {isEdit ? 'Save changes' : 'Create project'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4" noValidate>
        {(loadError || formError) && (
          <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2" role="alert">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            {formError || loadError}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <FormField
            id="project-name"
            label="Project name"
            required={!isEdit}
            error={errors.name}
            hint={isEdit ? 'Names are fixed: namespaces and apps are derived from them' : 'Used as the prefix for namespaces, e.g. payments-dev'}
          >
            <TextInput
              id="project-name"
              mono
              value={values.name}
              disabled={isEdit}
              invalid={Boolean(errors.name)}
              placeholder="kubeorbit-demo"
              onChange={(e) => setValue('name', e.target.value.toLowerCase().replace(/\s+/g, '-'))}
            />
          </FormField>
          <FormField id="project-connector" label="GitLab connector" hint="Repositories are listed from this connector">
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
        </div>

        <FormField id="project-description" label="Description">
          <TextArea
            id="project-description"
            rows={2}
            maxLength={500}
            value={values.description}
            placeholder="What this project runs"
            onChange={(e) => setValue('description', e.target.value)}
          />
        </FormField>

        <div className="grid sm:grid-cols-2 gap-4">
          <FormField id="project-app-repo" label="Application repository" required error={errors.appRepoUrl} hint="Source code and .gitlab-ci.yml; one branch per environment">
            <Dropdown
              id="project-app-repo"
              fullWidth
              mono
              searchable
              invalid={Boolean(errors.appRepoUrl)}
              value={selectedValue(values.appRepoUrl)}
              onChange={(v) => selectRepo('appRepoUrl', v)}
              placeholder={repos === null ? 'Loading repositories…' : 'Select repository'}
              options={repoOptions}
              menuMinWidth={320}
            />
          </FormField>
          <FormField id="project-gitops-repo" label="GitOps repository" required error={errors.gitopsRepoUrl} hint="Kustomize base and one overlay per environment">
            <Dropdown
              id="project-gitops-repo"
              fullWidth
              mono
              searchable
              invalid={Boolean(errors.gitopsRepoUrl)}
              value={selectedValue(values.gitopsRepoUrl)}
              onChange={(v) => selectRepo('gitopsRepoUrl', v)}
              placeholder={repos === null ? 'Loading repositories…' : 'Select repository'}
              options={repoOptions}
              menuMinWidth={320}
            />
          </FormField>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <FormField id="project-branch" label="First environment branch" hint="New environments branch from here when no source is given">
            <TextInput
              id="project-branch"
              mono
              value={values.appDefaultBranch}
              placeholder="dev"
              onChange={(e) => setValue('appDefaultBranch', e.target.value.trim())}
            />
          </FormField>
          <FormField id="project-cluster" label="Cluster" required error={errors.clusterName} hint="Managed in Connectors → Clusters">
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
        </div>
      </form>
    </Modal>
  );
};
