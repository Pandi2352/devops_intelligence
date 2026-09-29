import React, { useState } from 'react';
import { FolderGit2, HelpCircle, KeyRound } from 'lucide-react';
import { DataColumn } from '../common/DataTable';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ConnectorListView } from './ConnectorListView';
import { ConnectorLogoTile, GitHubLogo } from './ConnectorLogos';
import { ConnectorStatusCell } from './ConnectorStatus';
import { ConnectorRowActions, DefaultBadge, IconAction } from './ConnectorRowActions';
import { GitHubConnectorModal, GitHubTokenSteps } from './GitHubConnectorModal';
import { GitHubReposModal } from './GitHubReposModal';
import { ConnectorTabProps, useConnectorTab } from './useConnectorTab';
import { useListQuery, SortOption } from '../../hooks/useListQuery';
import { gitApi } from '../../api/gitApi';
import { GitIntegration } from '../../types';
import { hostFromUrl } from '../../utils/format';
import { gitlabStatus as gitStatus } from './gitlabStatus';

const STATUS_OPTIONS = ['Connected', 'Error', 'Unknown', 'Disabled'].map((s) => ({ value: s, label: s }));

const SORT_OPTIONS: SortOption<GitIntegration>[] = [
  { value: 'name', label: 'Name A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
  { value: 'name-desc', label: 'Name Z–A', compare: (a, b) => b.name.localeCompare(a.name) },
  { value: 'recent', label: 'Recently updated', compare: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') },
  { value: 'status', label: 'Status', compare: (a, b) => gitStatus(a).localeCompare(gitStatus(b)) },
];

const OrgChips: React.FC<{ orgs?: string[] }> = ({ orgs }) => {
  if (!orgs || orgs.length === 0) return <span className="text-slate-400">—</span>;
  const shown = orgs.slice(0, 3);
  const rest = orgs.length - shown.length;
  return (
    <div className="flex items-center gap-1 flex-wrap max-w-[240px]">
      {shown.map((o) => (
        <span key={o} className="px-1.5 rounded text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200">
          {o}
        </span>
      ))}
      {rest > 0 && (
        <span className="px-1.5 rounded text-[10px] font-semibold bg-white text-slate-600 border border-slate-200" title={orgs.slice(3).join(', ')}>
          +{rest}
        </span>
      )}
    </div>
  );
};

export const GitHubConnectorTab: React.FC<ConnectorTabProps<GitIntegration>> = ({ collection, canManage }) => {
  const [reposFor, setReposFor] = useState<GitIntegration | null>(null);
  const tab = useConnectorTab(collection, {
    testSaved: gitApi.testSaved,
    setDefault: (id) => gitApi.update(id, { isDefault: true }),
    remove: (id) => gitApi.remove(id),
  });

  const list = useListQuery(collection.items, {
    searchText: (g) => `${g.name} ${g.username || ''} ${g.baseUrl || ''} ${(g.organizations || []).join(' ')}`,
    status: gitStatus,
    sortOptions: SORT_OPTIONS,
    syncWithUrl: true,
  });

  const columns: DataColumn<GitIntegration>[] = [
    {
      key: 'connector',
      header: 'Connector',
      render: (g) => (
        <div className="flex items-center gap-3 min-w-[200px]">
          <ConnectorLogoTile kind="github" />
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
      key: 'orgs',
      header: 'Organizations',
      render: (g) => <OrgChips orgs={g.organizations} />,
    },
    {
      key: 'token',
      header: 'Token',
      render: (g) => (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-600">
          <KeyRound size={12} className="text-slate-500" aria-hidden />
          {g.tokenHint || '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (g) => <ConnectorStatusCell status={gitStatus(g)} checkedAt={g.lastTestedAt} error={g.lastError} />,
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
              label={g.isActive ? `Browse repositories for ${g.name}` : `${g.name} is disabled; enable it to browse repositories`}
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
        searchPlaceholder="Search by name, account, org or host"
        itemLabel="GitHub connectors"
        addLabel="Add GitHub"
        canManage={canManage}
        onAdd={tab.openCreate}
        emptyIcon={<GitHubLogo size={22} />}
        emptyTitle="No GitHub connectors yet"
        emptyDescription="Connect GitHub.com or GitHub Enterprise Server with a personal access token to browse repositories."
      />

      <details className="group rounded-md border border-slate-200 bg-white text-xs">
        <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none font-semibold text-slate-700 hover:bg-slate-50">
          <HelpCircle size={14} className="text-slate-500" aria-hidden />
          Which GitHub token should I create?
        </summary>
        <div className="px-3 pb-3 pt-1 text-[11px] text-slate-600 leading-relaxed">
          <GitHubTokenSteps />
        </div>
      </details>

      {tab.modal && (
        <GitHubConnectorModal
          connector={tab.modal.mode === 'edit' ? tab.modal.item : null}
          isFirst={collection.items.length === 0}
          onClose={tab.closeModal}
          onSaved={(item, message) => tab.handleSaved(item, message)}
        />
      )}

      {reposFor && <GitHubReposModal connector={reposFor} onClose={() => setReposFor(null)} />}

      <ConfirmDialog
        isOpen={Boolean(tab.deleteTarget)}
        title="Delete GitHub connector?"
        message={
          <>
            <strong className="font-semibold">{tab.deleteTarget?.name}</strong> and its saved access token will be removed.
            Features that use this connector will stop loading GitHub repositories.
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
