import React, { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Upload, AlertTriangle } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Dropdown } from '../common/Dropdown';
import { FormField, TextInput } from '../common/Form';
import { gitApi, TemplatePushResult, WorkspaceTemplate } from '../../api/gitApi';
import { getApiErrorMessage, getApiErrorStatus } from '../../api/client';
import { GitRepo } from '../../types';

interface PushTemplateModalProps {
  integrationId: string;
  repo: GitRepo;
  branches: string[];
  onClose: () => void;
  onPushed: (message: string) => void;
}

// Pushes a local devops-demo template into an existing repository as a single commit.
export const PushTemplateModal: React.FC<PushTemplateModalProps> = ({ integrationId, repo, branches, onClose, onPushed }) => {
  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);
  const [template, setTemplate] = useState('');
  const [branch, setBranch] = useState(repo.defaultBranch || 'main');
  const [commitMessage, setCommitMessage] = useState('');
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [result, setResult] = useState<{ message: string; push: TemplatePushResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPushing, setIsPushing] = useState(false);

  useEffect(() => {
    gitApi
      .getTemplates()
      .then((list) => {
        setTemplates(list);
        if (list[0]) {
          setTemplate(list[0].name);
          setCommitMessage(`chore: update from ${list[0].name} template`);
        }
      })
      .catch(() => setTemplates([]));
  }, []);

  const branchOptions = Array.from(new Set([repo.defaultBranch || 'main', ...branches])).map((b) => ({
    value: b,
    label: b,
    sublabel: b === repo.defaultBranch ? 'Default branch' : undefined,
  }));

  const push = async (onConflict: 'abort' | 'overwrite' | 'skip') => {
    setIsPushing(true);
    setError(null);
    try {
      const res = await gitApi.pushTemplate(integrationId, repo.id, { template, branch, commitMessage: commitMessage.trim(), onConflict });
      setResult(res);
      setConflicts([]);
      onPushed(res.message);
    } catch (err) {
      const data = (err as { response?: { data?: { conflicts?: string[] } } }).response?.data;
      if (getApiErrorStatus(err) === 409 && data?.conflicts) {
        setConflicts(data.conflicts);
      } else {
        setError(getApiErrorMessage(err, 'Push failed'));
      }
    } finally {
      setIsPushing(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      preventClose={isPushing}
      maxWidth="md"
      title={`Push code to ${repo.name}`}
      subtitle="Commits a local devops-demo template to a branch in one commit. Unchanged files are skipped."
      icon={
        <div className="w-9 h-9 rounded-md border border-sky-200 bg-sky-50 text-sky-600 flex items-center justify-center">
          <Upload size={18} />
        </div>
      }
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={isPushing}>
              Cancel
            </Button>
            {conflicts.length > 0 ? (
              <>
                <Button variant="secondary" onClick={() => push('skip')} isLoading={isPushing} title="Push new and unchanged files; leave the conflicting files as they are in GitLab">
                  Keep changed files
                </Button>
                <Button variant="dangerSolid" onClick={() => push('overwrite')} isLoading={isPushing}>
                  Overwrite {conflicts.length} file{conflicts.length === 1 ? '' : 's'}
                </Button>
              </>
            ) : (
              <Button onClick={() => push('abort')} isLoading={isPushing} disabled={!template || !commitMessage.trim()} leftIcon={<Upload size={14} />}>
                Push
              </Button>
            )}
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3 text-xs">
          <div className="p-3 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 flex items-start gap-2" role="status">
            <CheckCircle2 size={15} className="shrink-0 mt-px" />
            <span className="font-semibold">{result.message}</span>
          </div>
          <dl className="grid grid-cols-4 gap-2 text-center">
            {[
              ['Created', result.push.created.length],
              ['Updated', result.push.updated.length],
              ['Kept', result.push.skipped?.length ?? 0],
              ['Unchanged', result.push.unchanged],
            ].map(([label, count]) => (
              <div key={label} className="p-2 rounded-md border border-slate-200">
                <dt className="text-[10px] uppercase tracking-wider text-slate-500">{label}</dt>
                <dd className="text-lg font-bold text-slate-900">{count}</dd>
              </div>
            ))}
          </dl>
          {result.push.commit && (
            <a
              href={result.push.commit.webUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sky-700 font-semibold hover:underline"
            >
              View commit {result.push.commit.shortId} in GitLab <ExternalLink size={12} />
            </a>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {error && (
            <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
              {error}
            </div>
          )}
          <FormField id="push-template" label="Template" required>
            <Dropdown<string>
              id="push-template"
              size="md"
              fullWidth
              placeholder="No templates found in devops-demo/"
              value={template}
              onChange={(v) => {
                setTemplate(v);
                setConflicts([]);
              }}
              options={templates.map((t) => ({ value: t.name, label: t.name, sublabel: `${t.fileCount} files` }))}
            />
          </FormField>
          <FormField id="push-branch" label="Branch" hint="A branch that does not exist yet is created from the default branch.">
            <Dropdown<string>
              id="push-branch"
              size="md"
              fullWidth
              mono
              value={branch}
              onChange={(v) => {
                setBranch(v);
                setConflicts([]);
              }}
              options={branchOptions}
            />
          </FormField>
          <FormField id="push-message" label="Commit message" required>
            <TextInput id="push-message" value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} maxLength={200} mono />
          </FormField>

          {conflicts.length > 0 && (
            <div className="p-3 rounded-md border border-amber-200 bg-amber-50 text-amber-900 text-xs space-y-2" role="alert">
              <div className="flex items-start gap-2 font-semibold">
                <AlertTriangle size={14} className="shrink-0 mt-px" />
                These files were changed on {branch} since the template was pushed. Keep them, or overwrite them with the template:
              </div>
              <ul className="pl-6 font-mono text-[11px] list-disc max-h-32 overflow-y-auto">
                {conflicts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};
