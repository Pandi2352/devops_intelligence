import React, { useState } from 'react';
import { Edit3, FilePlus, Save, Trash2, X } from 'lucide-react';
import type { StarterRun } from '../../api/starterApi';
import { Button } from '../common/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { FileTree } from './FileTree';
import { formatBytes } from './starterMeta';

interface FilesTabProps {
  run: StarterRun;
  onSave: (path: string, content: string) => Promise<boolean>;
  onDelete: (path: string) => Promise<boolean>;
}

const inputClass =
  'w-full px-2.5 py-1.5 rounded-md border border-slate-300 text-xs font-mono placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-500';

export const FilesTab: React.FC<FilesTabProps> = ({ run, onSave, onDelete }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editable = run.status === 'ready';

  const current = run.files.find((f) => f.path === selected) || (adding ? undefined : run.files[0]);
  const totalBytes = run.files.reduce((n, f) => n + f.size, 0);

  const select = (path: string) => {
    setSelected(path);
    setEditing(false);
    setAdding(false);
  };

  const startAdd = () => {
    setAdding(true);
    setEditing(true);
    setNewPath('');
    setDraft('');
  };

  const cancel = () => {
    setEditing(false);
    setAdding(false);
  };

  const save = async () => {
    const path = adding ? newPath.trim().replace(/^\/+/, '') : current?.path;
    if (!path) return;
    setSaving(true);
    const ok = await onSave(path, draft);
    setSaving(false);
    if (ok) {
      setSelected(path);
      setEditing(false);
      setAdding(false);
    }
  };

  const pathTaken = adding && run.files.some((f) => f.path === newPath.trim().replace(/^\/+/, ''));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500">
          {run.files.length} file{run.files.length === 1 ? '' : 's'} · {formatBytes(totalBytes)}
          {!editable && run.files.length > 0 && ' · editing is available when the project is Ready'}
        </p>
        {editable && (
          <Button size="sm" variant="secondary" leftIcon={<FilePlus size={13} />} onClick={startAdd} disabled={adding}>
            Add file
          </Button>
        )}
      </div>

      {run.files.length === 0 && !adding ? (
        <p className="text-xs text-slate-500">No files yet. Generate the project to create them.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[minmax(160px,220px)_1fr] gap-2">
          <div className="rounded-md border border-slate-200 max-h-64 md:max-h-[60vh] overflow-y-auto">
            <FileTree files={run.files} selected={adding ? null : current?.path || null} onSelect={select} />
          </div>

          <div className="min-w-0 rounded-md border border-slate-200 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 border-b border-slate-200 bg-slate-50">
              {adding ? (
                <input
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  aria-label="New file path"
                  placeholder="Path, e.g. src/utils/helpers.ts"
                  className={`${inputClass} flex-1 min-w-[160px]`}
                  autoFocus
                />
              ) : (
                <span className="text-xs font-mono text-slate-700 truncate" title={current?.path}>
                  {current?.path}
                </span>
              )}
              {editable && (
                <div className="flex items-center gap-1.5">
                  {editing ? (
                    <>
                      <Button size="sm" variant="ghost" leftIcon={<X size={13} />} onClick={cancel} disabled={saving}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        leftIcon={<Save size={13} />}
                        onClick={() => void save()}
                        isLoading={saving}
                        disabled={adding && (!newPath.trim() || pathTaken)}
                        title={adding && !newPath.trim() ? 'Enter a file path' : pathTaken ? 'A file with this path already exists' : undefined}
                      >
                        Save
                      </Button>
                    </>
                  ) : (
                    current && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          leftIcon={<Edit3 size={13} />}
                          onClick={() => {
                            setDraft(current.content);
                            setEditing(true);
                          }}
                        >
                          Edit
                        </Button>
                        <Button size="sm" variant="danger" leftIcon={<Trash2 size={13} />} onClick={() => setConfirmDelete(true)}>
                          Delete
                        </Button>
                      </>
                    )
                  )}
                </div>
              )}
            </div>
            {pathTaken && <p className="px-2.5 pt-1 text-[11px] text-rose-600">A file with this path already exists. Open it and choose Edit instead.</p>}
            {editing ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="File content"
                placeholder="File content"
                spellCheck={false}
                className="flex-1 min-h-[320px] md:min-h-[50vh] p-2.5 font-mono text-xs leading-relaxed text-slate-800 resize-y focus:outline-none"
              />
            ) : (
              <pre className="flex-1 max-h-[60vh] overflow-auto p-2.5 font-mono text-xs leading-relaxed text-slate-800">
                {current?.content.split('\n').map((line, i) => (
                  <div key={i} className="flex">
                    <span className="select-none w-9 shrink-0 pr-2 text-right text-slate-300">{i + 1}</span>
                    <span className="whitespace-pre">{line || ' '}</span>
                  </div>
                ))}
              </pre>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        title="Delete file?"
        message={
          <>
            Remove <span className="font-mono">{current?.path}</span> from the project? It will not be pushed.
          </>
        }
        confirmLabel="Delete file"
        isLoading={saving}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (!current) return;
          setSaving(true);
          const ok = await onDelete(current.path);
          setSaving(false);
          setConfirmDelete(false);
          if (ok) setSelected(null);
        }}
      />
    </div>
  );
};
