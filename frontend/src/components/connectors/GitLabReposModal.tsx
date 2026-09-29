import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Globe, Lock, GitBranch, Copy, Check } from 'lucide-react';
import { Modal } from '../common/Modal';
import { ListToolbar } from '../common/ListToolbar';
import { DataTable, DataColumn } from '../common/DataTable';
import { Pagination } from '../common/Pagination';
import { ConnectorLogoTile } from './ConnectorLogos';
import { useListQuery, SortOption } from '../../hooks/useListQuery';
import { gitApi } from '../../api/gitApi';
import { getApiErrorMessage } from '../../api/client';
import { GitIntegration, GitRepo } from '../../types';
import { formatDateTime, formatRelativeTime } from '../../utils/format';

const SORT_OPTIONS: SortOption<GitRepo>[] = [
  { value: 'activity', label: 'Recently active', compare: (a, b) => (b.lastActivityAt || '').localeCompare(a.lastActivityAt || '') },
  { value: 'name', label: 'Name A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
  { value: 'name-desc', label: 'Name Z–A', compare: (a, b) => b.name.localeCompare(a.name) },
];

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public' },
  { value: 'private', label: 'Private' },
];

interface GitLabReposModalProps {
  connector: GitIntegration;
  onClose: () => void;
}

export const GitLabReposModal: React.FC<GitLabReposModalProps> = ({ connector, onClose }) => {
  const [repos, setRepos] = useState<GitRepo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | number | null>(null);

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

  const list = useListQuery(repos, {
    searchText: (r) => `${r.name} ${r.fullName} ${r.description || ''}`,
    status: (r) => (r.private ? 'private' : 'public'),
    sortOptions: SORT_OPTIONS,
    defaultPageSize: 10,
  });

  const copyClone = async (repo: GitRepo) => {
    try {
      await navigator.clipboard.writeText(repo.cloneUrl);
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
        <div className="min-w-0 max-w-[340px]">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-900 font-mono truncate">{r.name}</span>
            {r.private ? (
              <span className="inline-flex items-center gap-0.5 px-1.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                <Lock size={9} aria-hidden /> Private
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 px-1.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <Globe size={9} aria-hidden /> Public
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 font-mono truncate">{r.fullName}</div>
        </div>
      ),
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
      key: 'activity',
      header: 'Last activity',
      render: (r) => (
        <span className="text-slate-600" title={formatDateTime(r.lastActivityAt)}>
          {formatRelativeTime(r.lastActivityAt)}
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
            className="h-7 px-2 inline-flex items-center gap-1 rounded-md border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
            aria-label={`Copy clone URL for ${r.name}`}
          >
            {copiedId === r.id ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
            {copiedId === r.id ? 'Copied' : 'Clone URL'}
          </button>
          <a
            href={r.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:text-orange-600 hover:border-orange-200 hover:bg-orange-50"
            aria-label={`Open ${r.name} in GitLab`}
            title="Open in GitLab"
          >
            <ExternalLink size={13} />
          </a>
        </div>
      ),
    },
  ];

  return (
    <Modal
      isOpen
      onClose={onClose}
      maxWidth="xl"
      icon={<ConnectorLogoTile kind="gitlab" />}
      title={`Repositories · ${connector.name}`}
      subtitle={`Projects visible to @${connector.username || 'unknown'} on ${connector.baseUrl}`}
    >
      <div className="space-y-3">
        <ListToolbar
          query={list.query}
          onQueryChange={list.setQuery}
          searchPlaceholder="Search repositories"
          statusOptions={VISIBILITY_OPTIONS}
          status={list.status}
          onStatusChange={list.setStatus}
          sortOptions={SORT_OPTIONS}
          sort={list.sort}
          onSortChange={list.setSort}
          onRefresh={load}
          isRefreshing={isLoading}
        />
        {error ? (
          <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs" role="alert">
            {error}
          </div>
        ) : (
          <DataTable
            caption="GitLab repositories"
            columns={columns}
            rows={list.pageItems}
            rowKey={(r) => String(r.id)}
            isLoading={isLoading}
            empty={
              <span className="text-xs text-slate-500">
                {list.hasFilters ? 'No repositories match your filters.' : 'This token cannot see any repositories.'}
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
