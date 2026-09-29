import React, { useState } from 'react';
import { ConnectorFormModal } from './ConnectorFormModal';
import { ConnectorLogoTile } from './ConnectorLogos';
import { FormField, SecretInput, TextInput, Toggle } from '../common/Form';
import { useForm, FormErrors, isHttpUrl } from '../../hooks/useForm';
import { gitApi } from '../../api/gitApi';
import { getApiErrorMessage } from '../../api/client';
import { ConnectionTestResult, GitIntegration } from '../../types';

type GitHubFormValues = {
  name: string;
  baseUrl: string;
  token: string;
  isActive: boolean;
  isDefault: boolean;
};

interface GitHubConnectorModalProps {
  connector: GitIntegration | null; // null = create
  isFirst: boolean;
  onClose: () => void;
  onSaved: (connector: GitIntegration, message: string) => void;
}

const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code className="px-1 rounded bg-slate-100 border border-slate-200 font-mono text-[10.5px] text-slate-800">{children}</code>
);

// Token creation steps, shown under the token field and in the tab's help panel.
export const GitHubTokenSteps: React.FC = () => (
  <span className="block space-y-1">
    <span className="block">
      GitHub → Settings → Developer settings → Personal access tokens.
    </span>
    <span className="block">
      <strong className="font-semibold text-slate-700">Classic:</strong> scopes <Code>repo</Code>, <Code>workflow</Code>,{' '}
      <Code>read:org</Code>.
    </span>
    <span className="block">
      <strong className="font-semibold text-slate-700">Fine-grained:</strong> Repository access All (or selected), permissions
      Contents, Administration, Workflows, Metadata: read &amp; write.
    </span>
    <span className="block">
      <Code>repo</Code> + <Code>workflow</Code> are needed later for the Project Starter to create repositories and push CI files.
    </span>
  </span>
);

export const GitHubConnectorModal: React.FC<GitHubConnectorModalProps> = ({ connector, isFirst, onClose, onSaved }) => {
  const isEdit = Boolean(connector);

  const validate = (v: GitHubFormValues): FormErrors<GitHubFormValues> => {
    const errors: FormErrors<GitHubFormValues> = {};
    if (!v.name.trim()) errors.name = 'Enter a name for this connector';
    else if (v.name.trim().length > 80) errors.name = 'Name must be 80 characters or fewer';
    if (!isHttpUrl(v.baseUrl)) errors.baseUrl = 'Enter a valid URL, e.g. https://github.com';
    if (!isEdit && !v.token.trim()) errors.token = 'Enter a personal access token';
    return errors;
  };

  const { values, errors, setValue, validateFields } = useForm<GitHubFormValues>(
    {
      name: connector?.name ?? '',
      baseUrl: connector?.baseUrl || 'https://github.com',
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

  const update = <K extends keyof GitHubFormValues>(key: K, value: GitHubFormValues[K]) => {
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
        provider: 'github',
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
      provider: 'github' as const,
      baseUrl: values.baseUrl.trim(),
      token: values.token.trim() || undefined,
      isActive: values.isActive,
      isDefault: values.isDefault,
    };
    try {
      const saved = connector ? await gitApi.update(connector._id, payload) : await gitApi.create(payload);
      onSaved(saved, isEdit ? `Connector '${saved.name}' updated` : `GitHub connected as @${saved.username}`);
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Failed to save the GitHub connector'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ConnectorFormModal
      title={isEdit ? `Edit ${connector!.name}` : 'Add GitHub connector'}
      subtitle="GitHub.com or GitHub Enterprise Server, authenticated with a personal access token"
      icon={<ConnectorLogoTile kind="github" />}
      formId="github-connector-form"
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
        <FormField id="gh-name" label="Connector name" required error={errors.name}>
          <TextInput
            id="gh-name"
            value={values.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="e.g. Company GitHub"
            invalid={Boolean(errors.name)}
            maxLength={80}
          />
        </FormField>

        <FormField id="gh-url" label="GitHub URL" required error={errors.baseUrl} hint="GitHub Enterprise Server: your instance URL">
          <TextInput
            id="gh-url"
            type="url"
            value={values.baseUrl}
            onChange={(e) => update('baseUrl', e.target.value)}
            placeholder="https://github.com"
            invalid={Boolean(errors.baseUrl)}
            mono
          />
        </FormField>
      </div>

      <FormField
        id="gh-token"
        label="Personal access token"
        required={!isEdit}
        error={errors.token}
        hint={
          <>
            {isEdit && (
              <span className="block mb-1">Saved token {connector?.tokenHint || ''}. Leave blank to keep it.</span>
            )}
            <GitHubTokenSteps />
          </>
        }
      >
        <SecretInput
          id="gh-token"
          value={values.token}
          onChange={(e) => update('token', e.target.value)}
          placeholder={isEdit ? 'Leave blank to keep the saved token' : 'ghp_xxxxxxxxxxxx or github_pat_xxxxxxxx'}
          invalid={Boolean(errors.token)}
        />
      </FormField>

      <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60 space-y-3">
        <Toggle
          id="gh-active"
          checked={values.isActive}
          onChange={(v) => update('isActive', v)}
          label="Enabled"
          description="Disabled connectors keep their credentials but are not used to fetch repositories."
        />
        <Toggle
          id="gh-default"
          checked={values.isDefault}
          onChange={(v) => update('isDefault', v)}
          label="Default GitHub connector"
          description="Used when a feature needs a GitHub account and none is picked explicitly."
          disabled={connector?.isDefault}
        />
      </div>
    </ConnectorFormModal>
  );
};
