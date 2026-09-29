import React, { useEffect, useState } from 'react';
import { ConnectorFormModal } from './ConnectorFormModal';
import { ObservabilityLogoTile } from './ObservabilityLogos';
import { Dropdown } from '../common/Dropdown';
import { FormField, SecretInput, SegmentedControl, TextInput, Toggle } from '../common/Form';
import { useForm, FormErrors, isHttpUrl } from '../../hooks/useForm';
import { clusterApi } from '../../api/clusterApi';
import { getApiErrorMessage } from '../../api/client';
import {
  ObservabilityConnector,
  ObservabilityConnectorInput,
  ObservabilityKind,
  observabilityApi,
} from '../../api/observabilityApi';
import { Cluster, ConnectionTestResult } from '../../types';

type FormValues = {
  kind: ObservabilityKind;
  name: string;
  access: 'service' | 'url';
  clusterName: string;
  namespace: string;
  service: string;
  port: string;
  scheme: 'http' | 'https';
  url: string;
  publicUrl: string;
  authType: 'none' | 'basic' | 'bearer';
  username: string;
  password: string;
  token: string;
  insecure: boolean;
  isDefault: boolean;
  isActive: boolean;
};

const KIND_OPTIONS: { value: ObservabilityKind; label: string; description: string }[] = [
  { value: 'prometheus', label: 'Prometheus', description: 'Metrics: CPU, memory, restarts' },
  { value: 'grafana', label: 'Grafana', description: 'Dashboards to open from DevOps Intelligence' },
  { value: 'loki', label: 'Loki', description: 'Log history beyond the pod' },
];

const ACCESS_OPTIONS: { value: 'service' | 'url'; label: string; description: string }[] = [
  { value: 'service', label: 'Through the cluster (recommended)', description: 'Kubernetes service proxy, no port-forward needed' },
  { value: 'url', label: 'URL', description: 'Ingress, port-forward or hosted service' },
];

const AUTH_OPTIONS: { value: 'none' | 'basic' | 'bearer'; label: string; description: string }[] = [
  { value: 'none', label: 'No auth', description: 'Default for in-cluster services' },
  { value: 'basic', label: 'Username & password', description: 'Basic auth' },
  { value: 'bearer', label: 'Token', description: 'Bearer / API key' },
];

// Defaults for a kube-prometheus-stack / grafana/loki install.
const DEFAULTS: Record<ObservabilityKind, { name: string; service: string; port: string; url: string }> = {
  prometheus: { name: 'Prometheus', service: 'kube-prometheus-stack-prometheus', port: '9090', url: 'http://localhost:9090' },
  grafana: { name: 'Grafana', service: 'kube-prometheus-stack-grafana', port: '80', url: 'http://localhost:3000' },
  loki: { name: 'Loki', service: 'loki', port: '3100', url: 'http://localhost:3100' },
};

const DNS = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;

interface ObservabilityConnectorModalProps {
  connector: ObservabilityConnector | null; // null = create
  onClose: () => void;
  onSaved: (connector: ObservabilityConnector, message: string, testOk: boolean) => void;
}

