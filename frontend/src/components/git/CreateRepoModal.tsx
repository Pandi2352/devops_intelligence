import React, { useEffect, useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Dropdown } from '../common/Dropdown';
import { FormField, SegmentedControl, TextInput } from '../common/Form';
import { GitLabLogo } from '../connectors/ConnectorLogos';
import { useForm, FormErrors } from '../../hooks/useForm';
import { gitApi, WorkspaceTemplate } from '../../api/gitApi';
import { getApiErrorMessage } from '../../api/client';
import { GitIntegration, GitRepo } from '../../types';

type Visibility = 'private' | 'internal' | 'public';

type CreateRepoValues = {
  integrationId: string;
  name: string;
  path: string;
  description: string;
  visibility: Visibility;
  template: string;
  commitMessage: string;
};

const VISIBILITY_OPTIONS: { value: Visibility; label: string; description: string }[] = [
  { value: 'private', label: 'Private', description: 'Only project members' },
  { value: 'internal', label: 'Internal', description: 'Any signed-in user' },
  { value: 'public', label: 'Public', description: 'Anyone, incl. registry pulls' },
];

const toPath = (name: string) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');

interface CreateRepoModalProps {
  integrations: GitIntegration[];
  defaultIntegrationId: string;
  onClose: () => void;
  onCreated: (repo: GitRepo, integrationId: string, message: string, ok: boolean) => void;
}

export const CreateRepoModal: React.FC<CreateRepoModalProps> = ({ integrations, defaultIntegrationId, onClose, onCreated }) => {
  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);
  const [pathEdited, setPathEdited] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const validate = (v: CreateRepoValues): FormErrors<CreateRepoValues> => {
    const errors: FormErrors<CreateRepoValues> = {};
    if (!v.integrationId) errors.integrationId = 'Choose a GitLab account';
    if (!v.name.trim()) errors.name = 'Enter a project name';
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(v.path)) errors.path = 'Lowercase letters, numbers, dots, dashes and underscores';
    return errors;
  };

  const { values, errors, setValue, validateFields } = useForm<CreateRepoValues>(
    {
      integrationId: defaultIntegrationId,
      name: '',
      path: '',
      description: '',
      visibility: 'private',
      template: '',
      commitMessage: 'feat: initial commit from DevOps Intelligence',
    },
    validate
  );

  useEffect(() => {
    gitApi
      .getTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, []);

  const integration = integrations.find((g) => g._id === values.integrationId);
  const projectUrl = integration && values.path ? `${integration.baseUrl}/${integration.username}/${values.path}` : '';
  const template = templates.find((t) => t.name === values.template);

  const handleNameChange = (name: string) => {
    setValue('name', name);
    if (!pathEdited) setValue('path', toPath(name));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateFields()) return;
    setIsSaving(true);
    setFormError(null);
    try {
      const res = await gitApi.createRepo(values.integrationId, {
        name: values.name.trim(),
        path: values.path,
        description: values.description.trim() || undefined,
        visibility: values.visibility,
        template: values.template || undefined,
        commitMessage: values.template ? values.commitMessage.trim() : undefined,
      });
      onCreated(res.repo, values.integrationId, res.message, !res.pushError);
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Could not create the project'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      preventClose={isSaving}
      maxWidth="lg"
      title="New GitLab repository"
      subtitle="Creates the project in GitLab and, optionally, pushes starter code as the first commit"
      icon={
        <div className="w-9 h-9 rounded-md border border-orange-200 bg-orange-50 flex items-center justify-center">
          <GitLabLogo size={20} />
        </div>
      }
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" form="create-repo-form" isLoading={isSaving} leftIcon={<FolderPlus size={14} />}>
            {values.template ? 'Create & push code' : 'Create repository'}
          </Button>
        </>
      }
    >
      <form id="create-repo-form" onSubmit={handleSubmit} noValidate className="space-y-4">
        {formError && (
          <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
            {formError}
          </div>
        )}

        <FormField id="repo-account" label="GitLab account" required error={errors.integrationId}>
          <Dropdown<string>
            id="repo-account"
            size="md"
            fullWidth
            value={values.integrationId}
            onChange={(v) => setValue('integrationId', v)}
            invalid={Boolean(errors.integrationId)}
            options={integrations.map((g) => ({
              value: g._id,
              label: g.name,
              sublabel: `@${g.username} · ${g.baseUrl}`,
              icon: <GitLabLogo size={14} />,
            }))}
          />
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField id="repo-name" label="Project name" required error={errors.name}>
            <TextInput
              id="repo-name"
              value={values.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. kubeorbit-demo-api"
              invalid={Boolean(errors.name)}
              maxLength={100}
            />
          </FormField>
          <FormField id="repo-path" label="Project slug" required error={errors.path} hint={projectUrl || 'Used in the repository URL'}>
            <TextInput
              id="repo-path"
              value={values.path}
              onChange={(e) => {
                setPathEdited(true);
                setValue('path', e.target.value.toLowerCase());
              }}
              invalid={Boolean(errors.path)}
              maxLength={100}
              mono
            />
          </FormField>
        </div>

        <FormField id="repo-description" label="Description">
          <TextInput
            id="repo-description"
            value={values.description}
            onChange={(e) => setValue('description', e.target.value)}
            placeholder="Optional"
            maxLength={500}
          />
        </FormField>

        <div>
          <span className="block text-xs font-semibold text-slate-700 mb-1.5">Visibility</span>
          <SegmentedControl name="repo-visibility" value={values.visibility} options={VISIBILITY_OPTIONS} onChange={(v) => setValue('visibility', v)} />
        </div>

        <FormField
          id="repo-template"
          label="Starter code"
          hint={
            template
              ? `${template.fileCount} files from devops-demo/${template.name}${template.hasPipeline ? '. Includes .gitlab-ci.yml, so the first pipeline starts right after the push.' : '.'}`
              : 'Leave empty for a blank repository you push to yourself.'
          }
        >
          <Dropdown<string>
            id="repo-template"
            size="md"
            fullWidth
            value={values.template}
            onChange={(v) => setValue('template', v)}
            options={[
              { value: '', label: 'Empty repository' },
              ...templates.map((t) => ({
                value: t.name,
                label: t.name,
                sublabel: t.description || `${t.fileCount} files`,
              })),
            ]}
          />
        </FormField>

        {values.template && (
          <FormField id="repo-commit" label="First commit message">
            <TextInput
              id="repo-commit"
              value={values.commitMessage}
              onChange={(e) => setValue('commitMessage', e.target.value)}
              maxLength={200}
              mono
            />
          </FormField>
        )}
      </form>
    </Modal>
  );
};
