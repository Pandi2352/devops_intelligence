import React from 'react';
import { Plus, SearchX, AlertTriangle } from 'lucide-react';
import { ListToolbar } from '../common/ListToolbar';
import { DataTable, DataColumn } from '../common/DataTable';
import { Pagination } from '../common/Pagination';
import { Button } from '../common/Button';
import { SortOption, useListQuery } from '../../hooks/useListQuery';
import { ConnectorCollection } from './useConnectorTab';

interface ConnectorListViewProps<T> {
  collection: ConnectorCollection<T>;
  list: ReturnType<typeof useListQuery<T>>;
  columns: DataColumn<T>[];
  rowKey: (row: T) => string;
  sortOptions: SortOption<T>[];
  statusOptions: { value: string; label: string }[];
  searchPlaceholder: string;
  itemLabel: string;
  addLabel: string;
  canManage: boolean;
  onAdd: () => void;
  toolbarExtra?: React.ReactNode;
  emptyIcon: React.ReactNode;
  emptyTitle: string;
  emptyDescription: string;
}

export function ConnectorListView<T>({
  collection,
  list,
  columns,
  rowKey,
  sortOptions,
  statusOptions,
  searchPlaceholder,
  itemLabel,
  addLabel,
  canManage,
  onAdd,
  toolbarExtra,
  emptyIcon,
  emptyTitle,
  emptyDescription,
}: ConnectorListViewProps<T>) {
  const isEmpty = !collection.isLoading && collection.items.length === 0;

  const emptyContent = isEmpty ? (
    <div className="flex flex-col items-center gap-2 py-4">
      <div className="p-2.5 rounded-md bg-slate-100 text-slate-500">{emptyIcon}</div>
      <p className="text-sm font-semibold text-slate-800">{emptyTitle}</p>
      <p className="text-xs text-slate-500 max-w-sm">{emptyDescription}</p>
      {canManage && (
        <Button size="sm" onClick={onAdd} leftIcon={<Plus size={13} />} className="mt-1">
          {addLabel}
        </Button>
      )}
    </div>
  ) : (
    <div className="flex flex-col items-center gap-2 py-2">
      <SearchX size={20} className="text-slate-400" aria-hidden />
      <p className="text-xs text-slate-500">No {itemLabel} match your search or filters.</p>
      <Button size="sm" variant="secondary" onClick={list.clearFilters}>
        Clear filters
      </Button>
    </div>
  );

  return (
    <div className="space-y-3">
      <ListToolbar
        query={list.query}
        onQueryChange={list.setQuery}
        searchPlaceholder={searchPlaceholder}
        statusOptions={statusOptions}
        status={list.status}
        onStatusChange={list.setStatus}
        sortOptions={sortOptions}
        sort={list.sort}
        onSortChange={list.setSort}
        onRefresh={collection.reload}
        isRefreshing={collection.isLoading}
        actions={
          <>
            {toolbarExtra}
            {canManage && (
              <Button size="sm" onClick={onAdd} leftIcon={<Plus size={14} />} className="h-8">
                {addLabel}
              </Button>
            )}
          </>
        }
      />

      {collection.error && (
        <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3" role="alert">
          <span className="flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            {collection.error}
          </span>
          <Button size="sm" variant="danger" onClick={collection.reload}>
            Retry
          </Button>
        </div>
      )}

      <DataTable
        caption={itemLabel}
        columns={columns}
        rows={list.pageItems}
        rowKey={rowKey}
        isLoading={collection.isLoading}
        empty={emptyContent}
        footer={
          list.totalCount > 0 ? (
            <Pagination
              page={list.page}
              pageSize={list.pageSize}
              total={list.filteredCount}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
              itemLabel={itemLabel}
            />
          ) : undefined
        }
      />
    </div>
  );
}
