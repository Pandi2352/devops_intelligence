import React from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import type { StarterRunSummary } from '../../api/starterApi';
import { formatRelativeTime } from '../../utils/format';
import { Button } from '../common/Button';
import { StatusChip } from './StatusChip';

interface RunListProps {
  runs: StarterRunSummary[];
  loading: boolean;
  selectedId: string | null;
  showAll: boolean;
  onToggleAll: (all: boolean) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export const RunList: React.FC<RunListProps> = ({ runs, loading, selectedId, showAll, onToggleAll, onSelect, onNew }) => (
  <aside className="rounded-lg border border-slate-200 bg-white flex flex-col min-h-0 lg:max-h-[calc(100vh-11rem)]">
    <div className="p-3 border-b border-slate-200 space-y-2">
      <Button size="sm" className="w-full" leftIcon={<Plus size={14} />} onClick={onNew}>
        New project
      </Button>
      <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
        <input type="checkbox" checked={showAll} onChange={(e) => onToggleAll(e.target.checked)} className="accent-sky-600" />
        Everyone&apos;s projects
      </label>
    </div>
    <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5 max-h-72 lg:max-h-none">
      {loading && runs.length === 0 && <p className="p-3 text-xs text-slate-500">Loading…</p>}
      {!loading && runs.length === 0 && <p className="p-3 text-xs text-slate-500">No projects yet. Describe one in the chat to start.</p>}
      {runs.map((r) => (
        <div
          key={r._id}
          className={`flex items-start gap-1 rounded-md border ${r._id === selectedId ? 'bg-sky-50 border-sky-200' : 'border-transparent hover:bg-slate-50'}`}
        >
          <button
            type="button"
            onClick={() => onSelect(r._id)}
            aria-current={r._id === selectedId ? 'true' : undefined}
            className="flex-1 min-w-0 text-left px-2 py-1.5 cursor-pointer"
          >
            <span className="block text-xs font-medium text-slate-800 truncate" title={r.title}>
              {r.title || 'Untitled project'}
            </span>
            <span className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500">
              <StatusChip status={r.status} />
              <span>{formatRelativeTime(r.updatedAt)}</span>
            </span>
            {showAll && r.ownerName && <span className="block mt-0.5 text-[10px] text-slate-400 truncate">{r.ownerName}</span>}
          </button>
          {r.repo?.url && (
            <a
              href={r.repo.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 mr-1.5 p-1 rounded text-slate-400 hover:text-violet-700 hover:bg-violet-50"
              aria-label={`Open repository ${r.repo.fullName}`}
              title={r.repo.fullName}
            >
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      ))}
    </div>
  </aside>
);
