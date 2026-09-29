import React, { useState } from 'react';
import { ConnectorFormModal } from './ConnectorFormModal';
import { ConnectorLogoTile } from './ConnectorLogos';
import { FormField, SecretInput, TextInput, Toggle } from '../common/Form';
import { useForm, FormErrors } from '../../hooks/useForm';
import { dnsApi, DnsConnector, DnsConnectorInput } from '../../api/dnsApi';
import { getApiErrorMessage } from '../../api/client';
import { ConnectionTestResult } from '../../types';

type DnsFormValues = {
  name: string;
  apiToken: string;
  accountId: string;
  zones: string;
  isDefault: boolean;
  isActive: boolean;
};

const ZONE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const splitZones = (v: string) => [...new Set(v.split(/[\s,]+/).map((z) => z.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean))];

interface DnsConnectorModalProps {
  connector: DnsConnector | null;
  isFirst: boolean;
  onClose: () => void;
  onSaved: (connector: DnsConnector, message: string, testOk: boolean) => void;
}

export const DnsConnectorModal: React.FC<DnsConnectorModalProps> = ({ connector, isFirst, onClose, onSaved }) => {
  const isEdit = Boolean(connector);

  const validate = (v: DnsFormValues): FormErrors<DnsFormValues> => {
    const errors: FormErrors<DnsFormValues> = {};
    if (!v.name.trim()) errors.name = 'Enter a name for this connector';
    const token = v.apiToken.trim();
    if (!token && !connector?.hasToken) errors.apiToken = 'Enter a Cloudflare API token';
    else if (token && /^[a-f0-9]{37}$/i.test(token)) errors.apiToken = 'That is the Global API Key. Create a scoped API token instead.';
    else if (token && (token.length < 20 || /\s/.test(token))) errors.apiToken = 'That does not look like a Cloudflare API token';
    if (v.accountId.trim() && !/^[a-f0-9]{32}$/i.test(v.accountId.trim())) errors.accountId = 'Account ID is 32 hex characters';
    const bad = splitZones(v.zones).find((z) => !ZONE.test(z));
    if (bad) errors.zones = `${bad} is not a valid domain`;
    return errors;
  };

  const { values, errors, setValue, validateFields } = useForm<DnsFormValues>(
    {
      name: connector?.name ?? '',
      apiToken: '',
      accountId: connector?.accountId ?? '',
      zones: (connector?.zones || []).join(', '),
      isDefault: connector?.isDefault ?? isFirst,
      isActive: connector?.isActive ?? true,
    },
    validate
  );

  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const update = <K extends keyof DnsFormValues>(key: K, value: DnsFormValues[K]) => {
    setValue(key, value);
    if (key === 'apiToken' || key === 'accountId' || key === 'zones') setTestResult(null);
  };

  const buildPayload = (): DnsConnectorInput => ({
    name: values.name.trim(),
    apiToken: values.apiToken.trim() || undefined,
    accountId: values.accountId.trim(),
    zones: splitZones(values.zones),
    isDefault: values.isDefault,
    isActive: values.isActive,
  });

  const handleTest = async () => {
    if (!validateFields(['apiToken', 'accountId', 'zones'])) return;
    setIsTesting(true);
    setFormError(null);
    try {
      setTestResult(await dnsApi.test({ ...buildPayload(), name: values.name.trim() || 'test', id: connector?._id }));
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
      const res = connector?._id ? await dnsApi.update(connector._id, buildPayload()) : await dnsApi.create(buildPayload());
      onSaved(res.connector, res.test.ok ? `${res.message}. ${res.test.message}` : `${res.message}, but: ${res.test.message}`, res.test.ok);
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Failed to save the DNS connector'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ConnectorFormModal
      title={isEdit ? `Edit ${connector!.name}` : 'Add Cloudflare DNS'}
      subtitle="A scoped Cloudflare API token lets DevOps Intelligence read and manage DNS records for your domains"
      icon={<ConnectorLogoTile kind="dns" />}
      formId="dns-connector-form"
      submitLabel={isEdit ? 'Save changes' : 'Add connector'}
      isSaving={isSaving}
      isTesting={isTesting}
      testResult={testResult}
      formError={formError}
      onTest={handleTest}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <FormField id="dns-name" label="Name" required error={errors.name}>
        <TextInput
          id="dns-name"
          value={values.name}
          onChange={(e) => update('name', e.target.value)}
          placeholder="e.g. Cloudflare – mycompany.com"
          invalid={Boolean(errors.name)}
          maxLength={80}
        />
      </FormField>

      <FormField
        id="dns-token"
        label="API token"
        required={!connector?.hasToken}
        error={errors.apiToken}
        hint={
          connector?.hasToken
            ? `Saved token ${connector.tokenHint}. Leave blank to keep it.`
            : 'Cloudflare → My Profile → API Tokens → Create Token → "Edit zone DNS" template.'
        }
      >
        <SecretInput
          id="dns-token"
          value={values.apiToken}
          onChange={(e) => update('apiToken', e.target.value)}
          placeholder={connector?.hasToken ? 'Leave blank to keep the saved token' : 'Paste the API token (shown once by Cloudflare)'}
          invalid={Boolean(errors.apiToken)}
          autoComplete="off"
        />
      </FormField>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField id="dns-account" label="Account ID" error={errors.accountId} hint="Optional. Needed for account-owned tokens and Cloudflare Tunnel later.">
          <TextInput
            id="dns-account"
            value={values.accountId}
            onChange={(e) => update('accountId', e.target.value)}
            placeholder="32 hex characters, e.g. 0123abcd…"
            invalid={Boolean(errors.accountId)}
            mono
            maxLength={64}
          />
        </FormField>
        <FormField id="dns-zones" label="Limit to zones" error={errors.zones} hint="Optional, comma separated. Empty = every zone the token can see.">
          <TextInput
            id="dns-zones"
            value={values.zones}
            onChange={(e) => update('zones', e.target.value)}
            placeholder="example.com, example.dev"
            invalid={Boolean(errors.zones)}
            mono
          />
        </FormField>
      </div>

      <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60 space-y-3">
        <Toggle
          id="dns-default"
          checked={values.isDefault}
          onChange={(v) => update('isDefault', v)}
          label="Default DNS connector"
          description="Used when a project environment links a hostname without picking a connector."
          disabled={connector?.isDefault}
        />
        <Toggle id="dns-active" checked={values.isActive} onChange={(v) => update('isActive', v)} label="Enabled" description="Disabled connectors are kept but not used." />
      </div>
    </ConnectorFormModal>
  );
};
