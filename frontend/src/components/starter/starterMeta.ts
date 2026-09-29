import type { StarterRun, StarterStatus } from '../../api/starterApi';

export const STATUS_META: Record<StarterStatus, { label: string; chip: string; busy?: boolean }> = {
  chatting: { label: 'Chatting', chip: 'bg-sky-50 text-sky-800 border-sky-200' },
  generating: { label: 'Generating', chip: 'bg-amber-50 text-amber-900 border-amber-200', busy: true },
  ready: { label: 'Ready', chip: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  publishing: { label: 'Publishing', chip: 'bg-amber-50 text-amber-900 border-amber-200', busy: true },
  published: { label: 'Published', chip: 'bg-violet-50 text-violet-800 border-violet-200' },
  failed: { label: 'Failed', chip: 'bg-rose-50 text-rose-800 border-rose-200' },
};

export const POLL_MS = 2500;

export const isBusy = (status?: StarterStatus) => status === 'generating' || status === 'publishing';

export const QUICK_REPLIES = ['Use your recommendations', 'Full-stack web app', 'REST API', 'Mobile app', 'CLI tool'];

export const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** Repo names from plan names like "Task Manager" → "task-manager". */
export const toRepoName = (name: string) =>
  name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

export const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export const formatDuration = (start?: string, end?: string) => {
  if (!start) return '';
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

export const hasUserMessage = (run: StarterRun | null) => !!run?.messages.some((m) => m.role === 'user');

export const canGenerate = (run: StarterRun | null) =>
  !!run && hasUserMessage(run) && ['chatting', 'ready', 'failed'].includes(run.status) && !run.repo;

export const canPush = (run: StarterRun | null) =>
  !!run && run.files.length > 0 && (run.status === 'ready' || (run.status === 'failed' && !run.repo));

export const isNoAiError = (message: string) => /no ai connector/i.test(message);

export interface TreeNode {
  name: string;
  path: string;
  dirs: TreeNode[];
  files: { name: string; path: string; size: number }[];
}

export const buildTree = (files: { path: string; size: number }[]): TreeNode => {
  const root: TreeNode = { name: '', path: '', dirs: [], files: [] };
  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean);
    let node = root;
    parts.slice(0, -1).forEach((part, i) => {
      let next = node.dirs.find((d) => d.name === part);
      if (!next) {
        next = { name: part, path: parts.slice(0, i + 1).join('/'), dirs: [], files: [] };
        node.dirs.push(next);
      }
      node = next;
    });
    node.files.push({ name: parts[parts.length - 1] || f.path, path: f.path, size: f.size });
  }
  const sort = (n: TreeNode) => {
    n.dirs.sort((a, b) => a.name.localeCompare(b.name));
    n.files.sort((a, b) => a.name.localeCompare(b.name));
    n.dirs.forEach(sort);
  };
  sort(root);
  return root;
};

export const ECOSYSTEMS = ['npm', 'pypi', 'go', 'maven', 'nuget', 'rubygems', 'crates', 'packagist', 'pub', 'docker', 'runtime'];
