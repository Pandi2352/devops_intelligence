import React, { useEffect, useState } from 'react';
import { ConnectorFormModal } from './ConnectorFormModal';
import { ConnectorLogoTile } from './ConnectorLogos';
import { Dropdown } from '../common/Dropdown';
import { FormField, SecretInput, SegmentedControl, TextInput, Toggle } from '../common/Form';
import { useForm, FormErrors, isHttpUrl } from '../../hooks/useForm';
import { clusterApi } from '../../api/clusterApi';
import { getApiErrorMessage } from '../../api/client';
import { DiscoveredSonar, SonarConnector, SonarConnectorInput, securityApi } from '../../api/securityApi';
import { Cluster, ConnectionTestResult } from '../../types';

type FormValues = {
  name: string;
  access: 'service' | 'url';
  clusterName: string;
  namespace: string;
  service: string;
  port: string;
  url: string;
  publicUrl: string;
  organization: string;
  token: string;
  isDefault: boolean;
  isActive: boolean;
};

const ACCESS_OPTIONS: { value: 'service' | 'url'; label: string; description: string }[] = [
  { value: 'service', label: 'Through the cluster (recommended)', description: 'Kubernetes service proxy, no port-forward needed' },
  { value: 'url', label: 'URL', description: 'Ingress, port-forward or SonarCloud' },
];

const DNS = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;

interface SonarConnectorModalProps {
  connector: SonarConnector | null; // null = create
  /** Values found by Discover in cluster, used to pre-fill a new connector. */
  prefill?: DiscoveredSonar | null;
  isFirst?: boolean;
  onClose: () => void;
  onSaved: (connector: SonarConnector, message: string, testOk: boolean) => void;
}

