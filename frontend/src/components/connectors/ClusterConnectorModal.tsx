import React, { useEffect, useRef, useState } from 'react';
import { Upload, AlertTriangle } from 'lucide-react';
import { ConnectorFormModal } from './ConnectorFormModal';
import { ConnectorLogoTile } from './ConnectorLogos';
import { FormField, SecretInput, SegmentedControl, TextArea, TextInput, Toggle } from '../common/Form';
import { Dropdown } from '../common/Dropdown';
import { useForm, FormErrors, isHttpUrl } from '../../hooks/useForm';
import { clusterApi, ClusterConnectorInput } from '../../api/clusterApi';
import { getApiErrorMessage } from '../../api/client';
import { Cluster, ClusterAuthType, ClusterType, ConnectionTestResult, KubeContext } from '../../types';

type ClusterFormValues = {
  name: string;
  description: string;
  type: ClusterType;
  authType: ClusterAuthType;
  contextName: string;
  kubeconfig: string;
  serverUrl: string;
  token: string;
  caData: string;
  insecureSkipTLSVerify: boolean;
  isDefault: boolean;
};

const CLUSTER_TYPES: { value: ClusterType; label: string }[] = [
  { value: 'minikube', label: 'Minikube (local)' },
  { value: 'local', label: 'Local / Docker Desktop / kind' },
  { value: 'eks', label: 'AWS EKS' },
  { value: 'gke', label: 'Google GKE' },
  { value: 'aks', label: 'Azure AKS' },
  { value: 'baremetal', label: 'Bare metal / other' },
];

const AUTH_OPTIONS: { value: ClusterAuthType; label: string; description: string }[] = [
  { value: 'context', label: 'Kubeconfig context', description: "From the server's ~/.kube/config" },
  { value: 'kubeconfig', label: 'Kubeconfig file', description: 'Paste or upload a kubeconfig' },
  { value: 'token', label: 'Server URL + token', description: 'e.g. a ServiceAccount token' },
];

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;
const MAX_KUBECONFIG_BYTES = 256 * 1024;

interface ClusterConnectorModalProps {
  connector: Cluster | null;
  isFirst: boolean;
  onClose: () => void;
  onSaved: (connector: Cluster, message: string, testOk: boolean) => void;
}

