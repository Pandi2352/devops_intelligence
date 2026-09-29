import React, { useState } from 'react';
import { ConnectorFormModal } from './ConnectorFormModal';
import { ConnectorLogoTile } from './ConnectorLogos';
import { FormField, SecretInput, TextInput, Toggle } from '../common/Form';
import { useForm, FormErrors, isHttpUrl } from '../../hooks/useForm';
import { gitApi } from '../../api/gitApi';
import { getApiErrorMessage } from '../../api/client';
import { ConnectionTestResult, GitIntegration } from '../../types';

type GitLabFormValues = {
  name: string;
  baseUrl: string;
  token: string;
  isActive: boolean;
  isDefault: boolean;
};

interface GitLabConnectorModalProps {
  connector: GitIntegration | null; // null = create
  isFirst: boolean;
  onClose: () => void;
  onSaved: (connector: GitIntegration, message: string) => void;
}

export const GitLabConnectorModal: React.FC<GitLabConnectorModalProps> = ({ connector, isFirst, onClose, onSaved }) => {
  const isEdit = Boolean(connector);

  const validate = (v: GitLabFormValues): FormErrors<GitLabFormValues> => {
    const errors: FormErrors<GitLabFormValues> = {};
    if (!v.name.trim()) errors.name = 'Enter a name for this connector';
    else if (v.name.trim().length > 80) errors.name = 'Name must be 80 characters or fewer';
    if (!isHttpUrl(v.baseUrl)) errors.baseUrl = 'Enter a valid URL, e.g. https://gitlab.com';
    if (!isEdit && !v.token.trim()) errors.token = 'Enter a personal access token';
    return errors;
  };

  const { values, errors, setValue, validateFields } = useForm<GitLabFormValues>(
    {
      name: connector?.name ?? '',
      baseUrl: connector?.baseUrl || 'https://gitlab.com',
      token: '',
      isActive: connector?.isActive ?? true,
      isDefault: connector?.isDefault ?? isFirst,
    },
    validate
  );

  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const update = <K extends keyof GitLabFormValues>(key: K, value: GitLabFormValues[K]) => {
    setValue(key, value);
    if (key === 'baseUrl' || key === 'token') setTestResult(null);
  };

  const handleTest = async () => {
    if (!validateFields(['baseUrl', 'token'])) return;
    setIsTesting(true);
    setFormError(null);
    try {
      const result = await gitApi.testConnection({
        id: connector?._id,
        provider: 'gitlab',
        baseUrl: values.baseUrl.trim(),
        token: values.token.trim() || undefined,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, message: getApiErrorMessage(err, 'Connection test failed') });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateFields()) return;
    setIsSaving(true);
    setFormError(null);
    const payload = {
      name: values.name.trim(),
      provider: 'gitlab' as const,
      baseUrl: values.baseUrl.trim(),
      token: values.token.trim() || undefined,
      isActive: values.isActive,
      isDefault: values.isDefault,
    };
    try {
      const saved = connector ? await gitApi.update(connector._id, payload) : await gitApi.create(payload);
      onSaved(saved, isEdit ? `Connector '${saved.name}' updated` : `GitLab connected as @${saved.username}`);
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Failed to save the GitLab connector'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ConnectorFormModal
      title={isEdit ? `Edit ${connector!.name}` : 'Add GitLab connector'}
      subtitle="GitLab.com or a self-managed GitLab instance, authenticated with a personal access token"
      icon={<ConnectorLogoTile kind="gitlab" />}
      formId="gitlab-connector-form"
      submitLabel={isEdit ? 'Save changes' : 'Verify & add connector'}
      isSaving={isSaving}
      isTesting={isTesting}
      testResult={testResult}
      formError={formError}
      onTest={handleTest}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField id="gl-name" label="Connector name" required error={errors.name}>
          <TextInput
            id="gl-name"
            value={values.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="e.g. Company GitLab"
            invalid={Boolean(errors.name)}
            maxLength={80}
          />
        </FormField>

        <FormField id="gl-url" label="GitLab URL" required error={errors.baseUrl} hint="Use your instance URL for self-managed GitLab">
          <TextInput
            id="gl-url"
            type="url"
            value={values.baseUrl}
            onChange={(e) => update('baseUrl', e.target.value)}
            placeholder="https://gitlab.com"
            invalid={Boolean(errors.baseUrl)}
            mono
          />
        </FormField>
      </div>

      <FormField
        id="gl-token"
        label="Personal access token"
        required={!isEdit}
        error={errors.token}
        hint={
          isEdit
            ? `Saved token ${connector?.tokenHint || ''}. Leave blank to keep it.`
            : 'Needs the read_api and read_user scopes (api to trigger pipelines).'
        }
      >
        <SecretInput
          id="gl-token"
          value={values.token}
          onChange={(e) => update('token', e.target.value)}
          placeholder={isEdit ? 'Leave blank to keep the saved token' : 'glpat-xxxxxxxxxxxxxxxxxxxx'}
          invalid={Boolean(errors.token)}
        />
      </FormField>

      <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60 space-y-3">
        <Toggle
          id="gl-active"
          checked={values.isActive}
          onChange={(v) => update('isActive', v)}
          label="Enabled"
          description="Disabled connectors keep their credentials but are not used to fetch repositories or pipelines."
        />
        <Toggle
          id="gl-default"
          checked={values.isDefault}
          onChange={(v) => update('isDefault', v)}
          label="Default GitLab connector"
          description="Used by the GitLab Repositories page."
          disabled={connector?.isDefault}
        />
      </div>
    </ConnectorFormModal>
  );
};
