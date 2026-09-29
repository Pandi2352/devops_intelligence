import React, { useState } from 'react';
import { FolderGit2, KeyRound } from 'lucide-react';
import { DataColumn } from '../common/DataTable';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ConnectorListView } from './ConnectorListView';
import { ConnectorLogoTile, GitLabLogo } from './ConnectorLogos';
import { ConnectorStatusCell } from './ConnectorStatus';
import { ConnectorRowActions, DefaultBadge, IconAction } from './ConnectorRowActions';
import { GitLabConnectorModal } from './GitLabConnectorModal';
import { GitLabReposModal } from './GitLabReposModal';
import { ConnectorTabProps, useConnectorTab } from './useConnectorTab';
import { useListQuery, SortOption } from '../../hooks/useListQuery';
import { gitApi } from '../../api/gitApi';
import { GitIntegration } from '../../types';
import { hostFromUrl } from '../../utils/format';
import { gitlabStatus } from './gitlabStatus';

const STATUS_OPTIONS = ['Connected', 'Error', 'Unknown', 'Disabled'].map((s) => ({ value: s, label: s }));

const SORT_OPTIONS: SortOption<GitIntegration>[] = [
  { value: 'name', label: 'Name A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
  { value: 'name-desc', label: 'Name Z–A', compare: (a, b) => b.name.localeCompare(a.name) },
  { value: 'recent', label: 'Recently updated', compare: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') },
  { value: 'status', label: 'Status', compare: (a, b) => gitlabStatus(a).localeCompare(gitlabStatus(b)) },
];

export const GitLabConnectorTab: React.FC<ConnectorTabProps<GitIntegration>> = ({ collection, canManage }) => {
  const [reposFor, setReposFor] = useState<GitIntegration | null>(null);
  const tab = useConnectorTab(collection, {
    testSaved: gitApi.testSaved,
    setDefault: (id) => gitApi.update(id, { isDefault: true }),
    remove: (id) => gitApi.remove(id),
  });

  const list = useListQuery(collection.items, {
    searchText: (g) => `${g.name} ${g.username || ''} ${g.baseUrl || ''}`,
    status: gitlabStatus,
    sortOptions: SORT_OPTIONS,
    syncWithUrl: true,
  });

  const columns: DataColumn<GitIntegration>[] = [
    {
      key: 'connector',
      header: 'Connector',
      render: (g) => (
        <div className="flex items-center gap-3 min-w-[200px]">
          <ConnectorLogoTile kind="gitlab" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-slate-900 truncate">{g.name}</span>
              {g.isDefault && <DefaultBadge />}
            </div>
            <a
              href={g.baseUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-slate-500 hover:text-sky-700 hover:underline font-mono"
            >
              {hostFromUrl(g.baseUrl)}
            </a>
          </div>
        </div>
      ),
    },
    {
      key: 'account',
      header: 'Account',
      render: (g) => <span className="font-mono text-slate-800">{g.username ? `@${g.username}` : '—'}</span>,
    },
    {
      key: 'token',
      header: 'Token',
      render: (g) => (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-600">
          <KeyRound size={12} className="text-orange-500" aria-hidden />
          {g.tokenHint || '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (g) => <ConnectorStatusCell status={gitlabStatus(g)} checkedAt={g.lastTestedAt} error={g.lastError} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      headerClassName: 'text-right',
      className: 'text-right',
      render: (g) => (
        <ConnectorRowActions
          name={g.name}
          isDefault={g.isDefault}
          isTesting={tab.testingId === g._id}
          canManage={canManage}
          onTest={() => tab.handleTest(g)}
          onEdit={() => tab.openEdit(g)}
          onSetDefault={() => tab.handleSetDefault(g)}
          onDelete={() => tab.requestDelete(g)}
          extra={
            <IconAction
              label={`Browse repositories for ${g.name}`}
              onClick={() => setReposFor(g)}
              icon={<FolderGit2 size={14} />}
              disabled={!g.isActive}
            />
          }
        />
      ),
    },
  ];

  return (
    <>
      <ConnectorListView
        collection={collection}
        list={list}
        columns={columns}
        rowKey={(g) => g._id}
        sortOptions={SORT_OPTIONS}
        statusOptions={STATUS_OPTIONS}
        searchPlaceholder="Search by name, account or host"
        itemLabel="GitLab connectors"
        addLabel="Add GitLab"
        canManage={canManage}
        onAdd={tab.openCreate}
        emptyIcon={<GitLabLogo size={22} />}
        emptyTitle="No GitLab connectors yet"
        emptyDescription="Connect GitLab.com or a self-managed instance with a personal access token to browse repositories and run pipelines."
      />

      {tab.modal && (
        <GitLabConnectorModal
          connector={tab.modal.mode === 'edit' ? tab.modal.item : null}
          isFirst={collection.items.length === 0}
          onClose={tab.closeModal}
          onSaved={(item, message) => tab.handleSaved(item, message)}
        />
      )}

      {reposFor && <GitLabReposModal connector={reposFor} onClose={() => setReposFor(null)} />}

      <ConfirmDialog
        isOpen={Boolean(tab.deleteTarget)}
        title="Delete GitLab connector?"
        message={
          <>
            <strong className="font-semibold">{tab.deleteTarget?.name}</strong> and its saved access token will be removed.
            Pages that use this connector will stop loading repositories and pipelines.
          </>
        }
        confirmLabel="Delete connector"
        isLoading={tab.isDeleting}
        error={tab.deleteError}
        onConfirm={tab.confirmDelete}
        onCancel={tab.cancelDelete}
      />
    </>
  );
};
