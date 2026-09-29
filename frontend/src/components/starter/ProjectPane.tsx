import React from 'react';
import { Trash2 } from 'lucide-react';
import type { PublishInput, StarterRun } from '../../api/starterApi';
import { FilesTab } from './FilesTab';
import { PlanTab } from './PlanTab';
import { PublishedCard } from './PublishedCard';
import { PushTab } from './PushTab';
import { StatusChip } from './StatusChip';
import { TrackerTab } from './TrackerTab';
import { canPush } from './starterMeta';

export type ProjectTab = 'tracker' | 'plan' | 'files' | 'push';

interface ProjectPaneProps {
  run: StarterRun | null;
  tab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
  onSaveFile: (path: string, content: string) => Promise<boolean>;
  onDeleteFile: (path: string) => Promise<boolean>;
  onPublish: (input: PublishInput) => Promise<string | null>;
  onDeleteRun: () => void;
}

export const ProjectPane: React.FC<ProjectPaneProps> = ({ run, tab, onTabChange, onSaveFile, onDeleteFile, onPublish, onDeleteRun }) => {
  if (!run) {
    return (
      <section className="rounded-lg border border-dashed border-slate-300 bg-white p-6 flex items-center justify-center text-center min-h-[240px]">
        <div>
          <p className="text-sm font-semibold text-slate-700">Your project appears here</p>
          <p className="text-xs text-slate-500 mt-1 max-w-xs">
            Chat with the AI, press Generate project, review the plan and files, then push them to a new GitHub or GitLab repository.
          </p>
        </div>
      </section>
    );
  }

  const pushVisible = canPush(run) || !!run.repo;
  const tabs: { key: ProjectTab; label: string }[] = [
    { key: 'tracker', label: 'Tracker' },
    { key: 'plan', label: 'Plan' },
    { key: 'files', label: `Files${run.files.length ? ` (${run.files.length})` : ''}` },
    ...(pushVisible ? [{ key: 'push' as const, label: run.repo ? 'Repository' : 'Push' }] : []),
  ];
  const active = tab === 'push' && !pushVisible ? 'tracker' : tab;

  return (
    <section className="rounded-lg border border-slate-200 bg-white flex flex-col min-h-[420px] lg:h-[calc(100vh-11rem)]">
      <div className="px-3 pt-2 border-b border-slate-200 flex items-end justify-between gap-2">
        <div role="tablist" aria-label="Project" className="flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active === t.key}
              onClick={() => onTabChange(t.key)}
              className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px whitespace-nowrap cursor-pointer ${
                active === t.key ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 pb-1.5">
          <StatusChip status={run.status} />
          <button
            type="button"
            onClick={onDeleteRun}
            disabled={run.status === 'generating' || run.status === 'publishing'}
            className="p-1.5 rounded text-slate-400 hover:text-rose-700 hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            aria-label="Delete project"
            title={run.status === 'generating' || run.status === 'publishing' ? 'Wait for the current step to finish' : 'Delete project'}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4" role="tabpanel">
        {active === 'tracker' && <TrackerTab run={run} />}
        {active === 'plan' && <PlanTab run={run} />}
        {active === 'files' && <FilesTab key={run._id} run={run} onSave={onSaveFile} onDelete={onDeleteFile} />}
        {active === 'push' &&
          (run.repo && run.status === 'published' ? (
            <PublishedCard repo={run.repo} setupInstructions={run.plan?.setupInstructions} />
          ) : run.repo ? (
            <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs">
              The repository{' '}
              <a href={run.repo.url} target="_blank" rel="noreferrer" className="font-mono underline">
                {run.repo.fullName}
              </a>{' '}
              was created, but the push did not finish ({run.status}). See the Tracker for details.
            </div>
          ) : (
            <PushTab key={run._id} run={run} onPublish={onPublish} />
          ))}
      </div>
    </section>
  );
};
