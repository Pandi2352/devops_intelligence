import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Check, CircleDot, Copy, ExternalLink, GitBranch, GitFork, Globe, LayoutTemplate, Lock, Star, Building2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { ListToolbar } from '../common/ListToolbar';
import { Dropdown } from '../common/Dropdown';
import { DataTable, DataColumn } from '../common/DataTable';
import { Pagination } from '../common/Pagination';
import { ConnectorLogoTile } from './ConnectorLogos';
import { useListQuery, SortOption } from '../../hooks/useListQuery';
import { gitApi } from '../../api/gitApi';
import { getApiErrorMessage } from '../../api/client';
import { GitIntegration, GitRepo } from '../../types';
import { formatDateTime, formatRelativeTime } from '../../utils/format';

const pushedAt = (r: GitRepo) => r.lastActivityAt || r.updatedAt || '';

const SORT_OPTIONS: SortOption<GitRepo>[] = [
  { value: 'pushed', label: 'Recently pushed', compare: (a, b) => pushedAt(b).localeCompare(pushedAt(a)) },
  { value: 'name', label: 'Name A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
  { value: 'stars', label: 'Most stars', compare: (a, b) => (b.starCount || 0) - (a.starCount || 0) },
  { value: 'size', label: 'Largest size', compare: (a, b) => (b.sizeKb || 0) - (a.sizeKb || 0) },
];

type RepoType = '' | 'public' | 'private' | 'internal' | 'fork' | 'archived' | 'template';

const TYPE_OPTIONS: { value: Exclude<RepoType, ''>; label: string }[] = [
  { value: 'public', label: 'Public' },
  { value: 'private', label: 'Private' },
  { value: 'internal', label: 'Internal' },
  { value: 'fork', label: 'Forks' },
  { value: 'archived', label: 'Archived' },
  { value: 'template', label: 'Templates' },
];

const visibilityOf = (r: GitRepo): 'public' | 'private' | 'internal' => r.visibility || (r.private ? 'private' : 'public');

const matchesType = (r: GitRepo, type: RepoType): boolean => {
  switch (type) {
    case '':
      return true;
    case 'fork':
      return Boolean(r.fork);
    case 'archived':
      return Boolean(r.archived);
    case 'template':
      return Boolean(r.isTemplate);
    default:
      return visibilityOf(r) === type;
  }
};

const chip = 'inline-flex items-center gap-0.5 px-1.5 rounded text-[10px] font-semibold border';

const VisibilityChip: React.FC<{ repo: GitRepo }> = ({ repo }) => {
  const v = visibilityOf(repo);
  if (v === 'private')
    return (
      <span className={`${chip} bg-amber-50 text-amber-800 border-amber-200`}>
        <Lock size={9} aria-hidden /> Private
      </span>
    );
  if (v === 'internal')
    return (
      <span className={`${chip} bg-sky-50 text-sky-800 border-sky-200`}>
        <Building2 size={9} aria-hidden /> Internal
      </span>
    );
  return (
    <span className={`${chip} bg-emerald-50 text-emerald-700 border-emerald-200`}>
      <Globe size={9} aria-hidden /> Public
    </span>
  );
};

const PERMISSION_STYLES: Record<string, string> = {
  admin: 'bg-violet-50 text-violet-800 border-violet-200',
  maintain: 'bg-sky-50 text-sky-800 border-sky-200',
  push: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  triage: 'bg-slate-50 text-slate-700 border-slate-200',
  pull: 'bg-slate-50 text-slate-600 border-slate-200',
};

const PERMISSION_TITLES: Record<string, string> = {
  admin: 'Admin: can change settings and create webhooks',
  maintain: 'Maintain: can manage the repository without admin access',
  push: 'Write: can push branches and CI files',
  triage: 'Triage: can manage issues and pull requests, cannot push',
  pull: 'Read: can clone but cannot push',
};

type CloneProtocol = 'https' | 'ssh';

interface GitHubReposModalProps {
  connector: GitIntegration;
  onClose: () => void;
}

export const GitHubReposModal: React.FC<GitHubReposModalProps> = ({ connector, onClose }) => {
  const [repos, setRepos] = useState<GitRepo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | number | null>(null);
  const [type, setType] = useState<RepoType>('');
  const [owner, setOwner] = useState('');
  const [protocol, setProtocol] = useState<CloneProtocol>('https');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setRepos(await gitApi.getRepos(connector._id));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load repositories'));
    } finally {
      setIsLoading(false);
    }
  }, [connector._id]);

  useEffect(() => {
    load();
  }, [load]);

  // Owners: the token's own account first, then each org/user that owns at least one visible repo.
  const ownerOptions = useMemo(() => {
    const owners = new Set<string>();
    if (connector.username) owners.add(connector.username);
    (connector.organizations || []).forEach((o) => owners.add(o));
    repos.forEach((r) => r.owner && owners.add(r.owner));
    return [
      { value: '', label: 'All owners' },
      ...[...owners].map((o) => ({ value: o, label: o === connector.username ? `@${o}` : o })),
    ];
  }, [repos, connector.username, connector.organizations]);

  const filteredRepos = useMemo(
    () => repos.filter((r) => matchesType(r, type) && (!owner || r.owner === owner)),
    [repos, type, owner]
  );

  const list = useListQuery(filteredRepos, {
    searchText: (r) =>
      `${r.name} ${r.fullName} ${r.description || ''} ${(r.topics || []).join(' ')} ${r.language || ''}`,
    sortOptions: SORT_OPTIONS,
    defaultPageSize: 10,
  });

  const stats = useMemo(
    () => ({
      total: repos.length,
      private: repos.filter((r) => visibilityOf(r) === 'private').length,
      archived: repos.filter((r) => r.archived).length,
    }),
    [repos]
  );

  const changeType = (value: string) => {
    setType(value as RepoType);
    list.setPage(1);
  };
  const changeOwner = (value: string) => {
    setOwner(value);
    list.setPage(1);
  };
  const hasFilters = list.hasFilters || Boolean(type) || Boolean(owner);
  const clearAll = () => {
    list.clearFilters();
    setType('');
    setOwner('');
  };

  const cloneUrlOf = (r: GitRepo) => (protocol === 'ssh' && r.sshUrl ? r.sshUrl : r.cloneUrl);

  const copyClone = async (repo: GitRepo) => {
    try {
      await navigator.clipboard.writeText(cloneUrlOf(repo));
      setCopiedId(repo.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setCopiedId(null);
    }
  };

  const columns: DataColumn<GitRepo>[] = [
    {
      key: 'repo',
      header: 'Repository',
      render: (r) => (
        <div className="min-w-[220px] max-w-[380px]">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-slate-900 font-mono truncate">{r.name}</span>
            <VisibilityChip repo={r} />
            {r.fork && (
              <span className={`${chip} bg-slate-50 text-slate-700 border-slate-200`}>
                <GitFork size={9} aria-hidden /> Fork
              </span>
            )}
            {r.archived && (
              <span className={`${chip} bg-slate-100 text-slate-600 border-slate-300`}>
                <Archive size={9} aria-hidden /> Archived
              </span>
            )}
            {r.isTemplate && (
              <span className={`${chip} bg-indigo-50 text-indigo-700 border-indigo-200`}>
                <LayoutTemplate size={9} aria-hidden /> Template
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 font-mono truncate">{r.fullName}</div>
          {r.description && (
            <div className="text-[11px] text-slate-600 truncate" title={r.description}>
              {r.description}
            </div>
          )}
          {r.topics && r.topics.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap mt-0.5">
              {r.topics.slice(0, 3).map((t) => (
                <span key={t} className="px-1.5 rounded-full text-[10px] bg-sky-50 text-sky-700 border border-sky-100">
                  {t}
                </span>
              ))}
              {r.topics.length > 3 && (
                <span className="text-[10px] text-slate-500" title={r.topics.slice(3).join(', ')}>
                  +{r.topics.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'language',
      header: 'Language',
      render: (r) => <span className="text-[11px] text-slate-700">{r.language || '—'}</span>,
    },
    {
      key: 'branch',
      header: 'Default branch',
      render: (r) => (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-700">
          <GitBranch size={11} className="text-purple-600" aria-hidden />
          {r.defaultBranch || 'main'}
        </span>
      ),
    },
    {
      key: 'permission',
      header: 'Your access',
      render: (r) =>
        r.permission ? (
          <span
            className={`${chip} ${PERMISSION_STYLES[r.permission] || PERMISSION_STYLES.pull}`}
            title={PERMISSION_TITLES[r.permission]}
          >
            {r.permission}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: 'stats',
      header: 'Stats',
      render: (r) => (
        <div className="flex items-center gap-2 text-[11px] text-slate-600 whitespace-nowrap">
          <span className="inline-flex items-center gap-0.5" title={`${r.starCount || 0} stars`}>
            <Star size={11} aria-hidden /> {r.starCount || 0}
          </span>
          <span className="inline-flex items-center gap-0.5" title={`${r.forksCount || 0} forks`}>
            <GitFork size={11} aria-hidden /> {r.forksCount || 0}
          </span>
          <span className="inline-flex items-center gap-0.5" title={`${r.openIssues || 0} open issues`}>
            <CircleDot size={11} aria-hidden /> {r.openIssues || 0}
          </span>
        </div>
      ),
    },
    {
      key: 'pushed',
      header: 'Last push',
      render: (r) => (
        <span className="text-slate-600 whitespace-nowrap" title={formatDateTime(pushedAt(r) || undefined)}>
          {formatRelativeTime(pushedAt(r) || undefined)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      headerClassName: 'text-right',
      className: 'text-right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => copyClone(r)}
            className="h-7 px-2 inline-flex items-center gap-1 rounded-md border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            aria-label={`Copy ${protocol === 'ssh' ? 'SSH' : 'HTTPS'} clone URL for ${r.name}`}
            title={cloneUrlOf(r)}
          >
            {copiedId === r.id ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
            {copiedId === r.id ? 'Copied' : protocol === 'ssh' ? 'SSH' : 'HTTPS'}
          </button>
          <a
            href={r.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300 hover:bg-slate-50"
            aria-label={`Open ${r.name} on GitHub`}
            title="Open on GitHub"
          >
            <ExternalLink size={13} />
          </a>
        </div>
      ),
    },
  ];

  const protocolToggle = (
    <div className="inline-flex h-8 rounded-md border border-slate-300 overflow-hidden" role="group" aria-label="Clone URL protocol">
      {(['https', 'ssh'] as CloneProtocol[]).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => setProtocol(p)}
          aria-pressed={protocol === p}
          className={`px-2.5 text-[11px] font-semibold cursor-pointer ${
            protocol === p ? 'bg-sky-50 text-sky-800' : 'bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          {p.toUpperCase()}
        </button>
      ))}
    </div>
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      maxWidth="xl"
      icon={<ConnectorLogoTile kind="github" />}
      title={`Repositories · ${connector.name}`}
      subtitle={`Repositories visible to @${connector.username || 'unknown'} on ${connector.baseUrl}`}
    >
      <div className="space-y-3">
        <ListToolbar
          query={list.query}
          onQueryChange={list.setQuery}
          searchPlaceholder="Search name, description, topic or language"
          statusOptions={TYPE_OPTIONS}
          status={type}
          onStatusChange={changeType}
          statusAllLabel="All types"
          statusAriaLabel="Filter by type"
          sortOptions={SORT_OPTIONS}
          sort={list.sort}
          onSortChange={list.setSort}
          onRefresh={load}
          isRefreshing={isLoading}
          actions={
            <>
              {ownerOptions.length > 2 && (
                <Dropdown<string>
                  ariaLabel="Filter by owner"
                  value={owner}
                  onChange={changeOwner}
                  options={ownerOptions}
                  menuMinWidth={170}
                  buttonClassName="min-w-[130px]"
                  size="sm"
                />
              )}
              {protocolToggle}
            </>
          }
        />

        {!error && !isLoading && repos.length > 0 && (
          <p className="text-[11px] text-slate-600">
            <span className="font-semibold text-slate-900">{stats.total}</span> {stats.total === 1 ? 'repository' : 'repositories'} ·{' '}
            {stats.private} private · {stats.archived} archived
            {hasFilters && (
              <>
                {' '}
                · showing {list.filteredCount}
                <button type="button" onClick={clearAll} className="ml-2 text-sky-700 hover:underline cursor-pointer">
                  Clear filters
                </button>
              </>
            )}
          </p>
        )}

        {error ? (
          <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
            {error}
          </div>
        ) : (
          <DataTable
            caption="GitHub repositories"
            columns={columns}
            rows={list.pageItems}
            rowKey={(r) => String(r.id)}
            isLoading={isLoading}
            empty={
              <span className="text-xs text-slate-500">
                {hasFilters ? 'No repositories match your filters.' : 'This token cannot see any repositories.'}
              </span>
            }
            footer={
              <Pagination
                page={list.page}
                pageSize={list.pageSize}
                total={list.filteredCount}
                onPageChange={list.setPage}
                onPageSizeChange={list.setPageSize}
                itemLabel="repositories"
              />
            }
          />
        )}
      </div>
    </Modal>
  );
};
