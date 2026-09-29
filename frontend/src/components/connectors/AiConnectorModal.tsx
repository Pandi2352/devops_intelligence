import React, { useState } from 'react';
import { ChevronRight, ListRestart, PencilLine } from 'lucide-react';
import { ConnectorFormModal } from './ConnectorFormModal';
import { ConnectorLogoTile } from './ConnectorLogos';
import { Dropdown } from '../common/Dropdown';
import { Button } from '../common/Button';
import { FormField, SecretInput, SegmentedControl, TextInput, Toggle } from '../common/Form';
import { useForm, FormErrors, isHttpUrl } from '../../hooks/useForm';
import { aiApi, AiConnector, AiConnectorInput } from '../../api/starterApi';
import { getApiErrorMessage } from '../../api/client';
import { ConnectionTestResult } from '../../types';

type Provider = AiConnectorInput['provider'];

type FormValues = {
  name: string;
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  organization: string;
  project: string;
  defaultModel: string;
  maxOutputTokens: string;
  isDefault: boolean;
  isActive: boolean;
};

const OPENAI_URL = 'https://api.openai.com/v1';
const MIN_TOKENS = 2000;
const MAX_TOKENS = 128000;

const PROVIDER_OPTIONS: { value: Provider; label: string; description: string }[] = [
  { value: 'openai', label: 'OpenAI', description: 'ChatGPT models through the OpenAI API' },
  { value: 'openai-compatible', label: 'OpenAI-compatible', description: 'Azure, OpenRouter, vLLM, Ollama or any /v1 API' },
];

// Fields that change what the key can reach; editing them invalidates the loaded model list.
const CONNECTION_FIELDS: (keyof FormValues)[] = ['provider', 'baseUrl', 'apiKey', 'organization', 'project'];
const ADVANCED_FIELDS: (keyof FormValues)[] = ['baseUrl', 'organization', 'project', 'maxOutputTokens'];

interface AiConnectorModalProps {
  connector: AiConnector | null; // null = create
  isFirst: boolean;
  onClose: () => void;
  onSaved: (connector: AiConnector, message: string, testOk: boolean) => void;
}

