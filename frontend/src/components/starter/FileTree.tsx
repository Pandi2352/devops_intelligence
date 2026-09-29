import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react';
import { buildTree, formatBytes, type TreeNode } from './starterMeta';

interface FileTreeProps {
  files: { path: string; size: number }[];
  selected: string | null;
  onSelect: (path: string) => void;
}

export const FileTree: React.FC<FileTreeProps> = ({ files, selected, onSelect }) => {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => (
    <>
      {node.dirs.map((d) => {
        const open = !collapsed.has(d.path);
        return (
          <li key={`d:${d.path}`}>
            <button
              type="button"
              onClick={() => toggle(d.path)}
              aria-expanded={open}
              className="w-full flex items-center gap-1 py-0.5 pr-2 rounded text-xs text-slate-700 hover:bg-slate-100 cursor-pointer"
              style={{ paddingLeft: depth * 12 + 4 }}
            >
              {open ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
              <Folder size={12} className="text-amber-500 shrink-0" />
              <span className="truncate font-medium">{d.name}</span>
            </button>
            {open && <ul>{renderNode(d, depth + 1)}</ul>}
          </li>
        );
      })}
      {node.files.map((f) => (
        <li key={`f:${f.path}`}>
          <button
            type="button"
            onClick={() => onSelect(f.path)}
            aria-current={f.path === selected ? 'true' : undefined}
            title={f.path}
            className={`w-full flex items-center gap-1 py-0.5 pr-2 rounded text-xs cursor-pointer ${
              f.path === selected ? 'bg-sky-100 text-sky-800' : 'text-slate-600 hover:bg-slate-100'
            }`}
            style={{ paddingLeft: depth * 12 + 18 }}
          >
            <FileText size={12} className="shrink-0 text-slate-400" />
            <span className="truncate flex-1 text-left font-mono">{f.name}</span>
            <span className="text-[10px] text-slate-400 shrink-0">{formatBytes(f.size)}</span>
          </button>
        </li>
      ))}
    </>
  );

  return <ul className="py-1">{renderNode(tree, 0)}</ul>;
};
