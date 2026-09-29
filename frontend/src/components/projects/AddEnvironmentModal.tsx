import React, { useMemo, useState } from 'react';
import { AlertTriangle, Layers } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Dropdown } from '../common/Dropdown';
import { FormField, TextInput, Toggle } from '../common/Form';
import { useForm, FormErrors } from '../../hooks/useForm';
import { getApiErrorMessage } from '../../api/client';
import { Project, ProjectSetup, ProvisionResult, projectApi } from '../../api/projectApi';
import { DNS_LABEL, ENV_NAME, sortEnvironments } from '../../utils/project';
import { StepList } from './projectUi';

type Values = {
  name: string;
  namespace: string;
  appName: string;
  sourceBranch: string;
  autoSync: boolean;
};

interface AddEnvironmentModalProps {
  project: Project;
  setup: ProjectSetup;
  onClose: () => void;
  onAdded: (result: ProvisionResult) => void;
}

export const AddEnvironmentModal: React.FC<AddEnvironmentModalProps> = ({ project, setup, onClose, onAdded }) => {
  const existing = setup.environments.map((e) => e.name);
  const appRepoName = setup.appRepo?.path.split('/').pop() || project.name;
  const branches = useMemo(() => {
    const names = sortEnvironments(existing, (n) => n);
    const def = setup.appRepo?.defaultBranch;
    return def && !names.includes(def) ? [def, ...names] : names;
  }, [existing, setup.appRepo]);

  const [touched, setTouched] = useState({ namespace: false, appName: false });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisionResult | null>(null);

  const validate = (v: Values): FormErrors<Values> => {
    const errors: FormErrors<Values> = {};
    if (!ENV_NAME.test(v.name)) errors.name = 'Lowercase letters, numbers or dashes, starting with a letter (max 20)';
    else if (existing.includes(v.name)) errors.name = `${v.name} already exists`;
    if (!DNS_LABEL.test(v.namespace)) errors.namespace = 'Must be a valid Kubernetes name (lowercase, dashes, max 63)';
    if (!DNS_LABEL.test(v.appName)) errors.appName = 'Must be a valid ArgoCD app name (lowercase, dashes, max 63)';
    return errors;
  };

  const { values, errors, setValue, validateFields } = useForm<Values>(
    {
      name: '',
      namespace: '',
      appName: '',
      sourceBranch: setup.appRepo?.defaultBranch || branches[0] || '',
      autoSync: true,
    },
    validate
  );

  // Namespace and app name follow the environment name until edited by hand.
  const setName = (raw: string) => {
    const name = raw.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setValue('name', name);
    if (!touched.namespace) setValue('namespace', name ? `${project.name}-${name}` : '');
    if (!touched.appName) setValue('appName', name ? `${appRepoName}-${name}` : '');
    if (['prod', 'production'].includes(name)) setValue('autoSync', false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateFields()) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await projectApi.addEnvironment(project._id, {
        name: values.name,
        namespace: values.namespace,
        appName: values.appName,
        sourceBranch: values.sourceBranch || undefined,
        autoSync: values.autoSync,
      });
      setResult(res);
      onAdded(res);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not add the environment'));
    } finally {
      setIsSaving(false);
    }
  };

  const failed = result?.steps.filter((s) => s.status === 'failed').length ?? 0;
  const formId = 'add-environment-form';

  return (
    <Modal
      isOpen
      onClose={onClose}
      preventClose={isSaving}
      maxWidth="lg"
      icon={<Layers size={18} />}
      title={result ? `Environment ${values.name}` : `Add environment to ${project.name}`}
      subtitle={
        result
          ? result.message
          : 'DevOps Intelligence creates the namespace, registry pull secret, GitOps overlay, ArgoCD app, CI rule and a protected branch.'
      }
      footer={
        result ? (
          <Button onClick={onClose}>{failed ? 'Close' : 'Done'}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" form={formId} isLoading={isSaving}>
              {isSaving ? 'Provisioning…' : 'Add environment'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          {failed > 0 && (
            <div className="p-2.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs" role="status">
              The environment was saved. Fix the failed items, then use <strong>Provision</strong> on its row to retry only what is missing.
            </div>
          )}
          <StepList steps={result.steps} />
          {!failed && (
            <p className="text-xs text-slate-600">
              Next: push to (or merge into) the <span className="font-mono">{values.name}</span> branch. Its pipeline builds a{' '}
              <span className="font-mono">{values.name}</span> image, writes the tag to the overlay, and ArgoCD deploys it.
            </p>
          )}
        </div>
      ) : (
        <form id={formId} onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error && (
            <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2" role="alert">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <FormField id="env-name" label="Environment name" required error={errors.name} hint="Also the branch name and overlay folder">
              <TextInput id="env-name" mono autoFocus value={values.name} invalid={Boolean(errors.name)} placeholder="uat" onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField id="env-source" label="Create branch from" hint="Only used when the branch does not exist yet">
              <Dropdown
                id="env-source"
                fullWidth
                mono
                value={values.sourceBranch}
                onChange={(v) => setValue('sourceBranch', v)}
                options={branches.map((b) => ({ value: b, label: b }))}
                placeholder="Default branch"
              />
            </FormField>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <FormField id="env-namespace" label="Namespace" required error={errors.namespace}>
              <TextInput
                id="env-namespace"
                placeholder={`${project.name}-${values.name || 'uat'}`}
                mono
                value={values.namespace}
                invalid={Boolean(errors.namespace)}
                onChange={(e) => {
                  setTouched((t) => ({ ...t, namespace: true }));
                  setValue('namespace', e.target.value.trim().toLowerCase());
                }}
              />
            </FormField>
            <FormField id="env-app" label="ArgoCD application" required error={errors.appName}>
              <TextInput
                id="env-app"
                placeholder={`${appRepoName}-${values.name || 'uat'}`}
                mono
                value={values.appName}
                invalid={Boolean(errors.appName)}
                onChange={(e) => {
                  setTouched((t) => ({ ...t, appName: true }));
                  setValue('appName', e.target.value.trim().toLowerCase());
                }}
              />
            </FormField>
          </div>

          <Toggle
            id="env-autosync"
            checked={values.autoSync}
            onChange={(v) => setValue('autoSync', v)}
            label="Auto-sync"
            description="ArgoCD applies every new commit to the overlay automatically. Turn off for production so each deploy is a manual sync."
          />

          {values.name && ENV_NAME.test(values.name) && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 space-y-1">
              <div className="font-semibold text-slate-700 text-xs mb-1">Will be set up</div>
              <div>
                Namespace <span className="font-mono text-slate-800">{values.namespace}</span> on{' '}
                <span className="font-mono text-slate-800">{setup.cluster}</span> with pull secret{' '}
                <span className="font-mono text-slate-800">gitlab-registry</span>
              </div>
              <div>
                Overlay <span className="font-mono text-slate-800">{setup.overlayBase}/{values.name}</span> in{' '}
                <span className="font-mono text-slate-800">{setup.gitopsRepo?.path}</span>
              </div>
              <div>
                ArgoCD app <span className="font-mono text-slate-800">{values.appName}</span> ({values.autoSync ? 'auto-sync' : 'manual sync'})
              </div>
              <div>
                Protected branch <span className="font-mono text-slate-800">{values.name}</span> in{' '}
                <span className="font-mono text-slate-800">{setup.appRepo?.path}</span>, added to <span className="font-mono">DEPLOY_BRANCHES</span>
              </div>
            </div>
          )}
        </form>
      )}
    </Modal>
  );
};