export const ClusterConnectorModal: React.FC<ClusterConnectorModalProps> = ({ connector, isFirst, onClose, onSaved }) => {
  const isEdit = Boolean(connector);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [contexts, setContexts] = useState<KubeContext[]>([]);
  const [contextsLoading, setContextsLoading] = useState(true);

  const validate = (v: ClusterFormValues): FormErrors<ClusterFormValues> => {
    const errors: FormErrors<ClusterFormValues> = {};
    if (!NAME_PATTERN.test(v.name.trim())) {
      errors.name = 'Use 1-63 letters, numbers, dots, dashes or underscores';
    }
    if (v.authType === 'context' && !v.contextName) errors.contextName = 'Select a context';
    if (v.authType === 'kubeconfig' && !v.kubeconfig.trim() && !connector?.hasKubeconfig) {
      errors.kubeconfig = 'Paste or upload a kubeconfig';
    }
    if (v.authType === 'token') {
      if (!isHttpUrl(v.serverUrl)) errors.serverUrl = 'Enter the API server URL, e.g. https://192.168.49.2:8443';
      if (!v.token.trim() && !connector?.tokenHint) errors.token = 'Enter a bearer token';
    }
    return errors;
  };

  const { values, errors, setValue, validateFields } = useForm<ClusterFormValues>(
    {
      name: connector?.name ?? '',
      description: connector?.description ?? '',
      type: connector?.type ?? 'minikube',
      authType: connector?.authType ?? 'context',
      contextName: connector?.authType === 'token' ? '' : connector?.contextName ?? '',
      kubeconfig: '',
      serverUrl: connector?.authType === 'token' ? connector.serverUrl : '',
      token: '',
      caData: '',
      insecureSkipTLSVerify: connector?.insecureSkipTLSVerify ?? false,
      isDefault: connector?.isDefault ?? isFirst,
    },
    validate
  );

  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    clusterApi
      .getContexts()
      .then((list) => {
        setContexts(list);
        if (!connector && list.length > 0) {
          const current = list.find((c) => c.isCurrent) || list[0];
          setValue('contextName', current.name);
        }
      })
      .catch(() => setContexts([]))
      .finally(() => setContextsLoading(false));
  }, [connector, setValue]);

  const update = <K extends keyof ClusterFormValues>(key: K, value: ClusterFormValues[K]) => {
    setValue(key, value);
    if (key !== 'name' && key !== 'description' && key !== 'isDefault' && key !== 'type') setTestResult(null);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_KUBECONFIG_BYTES) {
      setFormError('That file is larger than 256 KB and does not look like a kubeconfig.');
      return;
    }
    update('kubeconfig', await file.text());
  };

  const buildPayload = (): ClusterConnectorInput => ({
    name: values.name.trim(),
    description: values.description.trim(),
    type: values.type,
    authType: values.authType,
    contextName: values.contextName.trim() || undefined,
    kubeconfig: values.kubeconfig.trim() || undefined,
    serverUrl: values.serverUrl.trim() || undefined,
    token: values.token.trim() || undefined,
    caData: values.caData.trim() || undefined,
    insecureSkipTLSVerify: values.insecureSkipTLSVerify,
    isDefault: values.isDefault,
  });

  const handleTest = async () => {
    const fields: (keyof ClusterFormValues)[] = ['contextName', 'kubeconfig', 'serverUrl', 'token'];
    if (!validateFields(fields)) return;
    setIsTesting(true);
    setFormError(null);
    try {
      setTestResult(await clusterApi.testConnection({ ...buildPayload(), id: connector?._id }));
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
        ? await clusterApi.update(connector._id, buildPayload())
        : await clusterApi.create(buildPayload());
      onSaved(res.connector, res.test.ok ? res.message : `${res.message}: ${res.test.message}`, res.test.ok);
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Failed to save the cluster'));
    } finally {
      setIsSaving(false);
    }
  };

  const selectedContext = contexts.find((c) => c.name === values.contextName);

  return (
    <ConnectorFormModal
      title={isEdit ? `Edit ${connector!.name}` : 'Add Kubernetes cluster'}
      subtitle="Register a cluster DevOps Intelligence can browse and deploy to"
      icon={<ConnectorLogoTile kind="clusters" />}
      formId="cluster-connector-form"
      submitLabel={isEdit ? 'Save changes' : 'Add cluster'}
      isSaving={isSaving}
      isTesting={isTesting}
      testResult={testResult}
      formError={formError}
      onTest={handleTest}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField
          id="cl-name"
          label="Cluster name"
          required
          error={errors.name}
          hint={isEdit ? 'Names cannot change because projects reference them.' : 'Used in URLs and project mappings.'}
        >
          <TextInput
            id="cl-name"
            value={values.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="e.g. minikube-dev"
            invalid={Boolean(errors.name)}
            disabled={isEdit}
            maxLength={63}
            mono
          />
        </FormField>

        <FormField id="cl-type" label="Provider">
          <Dropdown<ClusterType>
            id="cl-type"
            size="md"
            fullWidth
            value={values.type}
            onChange={(v) => update('type', v)}
            options={CLUSTER_TYPES}
          />
        </FormField>
      </div>

      <FormField id="cl-description" label="Description">
        <TextInput
          id="cl-description"
          value={values.description}
          onChange={(e) => update('description', e.target.value)}
          placeholder="Optional, e.g. Shared dev cluster for the payments team"
          maxLength={300}
        />
      </FormField>

      <div>
        <span className="block text-xs font-semibold text-slate-700 mb-1.5">Authentication</span>
        <SegmentedControl
          name="cl-auth"
          value={values.authType}
          options={AUTH_OPTIONS}
          onChange={(v) => {
            update('authType', v);
            // Context names mean different things per method, so reset to a sensible value on switch.
            const localDefault = contexts.find((c) => c.isCurrent)?.name || contexts[0]?.name || '';
            const original = connector && connector.authType === v && v !== 'token' ? connector.contextName : '';
            update('contextName', original || (v === 'context' ? localDefault : ''));
          }}
        />
      </div>

      {values.authType === 'context' && (
        <FormField
          id="cl-context"
          label="Context"
          required
          error={errors.contextName}
          hint={selectedContext?.server ? `API server: ${selectedContext.server}` : undefined}
        >
          {contextsLoading ? (
            <div className="h-9 rounded-md bg-slate-100 animate-pulse" />
          ) : contexts.length === 0 ? (
            <div className="p-3 rounded-md border border-amber-200 bg-amber-50 text-amber-900 text-xs">
              No contexts were found in the server's kubeconfig. Use a kubeconfig file or a token instead.
            </div>
          ) : (
            <Dropdown<string>
              id="cl-context"
              size="md"
              fullWidth
              mono
              placeholder="Select a context…"
              value={values.contextName}
              onChange={(v) => update('contextName', v)}
              invalid={Boolean(errors.contextName)}
              searchPlaceholder="Filter contexts…"
              options={contexts.map((ctx) => ({
                value: ctx.name,
                label: ctx.name,
                sublabel: ctx.server,
                badge: ctx.isCurrent ? (
                  <span className="px-1.5 rounded text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">current</span>
                ) : undefined,
              }))}
            />
          )}
        </FormField>
      )}

      {values.authType === 'kubeconfig' && (
        <>
          <FormField
            id="cl-kubeconfig"
            label="Kubeconfig"
            required={!connector?.hasKubeconfig}
            error={errors.kubeconfig}
            hint={connector?.hasKubeconfig ? 'A kubeconfig is saved. Leave blank to keep it.' : 'Stored encrypted. Never shown again after saving.'}
          >
            <TextArea
              id="cl-kubeconfig"
              rows={8}
              value={values.kubeconfig}
              onChange={(e) => update('kubeconfig', e.target.value)}
              placeholder={'apiVersion: v1\nkind: Config\nclusters: …\ncontexts: …\nusers: …'}
              invalid={Boolean(errors.kubeconfig)}
              mono
            />
          </FormField>
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
            >
              <Upload size={14} /> Upload file
            </button>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFile} accept=".yaml,.yml,.conf,.config,.kubeconfig,text/*" />
            <FormField id="cl-kc-context" label="Context in file" hint="Optional; defaults to current-context" className="flex-1">
              <TextInput
                id="cl-kc-context"
                value={values.contextName}
                onChange={(e) => update('contextName', e.target.value)}
                placeholder="current-context"
                mono
              />
            </FormField>
          </div>
        </>
      )}

      {values.authType === 'token' && (
        <>
          <FormField id="cl-server" label="API server URL" required error={errors.serverUrl}>
            <TextInput
              id="cl-server"
              type="url"
              value={values.serverUrl}
              onChange={(e) => update('serverUrl', e.target.value)}
              placeholder="https://192.168.49.2:8443"
              invalid={Boolean(errors.serverUrl)}
              mono
            />
          </FormField>
          <FormField
            id="cl-token"
            label="Bearer token"
            required={!connector?.tokenHint}
            error={errors.token}
            hint={connector?.tokenHint ? `Saved token ${connector.tokenHint}. Leave blank to keep it.` : 'e.g. kubectl create token <serviceaccount>'}
          >
            <SecretInput
              id="cl-token"
              value={values.token}
              onChange={(e) => update('token', e.target.value)}
              placeholder={connector?.tokenHint ? 'Leave blank to keep the saved token' : 'eyJhbGciOiJSUzI1NiIs…'}
              invalid={Boolean(errors.token)}
            />
          </FormField>
          <FormField
            id="cl-ca"
            label="Certificate authority data"
            hint={connector?.hasCaData ? 'CA data is saved. Leave blank to keep it.' : 'Base64-encoded CA certificate (certificate-authority-data).'}
          >
            <TextArea
              id="cl-ca"
              rows={3}
              value={values.caData}
              onChange={(e) => update('caData', e.target.value)}
              placeholder="LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t…"
              mono
            />
          </FormField>
          <Toggle
            id="cl-insecure"
            checked={values.insecureSkipTLSVerify}
            onChange={(v) => update('insecureSkipTLSVerify', v)}
            label="Skip TLS verification"
            description="Only for local clusters with self-signed certificates."
          />
          {values.insecureSkipTLSVerify && (
            <p className="flex items-center gap-1.5 text-[11px] text-amber-800">
              <AlertTriangle size={13} /> Traffic to this cluster will not be protected against interception.
            </p>
          )}
        </>
      )}

      <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60">
        <Toggle
          id="cl-default"
          checked={values.isDefault}
          onChange={(v) => update('isDefault', v)}
          label="Default cluster"
          description="Pre-selected in the resource browser and new projects."
          disabled={connector?.isDefault}
        />
      </div>
    </ConnectorFormModal>
  );
};