export const AiConnectorModal: React.FC<AiConnectorModalProps> = ({ connector, isFirst, onClose, onSaved }) => {
  const isEdit = Boolean(connector);

  const validate = (v: FormValues): FormErrors<FormValues> => {
    const errors: FormErrors<FormValues> = {};
    if (!v.name.trim()) errors.name = 'Enter a name for this connector';
    const key = v.apiKey.trim();
    if (!key && !connector?.hasKey) errors.apiKey = 'Enter an API key';
    else if (key && /\s/.test(key)) errors.apiKey = 'The API key cannot contain spaces';
    if (!isHttpUrl(v.baseUrl)) errors.baseUrl = 'Enter a valid URL, e.g. https://api.openai.com/v1';
    if (/\s/.test(v.defaultModel.trim())) errors.defaultModel = 'A model id has no spaces';
    const tokens = Number(v.maxOutputTokens);
    if (!Number.isInteger(tokens) || tokens < MIN_TOKENS || tokens > MAX_TOKENS) {
      errors.maxOutputTokens = `Enter a number between ${MIN_TOKENS.toLocaleString()} and ${MAX_TOKENS.toLocaleString()}`;
    }
    return errors;
  };

  const { values, errors, setValue, validateFields } = useForm<FormValues>(
    {
      name: connector?.name ?? '',
      provider: connector?.provider ?? 'openai',
      baseUrl: connector?.baseUrl || OPENAI_URL,
      apiKey: '',
      organization: connector?.organization ?? '',
      project: connector?.project ?? '',
      defaultModel: connector?.defaultModel ?? '',
      maxOutputTokens: String(connector?.maxOutputTokens || 16000),
      isDefault: connector?.isDefault ?? isFirst,
      isActive: connector?.isActive ?? true,
    },
    validate
  );

  const [models, setModels] = useState<string[]>(connector?.models ?? []);
  const [manualModel, setManualModel] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(connector && (connector.organization || connector.project || (connector.provider === 'openai' && connector.baseUrl !== OPENAI_URL)))
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const isCompatible = values.provider === 'openai-compatible';

  const update = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValue(key, value);
    if (CONNECTION_FIELDS.includes(key)) {
      setTestResult(null);
      setModels([]);
    }
  };

  const changeProvider = (provider: Provider) => {
    update('provider', provider);
    // Switching back to OpenAI restores its endpoint; a compatible API needs its own URL.
    if (provider === 'openai') update('baseUrl', OPENAI_URL);
    else if (values.baseUrl === OPENAI_URL) update('baseUrl', '');
  };

  const buildPayload = (): AiConnectorInput => ({
    name: values.name.trim(),
    provider: values.provider,
    baseUrl: values.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: values.apiKey.trim() || undefined,
    organization: values.organization.trim(),
    project: values.project.trim(),
    defaultModel: values.defaultModel.trim(),
    maxOutputTokens: Number(values.maxOutputTokens),
    isDefault: values.isDefault,
    isActive: values.isActive,
  });

  const openAdvancedOnError = (fields: (keyof FormValues)[]) => {
    const v = validate(values);
    if (fields.some((f) => ADVANCED_FIELDS.includes(f) && v[f])) setShowAdvanced(true);
  };

  const handleTest = async () => {
    const fields: (keyof FormValues)[] = ['apiKey', 'baseUrl', 'defaultModel'];
    if (!validateFields(fields)) {
      openAdvancedOnError(fields);
      return;
    }
    setIsTesting(true);
    setFormError(null);
    try {
      const res = await aiApi.test({ ...buildPayload(), name: values.name.trim() || 'test', id: connector?._id });
      setTestResult({ ok: res.ok, message: res.message, details: res.details });
      if (res.models?.length) {
        setModels(res.models);
        setManualModel(false);
      }
    } catch (err) {
      setTestResult({ ok: false, message: getApiErrorMessage(err, 'Connection test failed') });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateFields()) {
      openAdvancedOnError(ADVANCED_FIELDS);
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      const res = connector?._id ? await aiApi.update(connector._id, buildPayload()) : await aiApi.create(buildPayload());
      onSaved(res.connector, res.test.ok ? `${res.message}. ${res.test.message}` : `${res.message}, but: ${res.test.message}`, res.test.ok);
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Failed to save the AI connector'));
    } finally {
      setIsSaving(false);
    }
  };

  // Keep a saved or typed model visible even if the latest list does not contain it.
  const modelOptions = [...new Set([...(values.defaultModel.trim() ? [values.defaultModel.trim()] : []), ...models])]
    .sort((a, b) => a.localeCompare(b))
    .map((m) => ({ value: m, label: m, sublabel: models.includes(m) ? undefined : 'not in the loaded list' }));
  const showPicker = models.length > 0 && !manualModel;

  const baseUrlField = (
    <FormField
      id="ai-base-url"
      label="Base URL"
      required
      error={errors.baseUrl}
      hint={isCompatible ? 'The /v1 endpoint of the OpenAI-compatible API, e.g. https://openrouter.ai/api/v1' : `Leave as ${OPENAI_URL} unless you use a proxy.`}
    >
      <TextInput
        id="ai-base-url"
        type="url"
        mono
        value={values.baseUrl}
        onChange={(e) => update('baseUrl', e.target.value)}
        placeholder={isCompatible ? 'https://openrouter.ai/api/v1' : OPENAI_URL}
        invalid={Boolean(errors.baseUrl)}
      />
    </FormField>
  );

  return (
    <ConnectorFormModal
      title={isEdit ? `Edit ${connector!.name}` : 'Add AI provider'}
      subtitle="An API key lets managers use the Project Starter to draft new projects with an AI model"
      icon={<ConnectorLogoTile kind="ai" />}
      formId="ai-connector-form"
      submitLabel={isEdit ? 'Save changes' : 'Add connector'}
      isSaving={isSaving}
      isTesting={isTesting}
      testResult={testResult}
      formError={formError}
      onTest={handleTest}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <FormField id="ai-name" label="Name" required error={errors.name}>
        <TextInput
          id="ai-name"
          value={values.name}
          onChange={(e) => update('name', e.target.value)}
          placeholder="e.g. ChatGPT – company account"
          invalid={Boolean(errors.name)}
          maxLength={80}
        />
      </FormField>

      <div>
        <span className="block text-xs font-semibold text-slate-700 mb-1.5">Provider</span>
        <SegmentedControl name="ai-provider" value={values.provider} options={PROVIDER_OPTIONS} onChange={changeProvider} />
      </div>

      {isCompatible && baseUrlField}

      <FormField
        id="ai-key"
        label="API key"
        required={!connector?.hasKey}
        error={errors.apiKey}
        hint={
          connector?.hasKey
            ? `Saved key ${connector.keyHint}. Leave blank to keep it.`
            : isCompatible
            ? 'The bearer token of the compatible API.'
            : 'platform.openai.com → API keys → Create new secret key (project key recommended). Needs billing enabled.'
        }
      >
        <SecretInput
          id="ai-key"
          value={values.apiKey}
          onChange={(e) => update('apiKey', e.target.value)}
          placeholder={connector?.hasKey ? 'Leave blank to keep the saved key' : isCompatible ? 'Paste the API key' : 'sk-proj-…'}
          invalid={Boolean(errors.apiKey)}
          autoComplete="off"
        />
      </FormField>

      <div className="p-3 rounded-md border border-violet-200 bg-violet-50/40 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-700">Default model</span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleTest}
            isLoading={isTesting}
            disabled={isSaving}
            leftIcon={<ListRestart size={13} />}
          >
            {models.length ? 'Reload models' : 'Test & load models'}
          </Button>
        </div>
        <FormField
          id="ai-model"
          label="Model"
          error={errors.defaultModel}
          hint={
            showPicker
              ? `Models are listed live from your account (${models.length} available). Required to use the Project Starter.`
              : isCompatible
              ? 'Type the model id, or Test & load models to pick from the provider’s list. Required to use the Project Starter.'
              : 'Models are listed live from your account: Test & load models, then pick one. Required to use the Project Starter.'
          }
        >
          {showPicker ? (
            <Dropdown
              id="ai-model"
              fullWidth
              mono
              size="md"
              searchable
              searchPlaceholder="Filter models…"
              value={values.defaultModel.trim()}
              onChange={(v) => update('defaultModel', v)}
              options={modelOptions}
              placeholder="Select a model"
              invalid={Boolean(errors.defaultModel)}
            />
          ) : (
            <TextInput
              id="ai-model"
              mono
              value={values.defaultModel}
              onChange={(e) => update('defaultModel', e.target.value.trim())}
              placeholder={isCompatible ? 'Model id, e.g. as listed by the provider' : 'Test & load models to pick one'}
              invalid={Boolean(errors.defaultModel)}
              maxLength={200}
            />
          )}
        </FormField>
        {isCompatible && models.length > 0 && (
          <button
            type="button"
            onClick={() => setManualModel((m) => !m)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-700 hover:text-violet-900 hover:underline cursor-pointer"
          >
            <PencilLine size={12} aria-hidden />
            {manualModel ? 'Pick from the loaded list' : 'Type a model id instead'}
          </button>
        )}
      </div>

      <div className="rounded-md border border-slate-200">
        <button
          type="button"
          onClick={() => setShowAdvanced((s) => !s)}
          aria-expanded={showAdvanced}
          aria-controls="ai-advanced"
          className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 rounded-md cursor-pointer"
        >
          <ChevronRight size={14} className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`} aria-hidden />
          Advanced
          <span className="font-normal text-slate-500">
            {isCompatible ? 'organization, project, output limit' : 'base URL, organization, project, output limit'}
          </span>
        </button>
        {showAdvanced && (
          <div id="ai-advanced" className="px-3 pb-3 pt-1 space-y-4">
            {!isCompatible && baseUrlField}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField id="ai-org" label="Organization ID" hint="Optional. Only if the key belongs to several organizations.">
                <TextInput
                  id="ai-org"
                  mono
                  value={values.organization}
                  onChange={(e) => update('organization', e.target.value.trim())}
                  placeholder="org-…"
                  maxLength={100}
                />
              </FormField>
              <FormField id="ai-project" label="Project ID" hint="Optional. Bills usage to this project.">
                <TextInput
                  id="ai-project"
                  mono
                  value={values.project}
                  onChange={(e) => update('project', e.target.value.trim())}
                  placeholder="proj_…"
                  maxLength={100}
                />
              </FormField>
            </div>
            <FormField id="ai-max-tokens" label="Max output tokens" required error={errors.maxOutputTokens} hint="Per AI answer; large projects are generated in batches.">
              <TextInput
                id="ai-max-tokens"
                mono
                inputMode="numeric"
                value={values.maxOutputTokens}
                onChange={(e) => update('maxOutputTokens', e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="16000"
                invalid={Boolean(errors.maxOutputTokens)}
                maxLength={6}
              />
            </FormField>
          </div>
        )}
      </div>

      <div className="p-3 rounded-md border border-slate-200 bg-slate-50/60 space-y-3">
        <Toggle
          id="ai-default"
          checked={values.isDefault}
          onChange={(v) => update('isDefault', v)}
          label="Default AI provider"
          description="The Project Starter uses the default unless a manager picks another one."
          disabled={connector?.isDefault}
        />
        <Toggle id="ai-active" checked={values.isActive} onChange={(v) => update('isActive', v)} label="Enabled" description="Disabled connectors are kept but not used." />
      </div>
    </ConnectorFormModal>
  );
};