export const ObservabilityConnectorModal: React.FC<ObservabilityConnectorModalProps> = ({ connector, onClose, onSaved }) => {
  const isEdit = Boolean(connector);
  const [clusters, setClusters] = useState<Cluster[]>([]);

  const validate = (v: FormValues): FormErrors<FormValues> => {
    const errors: FormErrors<FormValues> = {};
    if (!v.name.trim()) errors.name = 'Enter a name';
    if (v.access === 'service') {
      if (!v.clusterName) errors.clusterName = 'Pick the cluster that runs the service';
      if (!DNS.test(v.namespace.trim())) errors.namespace = 'Enter a valid namespace';
      if (!DNS.test(v.service.trim())) errors.service = 'Enter a valid service name';
      const port = Number(v.port);
      if (!(port > 0 && port < 65536)) errors.port = 'Enter a port between 1 and 65535';
    } else if (!isHttpUrl(v.url)) errors.url = 'Enter a valid URL, e.g. http://localhost:9090';
    if (v.publicUrl.trim() && !isHttpUrl(v.publicUrl)) errors.publicUrl = 'Enter a valid URL, e.g. http://localhost:3000';
    if (v.authType === 'basic') {
      if (!v.username.trim()) errors.username = 'Enter a username';
      if (!v.password && !connector?.hasPassword) errors.password = 'Enter a password';
    }
    if (v.authType === 'bearer' && !v.token.trim() && !connector?.hasToken) errors.token = 'Enter a token';
    return errors;
  };

  const initialKind = connector?.kind ?? 'prometheus';
  const { values, errors, setValue, setValues, validateFields } = useForm<FormValues>(
    {
      kind: initialKind,
      name: connector?.name ?? DEFAULTS[initialKind].name,
      access: connector?.access ?? 'service',
      clusterName: connector?.clusterName ?? '',
      namespace: connector?.namespace || 'monitoring',
      service: connector?.service || DEFAULTS[initialKind].service,
      port: String(connector?.port || DEFAULTS[initialKind].port),
      scheme: connector?.scheme ?? 'http',
      url: connector?.url || DEFAULTS[initialKind].url,
      publicUrl: connector?.publicUrl ?? '',
      authType: connector?.authType ?? 'none',
      username: connector?.username ?? '',
      password: '',
      token: '',
      insecure: connector?.insecure ?? false,
      isDefault: connector?.isDefault ?? false,
      isActive: connector?.isActive ?? true,
    },
    validate
  );

  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    clusterApi
      .getAll()
      .then((list) => {
        setClusters(list);
        if (!connector) {
          const preferred = list.find((c) => c.isDefault) || list[0];
          if (preferred) setValue('clusterName', preferred.name);
        }
      })
      .catch(() => setClusters([]));
  }, [connector, setValue]);

  const update = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValue(key, value);
    if (!['name', 'isDefault', 'isActive', 'publicUrl'].includes(key)) setTestResult(null);
  };

  // Switching kind on create swaps in that kind's usual service, port and name.
  const changeKind = (kind: ObservabilityKind) => {
    const prev = DEFAULTS[values.kind];
    const next = DEFAULTS[kind];
    setValues((v) => ({
      ...v,
      kind,
      name: !v.name.trim() || v.name === prev.name ? next.name : v.name,
      service: v.service === prev.service ? next.service : v.service,
      port: v.port === prev.port ? next.port : v.port,
      url: v.url === prev.url ? next.url : v.url,
      publicUrl: kind === 'grafana' && !v.publicUrl ? 'http://localhost:3000' : v.publicUrl,
    }));
    setTestResult(null);
  };

  const buildPayload = (): ObservabilityConnectorInput => ({
    name: values.name.trim(),
    kind: values.kind,
    access: values.access,
    clusterName: values.clusterName,
    namespace: values.namespace.trim(),
    service: values.service.trim(),
    port: Number(values.port) || undefined,
    scheme: values.scheme,
    url: values.url.trim(),
    publicUrl: values.publicUrl.trim(),
    authType: values.authType,
    username: values.username.trim() || undefined,
    password: values.password || undefined,
    token: values.token.trim() || undefined,
    insecure: values.insecure,
    isDefault: values.isDefault,
    isActive: values.isActive,
  });

  const handleTest = async () => {
    if (!validateFields(['clusterName', 'namespace', 'service', 'port', 'url', 'username', 'password', 'token'])) return;
    setIsTesting(true);
    setFormError(null);
    try {
      setTestResult(await observabilityApi.testConnection({ ...buildPayload(), id: connector?._id }));
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
      const res = connector
        ? await observabilityApi.update(connector._id, buildPayload())
        : await observabilityApi.create(buildPayload());
      onSaved(res.connector, res.message, res.connector.status === 'Connected');
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Failed to save the connector'));
    } finally {
      setIsSaving(false);
    }
  };

  const kindLabel = KIND_OPTIONS.find((k) => k.value === values.kind)?.label || 'connector';

  return (
    <ConnectorFormModal
      title={isEdit ? `Edit ${connector!.name}` : 'Add observability connector'}
      subtitle="Prometheus for metrics, Loki for log history, Grafana for dashboards"
      icon={<ObservabilityLogoTile kind={values.kind} />}
      formId="observability-connector-form"
      submitLabel={isEdit ? 'Save changes' : `Add ${kindLabel}`}
      isSaving={isSaving}
      isTesting={isTesting}
      testResult={testResult}
      formError={formError}
      onTest={handleTest}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      {isEdit ? (
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <ObservabilityLogoTile kind={values.kind} size="sm" />
          <span className="font-semibold text-slate-800">{kindLabel}</span>
          <span className="text-slate-500">(the kind cannot be changed)</span>
        </div>
      ) : (
        <div>
          <span className="block text-xs font-semibold text-slate-700 mb-1.5">Kind</span>
          <SegmentedControl name="ob-kind" value={values.kind} options={KIND_OPTIONS} onChange={changeKind} />
        </div>
      )}

      <FormField id="ob-name" label="Name" required error={errors.name}>
        <TextInput
          id="ob-name"
          value={values.name}
          onChange={(e) => update('name', e.target.value)}
          placeholder="e.g. Prometheus (minikube)"
          invalid={Boolean(errors.name)}
          maxLength={80}
        />
      </FormField>

      <div>
        <span className="block text-xs font-semibold text-slate-700 mb-1.5">How DevOps Intelligence reaches it</span>
        <SegmentedControl name="ob-access" value={values.access} options={ACCESS_OPTIONS} onChange={(v) => update('access', v)} />
      </div>

      {values.access === 'service' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField id="ob-cluster" label="Cluster" required error={errors.clusterName} hint="Managed in Connectors → Kubernetes Clusters">
            <Dropdown
              id="ob-cluster"
              fullWidth
              mono
              value={values.clusterName}
              onChange={(v) => update('clusterName', v)}
              options={clusters.map((c) => ({ value: c.name, label: c.name, sublabel: c.status }))}
              placeholder={clusters.length ? 'Select cluster' : 'No cluster connectors'}
              invalid={Boolean(errors.clusterName)}
            />
          </FormField>
          <FormField id="ob-namespace" label="Namespace" required error={errors.namespace}>
            <TextInput
              id="ob-namespace"
              mono
              value={values.namespace}
              onChange={(e) => update('namespace', e.target.value.trim())}
              placeholder="monitoring"
              invalid={Boolean(errors.namespace)}
            />
          </FormField>
          <FormField id="ob-service" label="Service" required error={errors.service}>
            <TextInput
              id="ob-service"
              mono
              value={values.service}
              onChange={(e) => update('service', e.target.value.trim())}
              invalid={Boolean(errors.service)}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="ob-port" label="Port" required error={errors.port}>
              <TextInput
                id="ob-port"
                mono
                inputMode="numeric"
                value={values.port}
                onChange={(e) => update('port', e.target.value.replace(/[^0-9]/g, ''))}
                invalid={Boolean(errors.port)}
              />
            </FormField>
            <FormField id="ob-scheme" label="Scheme">
              <Dropdown
                id="ob-scheme"
                fullWidth
                mono
                value={values.scheme}
                onChange={(v) => update('scheme', v as 'http' | 'https')}
                options={[
                  { value: 'http', label: 'http' },
                  { value: 'https', label: 'https' },
                ]}
              />
            </FormField>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <FormField id="ob-url" label="URL" required error={errors.url}>
            <TextInput
              id="ob-url"
              type="url"
              mono
              value={values.url}
              onChange={(e) => update('url', e.target.value)}
              placeholder={DEFAULTS[values.kind].url}
              invalid={Boolean(errors.url)}
            />
          </FormField>
          <Toggle
            id="ob-insecure"
            checked={values.insecure}
            onChange={(v) => update('insecure', v)}
            label="Skip TLS verification"
            description="Only for self-signed certificates."
          />
        </div>
      )}

      {values.kind === 'grafana' && (
        <FormField
          id="ob-public"
          label="Browser URL"
          error={errors.publicUrl}
          hint="Where your browser opens Grafana, e.g. http://localhost:3000 after kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80"
        >
          <TextInput
            id="ob-public"
            type="url"
            mono
            value={values.publicUrl}
            onChange={(e) => update('publicUrl', e.target.value)}
            placeholder="http://localhost:3000"
            invalid={Boolean(errors.publicUrl)}
          />
        </FormField>
      )}

      <div>
        <span className="block text-xs font-semibold text-slate-700 mb-1.5">Authentication</span>
        <SegmentedControl name="ob-auth" value={values.authType} options={AUTH_OPTIONS} onChange={(v) => update('authType', v)} />
      </div>

      {values.authType === 'basic' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField id="ob-username" label="Username" required error={errors.username}>
            <TextInput
              id="ob-username"
              mono
              autoComplete="off"
              value={values.username}
              onChange={(e) => update('username', e.target.value)}
              invalid={Boolean(errors.username)}
            />
          </FormField>
          <FormField
            id="ob-password"
            label="Password"
            required={!connector?.hasPassword}
            error={errors.password}
            hint={connector?.hasPassword ? 'A password is saved. Leave blank to keep it.' : undefined}
          >
            <SecretInput
              id="ob-password"
              value={values.password}
              onChange={(e) => update('password', e.target.value)}
              placeholder={connector?.hasPassword ? 'Leave blank to keep' : ''}
              invalid={Boolean(errors.password)}
            />
          </FormField>
        </div>
      )}

      {values.authType === 'bearer' && (
        <FormField
          id="ob-token"
          label="Token"
          required={!connector?.hasToken}
          error={errors.token}
          hint={connector?.hasToken ? `Saved token ${connector.tokenHint || ''}. Leave blank to keep it.` : undefined}
        >
          <SecretInput
            id="ob-token"
            value={values.token}
            onChange={(e) => update('token', e.target.value)}
            placeholder={connector?.hasToken ? 'Leave blank to keep the saved token' : ''}
            invalid={Boolean(errors.token)}
          />
        </FormField>
      )}

      <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60 space-y-3">
        <Toggle
          id="ob-default"
          checked={values.isDefault}
          onChange={(v) => update('isDefault', v)}
          label={`Default ${kindLabel}`}
          description={`The Logs and Metrics pages use the default ${kindLabel}. The first one added becomes the default.`}
          disabled={connector?.isDefault}
        />
        <Toggle
          id="ob-active"
          checked={values.isActive}
          onChange={(v) => update('isActive', v)}
          label="Enabled"
          description="Disabled connectors are kept but not used."
        />
      </div>
    </ConnectorFormModal>
  );
};
