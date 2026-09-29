import React from 'react';
import { Activity, Cpu, KeyRound, Sparkles } from 'lucide-react';
import { DataColumn } from '../common/DataTable';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ConnectorListView } from './ConnectorListView';
import { ConnectorLogoTile } from './ConnectorLogos';
import { ConnectorStatusCell } from './ConnectorStatus';
import { ConnectorRowActions, DefaultBadge } from './ConnectorRowActions';
import { AiConnectorModal } from './AiConnectorModal';
import { ConnectorTabProps, useConnectorTab } from './useConnectorTab';
import { useListQuery, SortOption } from '../../hooks/useListQuery';
import { aiApi, AiConnector, aiStatus } from '../../api/starterApi';

const STATUS_OPTIONS = ['Connected', 'Error', 'Unknown', 'Disabled'].map((s) => ({ value: s, label: s }));

const totalTokens = (c: AiConnector) => (c.usage?.promptTokens || 0) + (c.usage?.completionTokens || 0);

const SORT_OPTIONS: SortOption<AiConnector>[] = [
  { value: 'name', label: 'Name A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
  { value: 'name-desc', label: 'Name Z–A', compare: (a, b) => b.name.localeCompare(a.name) },
  { value: 'recent', label: 'Recently updated', compare: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') },
  { value: 'status', label: 'Status', compare: (a, b) => aiStatus(a).localeCompare(aiStatus(b)) },
  { value: 'usage', label: 'Most tokens used', compare: (a, b) => totalTokens(b) - totalTokens(a) },
];

const PROVIDER_LABEL: Record<AiConnector['provider'], string> = {
  openai: 'OpenAI',
  'openai-compatible': 'OpenAI-compatible',
};

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

// 1234 → "1.2k", 1_200_000 → "1.2M".
const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);

export const AiConnectorTab: React.FC<ConnectorTabProps<AiConnector>> = ({ collection, canManage }) => {
  const tab = useConnectorTab(collection, {
    testSaved: aiApi.testSaved,
    setDefault: aiApi.setDefault,
    remove: (id) => aiApi.remove(id),
  });

  const list = useListQuery(collection.items, {
    searchText: (c) => `${c.name} ${c.provider} ${c.baseUrl} ${c.defaultModel}`,
    status: aiStatus,
    sortOptions: SORT_OPTIONS,
    syncWithUrl: true,
  });

  const columns: DataColumn<AiConnector>[] = [
    {
      key: 'connector',
      header: 'Connector',
      render: (c) => (
        <div className="flex items-center gap-3 min-w-[200px]">
          <ConnectorLogoTile kind="ai" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-slate-900 truncate">{c.name}</span>
              {c.isDefault && <DefaultBadge />}
            </div>
            <div className="text-[11px] text-slate-500 truncate" title={c.baseUrl}>
              {PROVIDER_LABEL[c.provider] || c.provider} · {hostOf(c.baseUrl)}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'model',
      header: 'Default model',
      render: (c) => (
        <div className="space-y-0.5 max-w-[220px]">
          {c.defaultModel ? (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-800 truncate max-w-full" title={c.defaultModel}>
              <Cpu size={12} className="text-violet-500 shrink-0" aria-hidden />
              {c.defaultModel}
            </span>
          ) : (
            <span className="text-[11px] font-semibold text-amber-700" title="Pick a default model before using the Project Starter">
              No model picked
            </span>
          )}
          <div className="text-[11px] text-slate-500">
            {c.models?.length ? `${c.models.length} models available` : 'Models not loaded yet'} · max {compact(c.maxOutputTokens)} out
          </div>
        </div>
      ),
    },
    {
      key: 'key',
      header: 'API key',
      render: (c) => (
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-600">
          <KeyRound size={12} className="text-violet-500" aria-hidden />
          {c.keyHint || '—'}
        </span>
      ),
    },
    {
      key: 'usage',
      header: 'Usage',
      render: (c) => {
        const u = c.usage || { promptTokens: 0, completionTokens: 0, requests: 0 };
        return u.requests ? (
          <div className="space-y-0.5 min-w-[150px]">
            <div
              className="inline-flex items-center gap-1 text-[11px] text-slate-800"
              title={`${u.promptTokens.toLocaleString()} prompt tokens, ${u.completionTokens.toLocaleString()} completion tokens`}
            >
              <Activity size={12} className="text-violet-500" aria-hidden />
              <span className="font-semibold">{compact(u.promptTokens)}</span> in /{' '}
              <span className="font-semibold">{compact(u.completionTokens)}</span> out tokens
            </div>
            <div className="text-[11px] text-slate-500">
              {u.requests.toLocaleString()} {u.requests === 1 ? 'request' : 'requests'}
            </div>
          </div>
        ) : (
          <span className="text-[11px] text-slate-500">Not used yet</span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => <ConnectorStatusCell status={aiStatus(c)} checkedAt={c.lastTestedAt} error={c.lastError} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      headerClassName: 'text-right',
      className: 'text-right',
      render: (c) => (
        <ConnectorRowActions
          name={c.name}
          isDefault={c.isDefault}
          isTesting={tab.testingId === c._id}
          canManage={canManage}
          onTest={() => tab.handleTest(c)}
          onEdit={() => tab.openEdit(c)}
          onSetDefault={() => tab.handleSetDefault(c)}
          onDelete={() => tab.requestDelete(c)}
        />
      ),
    },
  ];

  return (
    <>
      <details className="group rounded-md border border-violet-200 bg-violet-50/60 text-xs">
        <summary className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer font-semibold text-slate-800 select-none">
          <Sparkles size={14} className="text-violet-600" aria-hidden />
          How to connect ChatGPT (OpenAI API)
        </summary>
        <div className="px-3.5 pb-3 space-y-2 text-slate-700">
          <ol className="pl-5 space-y-1 list-decimal">
            <li>
              platform.openai.com → Settings → Billing: add credit. The API is billed separately from a ChatGPT Plus subscription.
            </li>
            <li>
              API keys → <strong>Create new secret key</strong>. Restrict it to a project.
            </li>
            <li>Paste the key here, click Test &amp; load models, then pick a default model.</li>
            <li>Managers use it in the Project Starter to draft new projects.</li>
          </ol>
          <p className="text-[11px] text-slate-600">
            Keys are encrypted at rest and never shown again after saving. When the Project Starter generates a project, the conversation and
            project files are sent to the provider.
          </p>
        </div>
      </details>

      <ConnectorListView
        collection={collection}
        list={list}
        columns={columns}
        rowKey={(c) => c._id}
        sortOptions={SORT_OPTIONS}
        statusOptions={STATUS_OPTIONS}
        searchPlaceholder="Search by name, provider or model"
        itemLabel="AI connectors"
        addLabel="Add AI provider"
        canManage={canManage}
        onAdd={tab.openCreate}
        emptyIcon={<Sparkles size={22} />}
        emptyTitle="No AI providers yet"
        emptyDescription="Connect ChatGPT through the OpenAI API, or any OpenAI-compatible API, so managers can draft new projects with the Project Starter."
      />

      {tab.modal && (
        <AiConnectorModal
          connector={tab.modal.mode === 'edit' ? tab.modal.item : null}
          isFirst={collection.items.length === 0}
          onClose={tab.closeModal}
          onSaved={tab.handleSaved}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(tab.deleteTarget)}
        title="Delete AI connector?"
        message={
          <>
            <strong className="font-semibold">{tab.deleteTarget?.name}</strong> and its saved API key will be removed. The Project Starter
            can no longer use it. Revoke the key at the provider too if it is no longer needed.
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
