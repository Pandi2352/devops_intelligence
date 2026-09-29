import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { GitBranch, Upload } from 'lucide-react';
import { getApiErrorMessage } from '../../api/client';
import { starterApi, type GitTarget, type PublishInput, type RepoOwner, type StarterRun } from '../../api/starterApi';
import { Button } from '../common/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { FormField, TextArea, TextInput } from '../common/Form';
import { GitHubLogo, GitLabLogo } from '../connectors/ConnectorLogos';
import { REPO_NAME_RE, toRepoName } from './starterMeta';

interface PushTabProps {
  run: StarterRun;
  /** Resolves to an error message to show in the dialog (e.g. 409), or null on success. */
  onPublish: (input: PublishInput) => Promise<string | null>;
}

type Visibility = PublishInput['visibility'];

const selectClass =
  'w-full px-3 py-2 rounded-md bg-white border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-500 disabled:bg-slate-100 disabled:text-slate-500';

export const PushTab: React.FC<PushTabProps> = ({ run, onPublish }) => {
  const [targets, setTargets] = useState<GitTarget[] | null>(null);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [connectorId, setConnectorId] = useState('');
  const [owners, setOwners] = useState<RepoOwner[]>([]);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [ownersError, setOwnersError] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState('');
  const [name, setName] = useState(() => toRepoName(run.plan?.name || run.title || ''));
  const [description, setDescription] = useState(() => (run.plan?.summary || '').slice(0, 350));
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [branch, setBranch] = useState('main');
  const [message, setMessage] = useState('Initial commit from DevOps Intelligence Project Starter');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  useEffect(() => {
    starterApi
      .targets()
      .then((list) => {
        setTargets(list);
        const preferred = list.find((t) => t.isDefault) || list[0];
        if (preferred) setConnectorId(preferred.id);
      })
      .catch((err) => setTargetsError(getApiErrorMessage(err, 'Could not load Git connectors')));
  }, []);

  useEffect(() => {
    if (!connectorId) return;
    let alive = true;
    setOwnersLoading(true);
    setOwnersError(null);
    setOwners([]);
    setOwnerId('');
    starterApi
      .owners(connectorId)
      .then((list) => {
        if (!alive) return;
        setOwners(list);
        setOwnerId(list[0]?.id || '');
      })
      .catch((err) => alive && setOwnersError(getApiErrorMessage(err, 'Could not load owners')))
      .finally(() => alive && setOwnersLoading(false));
    return () => {
      alive = false;
    };
  }, [connectorId]);

  const target = targets?.find((t) => t.id === connectorId);
  const owner = owners.find((o) => o.id === ownerId);
  const internalAllowed = target?.provider === 'gitlab' || (target?.provider === 'github' && owner?.kind === 'org');
  const effectiveVisibility: Visibility = visibility === 'internal' && !internalAllowed ? 'private' : visibility;
  const nameValid = REPO_NAME_RE.test(name);
  const branchValid = /^[A-Za-z0-9._/-]{1,100}$/.test(branch) && !branch.startsWith('/') && !branch.endsWith('/');
  const ownerName = (owner?.name || '').replace(/^@/, '');
  const providerLabel = target?.provider === 'gitlab' ? 'GitLab' : 'GitHub';
  const ready = !!target && !!owner && nameValid && branchValid;

  if (targets === null && !targetsError) return <p className="text-xs text-slate-500">Loading Git connectors…</p>;
  if (targetsError) return <p className="text-xs text-rose-700">{targetsError}</p>;
  if (targets && targets.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 p-6 text-center">
        <p className="text-sm font-semibold text-slate-800">No GitHub or GitLab connector</p>
        <p className="text-xs text-slate-500 mt-1 mb-3">Add a connector with a token that can create repositories, then come back to push.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link to="/connectors?tab=github" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <GitHubLogo size={14} /> Add GitHub
          </Link>
          <Link to="/connectors?tab=gitlab" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <GitLabLogo size={14} /> Add GitLab
          </Link>
        </div>
      </div>
    );
  }

  const submit = async () => {
    if (!target || !owner) return;
    setPublishing(true);
    setPublishError(null);
    const error = await onPublish({
      gitConnectorId: target.id,
      owner: owner.id,
      ownerName,
      name,
      description: description.trim() || undefined,
      visibility: effectiveVisibility,
      branch: branch.trim() || 'main',
      message: message.trim() || undefined,
    });
    setPublishing(false);
    if (error) setPublishError(error);
    else setConfirmOpen(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Creates a new, empty repository and pushes the {run.files.length} reviewed files as a single commit.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField id="push-connector" label="Connector" required>
          <div className="flex items-center gap-2">
            {target?.provider === 'gitlab' ? <GitLabLogo size={18} /> : <GitHubLogo size={18} />}
            <select id="push-connector" value={connectorId} onChange={(e) => setConnectorId(e.target.value)} className={selectClass}>
              {targets?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.provider === 'gitlab' ? 'GitLab' : 'GitHub'} · {t.name}
                  {t.username ? ` (@${t.username})` : ''}
                </option>
              ))}
            </select>
          </div>
        </FormField>
        <FormField id="push-owner" label="Owner" required error={ownersError || undefined} hint={ownersLoading ? 'Loading owners…' : undefined}>
          <select id="push-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} disabled={ownersLoading || owners.length === 0} className={selectClass}>
            {owners.length === 0 && <option value="">{ownersLoading ? 'Loading…' : 'No owners available'}</option>}
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.kind === 'user' ? 'personal' : o.kind})
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="push-name" label="Repository name" required error={name && !nameValid ? 'Use 1-100 letters, digits, dots, dashes or underscores' : !name ? 'Required' : undefined}>
          <TextInput id="push-name" value={name} onChange={(e) => setName(e.target.value)} invalid={!nameValid} mono placeholder="my-new-project" />
        </FormField>
        <FormField id="push-branch" label="Branch" error={branchValid ? undefined : 'Enter a valid branch name'}>
          <TextInput id="push-branch" value={branch} onChange={(e) => setBranch(e.target.value)} invalid={!branchValid} mono placeholder="main" />
        </FormField>
        <FormField id="push-description" label="Description" className="sm:col-span-2">
          <TextInput id="push-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={350} placeholder="Short description shown on the repository page" />
        </FormField>
        <FormField
          id="push-visibility"
          label="Visibility"
          hint={internalAllowed ? undefined : 'Internal is available on GitLab and for GitHub organizations.'}
        >
          <select id="push-visibility" value={effectiveVisibility} onChange={(e) => setVisibility(e.target.value as Visibility)} className={selectClass}>
            <option value="private">Private</option>
            <option value="public">Public</option>
            <option value="internal" disabled={!internalAllowed}>
              Internal
            </option>
          </select>
        </FormField>
        <FormField id="push-message" label="Commit message">
          <TextArea id="push-message" rows={1} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Initial commit" />
        </FormField>
      </div>
      <div className="flex justify-end">
        <Button
          leftIcon={<Upload size={15} />}
          disabled={!ready}
          title={ready ? undefined : 'Pick a connector and owner and enter a valid repository name and branch'}
          onClick={() => {
            setPublishError(null);
            setConfirmOpen(true);
          }}
        >
          Create repository &amp; push
        </Button>
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        title="Create repository and push?"
        tone="primary"
        confirmLabel="Create & push"
        isLoading={publishing}
        error={publishError}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void submit()}
        message={
          <div className="space-y-2">
            <p>
              Creates <span className="font-mono font-semibold">{ownerName}/{name}</span> ({effectiveVisibility}) on {providerLabel} and pushes{' '}
              {run.files.length} file{run.files.length === 1 ? '' : 's'}.
            </p>
            <p className="flex items-center gap-1 text-xs text-slate-500">
              <GitBranch size={12} /> Branch <span className="font-mono">{branch || 'main'}</span>
            </p>
          </div>
        }
      />
    </div>
  );
};
