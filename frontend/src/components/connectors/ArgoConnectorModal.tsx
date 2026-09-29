import React, { useState } from 'react';
import { ConnectorFormModal } from './ConnectorFormModal';
import { ConnectorLogoTile } from './ConnectorLogos';
import { FormField, SecretInput, SegmentedControl, TextInput, Toggle } from '../common/Form';
import { useForm, FormErrors, isHttpUrl } from '../../hooks/useForm';
import { argoApi, ArgoConnectorInput } from '../../api/argoApi';
import { getApiErrorMessage } from '../../api/client';
import { ArgoAuthType, ArgoIntegration, ConnectionTestResult } from '../../types';

type ArgoFormValues = {
  name: string;
  serverUrl: string;
  authType: ArgoAuthType;
  authToken: string;
  username: string;
  password: string;
  insecure: boolean;
  isDefault: boolean;
};

const AUTH_OPTIONS: { value: ArgoAuthType; label: string; description: string }[] = [
  { value: 'token', label: 'API token', description: 'argocd account generate-token' },
  { value: 'password', label: 'Username & password', description: 'Logs in for a session token' },
  { value: 'none', label: 'No auth', description: 'Anonymous access enabled' },
];

interface ArgoConnectorModalProps {
  connector: ArgoIntegration | null;
  isFirst: boolean;
  onClose: () => void;
  onSaved: (connector: ArgoIntegration, message: string, testOk: boolean) => void;
}

export const ArgoConnectorModal: React.FC<ArgoConnectorModalProps> = ({ connector, isFirst, onClose, onSaved }) => {
  const isEdit = Boolean(connector);

  const validate = (v: ArgoFormValues): FormErrors<ArgoFormValues> => {
    const errors: FormErrors<ArgoFormValues> = {};
    if (!v.name.trim()) errors.name = 'Enter a name for this ArgoCD instance';
    if (!isHttpUrl(v.serverUrl)) errors.serverUrl = 'Enter a valid URL, e.g. https://localhost:8080';
    if (v.authType === 'token' && !v.authToken.trim() && !connector?.hasToken) errors.authToken = 'Enter an API token';
    if (v.authType === 'password') {
      if (!v.username.trim()) errors.username = 'Enter a username';
      if (!v.password && !connector?.hasPassword) errors.password = 'Enter a password';
    }
    return errors;
  };

  const { values, errors, setValue, validateFields } = useForm<ArgoFormValues>(
    {
      name: connector?.name ?? '',
      serverUrl: connector?.serverUrl ?? 'https://localhost:8080',
      authType: connector?.authType ?? 'token',
      authToken: '',
      username: connector?.username || 'admin',
      password: '',
      insecure: connector?.insecure ?? true,
      isDefault: connector?.isDefault ?? isFirst,
    },
    validate
  );

  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const update = <K extends keyof ArgoFormValues>(key: K, value: ArgoFormValues[K]) => {
    setValue(key, value);
    if (key !== 'name' && key !== 'isDefault') setTestResult(null);
  };

  const buildPayload = (): ArgoConnectorInput => ({
    name: values.name.trim(),
    serverUrl: values.serverUrl.trim(),
    authType: values.authType,
    authToken: values.authToken.trim() || undefined,
    username: values.username.trim() || undefined,
    password: values.password || undefined,
    insecure: values.insecure,
    isDefault: values.isDefault,
  });

  const handleTest = async () => {
    if (!validateFields(['serverUrl', 'authToken', 'username', 'password'])) return;
    setIsTesting(true);
    setFormError(null);
    try {
      setTestResult(await argoApi.testConnection({ ...buildPayload(), id: connector?._id }));
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
    try {
      const res = connector?._id
        ? await argoApi.updateConnector(connector._id, buildPayload())
        : await argoApi.createConnector(buildPayload());
      onSaved(res.connector, res.test.ok ? res.message : `${res.message}: ${res.test.message}`, res.test.ok);
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Failed to save the ArgoCD connector'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ConnectorFormModal
      title={isEdit ? `Edit ${connector!.name}` : 'Add ArgoCD instance'}
      subtitle="Connect a local (port-forwarded) or remote ArgoCD API server"
      icon={<ConnectorLogoTile kind="argocd" />}
      formId="argo-connector-form"
      submitLabel={isEdit ? 'Save changes' : 'Add instance'}
      isSaving={isSaving}
      isTesting={isTesting}
      testResult={testResult}
      formError={formError}
      onTest={handleTest}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField id="ar-name" label="Name" required error={errors.name}>
          <TextInput
            id="ar-name"
            value={values.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="e.g. Minikube ArgoCD"
            invalid={Boolean(errors.name)}
            maxLength={80}
          />
        </FormField>
        <FormField id="ar-url" label="Server URL" required error={errors.serverUrl} hint="kubectl port-forward svc/argocd-server -n argocd 8080:443">
          <TextInput
            id="ar-url"
            type="url"
            value={values.serverUrl}
            onChange={(e) => update('serverUrl', e.target.value)}
            placeholder="https://localhost:8080"
            invalid={Boolean(errors.serverUrl)}
            mono
          />
        </FormField>
      </div>

      <div>
        <span className="block text-xs font-semibold text-slate-700 mb-1.5">Authentication</span>
        <SegmentedControl name="ar-auth" value={values.authType} options={AUTH_OPTIONS} onChange={(v) => update('authType', v)} />
      </div>

      {values.authType === 'token' && (
        <FormField
          id="ar-token"
          label="API token"
          required={!connector?.hasToken}
          error={errors.authToken}
          hint={connector?.hasToken ? `Saved token ${connector.tokenHint || ''}. Leave blank to keep it.` : undefined}
        >
          <SecretInput
            id="ar-token"
            value={values.authToken}
            onChange={(e) => update('authToken', e.target.value)}
            placeholder={connector?.hasToken ? 'Leave blank to keep the saved token' : 'eyJhbGciOiJIUzI1NiIs…'}
            invalid={Boolean(errors.authToken)}
          />
        </FormField>
      )}

      {values.authType === 'password' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField id="ar-username" label="Username" required error={errors.username}>
            <TextInput
              id="ar-username"
              placeholder="admin"
              value={values.username}
              onChange={(e) => update('username', e.target.value)}
              autoComplete="off"
              invalid={Boolean(errors.username)}
              mono
            />
          </FormField>
          <FormField
            id="ar-password"
            label="Password"
            required={!connector?.hasPassword}
            error={errors.password}
            hint={connector?.hasPassword ? 'A password is saved. Leave blank to keep it.' : 'Initial admin password: argocd-initial-admin-secret'}
          >
            <SecretInput
              id="ar-password"
              value={values.password}
              onChange={(e) => update('password', e.target.value)}
              placeholder={connector?.hasPassword ? 'Leave blank to keep' : ''}
              invalid={Boolean(errors.password)}
            />
          </FormField>
        </div>
      )}

      <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60 space-y-3">
        <Toggle
          id="ar-insecure"
          checked={values.insecure}
          onChange={(v) => update('insecure', v)}
          label="Skip TLS verification"
          description="Needed for a port-forwarded ArgoCD with its default self-signed certificate."
        />
        <Toggle
          id="ar-default"
          checked={values.isDefault}
          onChange={(v) => update('isDefault', v)}
          label="Default ArgoCD instance"
          description="Used by the ArgoCD GitOps page for listing and syncing applications."
          disabled={connector?.isDefault}
        />
      </div>
    </ConnectorFormModal>
  );
};