export const SonarConnectorModal: React.FC<SonarConnectorModalProps> = ({ connector, prefill, isFirst, onClose, onSaved }) => {
  const isEdit = Boolean(connector);
  const [clusters, setClusters] = useState<Cluster[]>([]);

  const validate = (v: FormValues): FormErrors<FormValues> => {
    const errors: FormErrors<FormValues> = {};
    if (!v.name.trim()) errors.name = 'Enter a name';
    if (v.access === 'service') {
      if (!v.clusterName) errors.clusterName = 'Pick the cluster that runs SonarQube';
      if (!DNS.test(v.namespace.trim())) errors.namespace = 'Enter a valid namespace';
      if (!DNS.test(v.service.trim())) errors.service = 'Enter a valid service name';
      const port = Number(v.port);
      if (!(port > 0 && port < 65536)) errors.port = 'Enter a port between 1 and 65535';
    } else if (!isHttpUrl(v.url)) errors.url = 'Enter a valid URL, e.g. https://sonarcloud.io';
    if (v.publicUrl.trim() && !isHttpUrl(v.publicUrl)) errors.publicUrl = 'Enter a valid URL, e.g. http://localhost:9000';
    if (!v.token.trim() && !connector?.hasToken) errors.token = 'Enter a SonarQube token';
    return errors;
  };

  const { values, errors, setValue, validateFields } = useForm<FormValues>(
    {
      name: connector?.name ?? prefill?.suggestedName ?? 'SonarQube',
      access: connector?.access ?? 'service',
      clusterName: connector?.clusterName || prefill?.clusterName || '',
      namespace: connector?.namespace || prefill?.namespace || 'sonarqube',
      service: connector?.service || prefill?.service || 'sonarqube',
      port: String(connector?.port || prefill?.port || 9000),
      url: connector?.url ?? '',
      publicUrl: connector?.publicUrl ?? (prefill ? 'http://localhost:9000' : ''),
      organization: connector?.organization ?? '',
      token: '',
      isDefault: connector?.isDefault ?? Boolean(isFirst),
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
        if (!connector && !prefill?.clusterName) {
          const preferred = list.find((c) => c.isDefault) || list[0];
          if (preferred) setValue('clusterName', preferred.name);
        }
      })
      .catch(() => setClusters([]));
  }, [connector, prefill, setValue]);

  const update = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValue(key, value);
    if (!['name', 'isDefault', 'isActive', 'publicUrl'].includes(key)) setTestResult(null);
  };

  const buildPayload = (): SonarConnectorInput => ({
    name: values.name.trim(),
    access: values.access,
    clusterName: values.clusterName,
    namespace: values.namespace.trim(),
    service: values.service.trim(),
    port: Number(values.port) || undefined,
    url: values.url.trim(),
    publicUrl: values.publicUrl.trim(),
    organization: values.access === 'url' ? values.organization.trim() : '',
    token: values.token.trim() || undefined,
    isDefault: values.isDefault,
    isActive: values.isActive,
  });

  const handleTest = async () => {
    if (!validateFields(['clusterName', 'namespace', 'service', 'port', 'url', 'token'])) return;
    setIsTesting(true);
    setFormError(null);
    try {
      setTestResult(await securityApi.testSonar({ ...buildPayload(), id: connector?._id }));
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
      const res = connector ? await securityApi.updateSonar(connector._id, buildPayload()) : await securityApi.createSonar(buildPayload());
      onSaved(res.connector, res.message, res.connector.status === 'Connected');
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Failed to save the connector'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ConnectorFormModal
      title={isEdit ? `Edit ${connector!.name}` : 'Add SonarQube'}
      subtitle="Code quality and quality gates for project releases"
      icon={<ConnectorLogoTile kind="security" />}
      formId="sonar-connector-form"
      submitLabel={isEdit ? 'Save changes' : 'Add SonarQube'}
      isSaving={isSaving}
      isTesting={isTesting}
      testResult={testResult}
      formError={formError}
      onTest={handleTest}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <FormField id="sq-name" label="Name" required error={errors.name}>
        <TextInput
          id="sq-name"
          value={values.name}
          onChange={(e) => update('name', e.target.value)}
          placeholder="e.g. SonarQube (minikube)"
          invalid={Boolean(errors.name)}
          maxLength={80}
        />
      </FormField>

      <div>
        <span className="block text-xs font-semibold text-slate-700 mb-1.5">How DevOps Intelligence reaches it</span>
        <SegmentedControl name="sq-access" value={values.access} options={ACCESS_OPTIONS} onChange={(v) => update('access', v)} />
      </div>

      {values.access === 'service' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField id="sq-cluster" label="Cluster" required error={errors.clusterName} hint="Managed in Connectors → Kubernetes Clusters">
            <Dropdown
              id="sq-cluster"
              fullWidth
              mono
              value={values.clusterName}
              onChange={(v) => update('clusterName', v)}
              options={clusters.map((c) => ({ value: c.name, label: c.name, sublabel: c.status }))}
              placeholder={clusters.length ? 'Select cluster' : 'No cluster connectors'}
              invalid={Boolean(errors.clusterName)}
            />
          </FormField>
          <FormField id="sq-namespace" label="Namespace" required error={errors.namespace}>
            <TextInput
              id="sq-namespace"
              mono
              value={values.namespace}
              onChange={(e) => update('namespace', e.target.value.trim())}
              placeholder="sonarqube"
              invalid={Boolean(errors.namespace)}
            />
          </FormField>
          <FormField id="sq-service" label="Service" required error={errors.service}>
            <TextInput
              id="sq-service"
              mono
              value={values.service}
              onChange={(e) => update('service', e.target.value.trim())}
              placeholder="sonarqube"
              invalid={Boolean(errors.service)}
            />
          </FormField>
          <FormField id="sq-port" label="Port" required error={errors.port}>
            <TextInput
              id="sq-port"
              mono
              inputMode="numeric"
              value={values.port}
              onChange={(e) => update('port', e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="9000"
              invalid={Boolean(errors.port)}
            />
          </FormField>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField id="sq-url" label="URL" required error={errors.url}>
            <TextInput
              id="sq-url"
              type="url"
              mono
              value={values.url}
              onChange={(e) => update('url', e.target.value)}
              placeholder="https://sonarcloud.io"
              invalid={Boolean(errors.url)}
            />
          </FormField>
          <FormField id="sq-org" label="Organization" hint="SonarCloud only">
            <TextInput
              id="sq-org"
              mono
              value={values.organization}
              onChange={(e) => update('organization', e.target.value.trim())}
              placeholder="my-org"
            />
          </FormField>
        </div>
      )}

      <FormField
        id="sq-public"
        label="Browser URL"
        error={errors.publicUrl}
        hint="What your browser opens, e.g. http://localhost:9000 via port-forward"
      >
        <TextInput
          id="sq-public"
          type="url"
          mono
          value={values.publicUrl}
          onChange={(e) => update('publicUrl', e.target.value)}
          placeholder="http://localhost:9000"
          invalid={Boolean(errors.publicUrl)}
        />
      </FormField>

      <FormField
        id="sq-token"
        label="Token"
        required={!connector?.hasToken}
        error={errors.token}
        hint={
          connector?.hasToken
            ? `Saved token ${connector.tokenHint || ''}. Leave blank to keep it.`
            : 'SonarQube → My Account → Security → Generate token (type User token)'
        }
      >
        <SecretInput
          id="sq-token"
          value={values.token}
          onChange={(e) => update('token', e.target.value)}
          placeholder={connector?.hasToken ? 'Leave blank to keep the saved token' : 'squ_…'}
          invalid={Boolean(errors.token)}
        />
      </FormField>

      <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60 space-y-3">
        <Toggle
          id="sq-default"
          checked={values.isDefault}
          onChange={(v) => update('isDefault', v)}
          label="Default SonarQube"
          description="Projects without their own SonarQube choice use the default. The first one added becomes the default."
          disabled={connector?.isDefault}
        />
        <Toggle
          id="sq-active"
          checked={values.isActive}
          onChange={(v) => update('isActive', v)}
          label="Enabled"
          description="Disabled connectors are kept but not used."
        />
      </div>
    </ConnectorFormModal>
  );
};
