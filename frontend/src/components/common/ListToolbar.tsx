import React from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { Dropdown } from './Dropdown';

interface Option {
  value: string;
  label: string;
}

interface ListToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  searchPlaceholder?: string;
  statusOptions?: Option[];
  status?: string;
  onStatusChange?: (value: string) => void;
  sortOptions?: Option[];
  sort?: string;
  onSortChange?: (value: string) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  actions?: React.ReactNode;
}

const controlClass =
  'h-8 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-500';

export const ListToolbar: React.FC<ListToolbarProps> = ({
  query,
  onQueryChange,
  searchPlaceholder = 'Search…',
  statusOptions,
  status = '',
  onStatusChange,
  sortOptions,
  sort,
  onSortChange,
  onRefresh,
  isRefreshing,
  actions,
}) => (
  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-1 min-w-0">
      <div className="relative w-full sm:max-w-xs">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className={`${controlClass} w-full pl-8 pr-8`}
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-700 cursor-pointer"
            aria-label="Clear search"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {statusOptions && onStatusChange && (
          <Dropdown<string>
            ariaLabel="Filter by status"
            value={status}
            onChange={onStatusChange}
            options={[{ value: '', label: 'All statuses' }, ...statusOptions]}
            menuMinWidth={170}
            buttonClassName="min-w-[140px]"
          />
        )}
        {sortOptions && onSortChange && (
          <Dropdown<string>
            ariaLabel="Sort by"
            value={sort || ''}
            onChange={onSortChange}
            options={sortOptions}
            menuMinWidth={170}
            buttonClassName="min-w-[150px]"
          />
        )}
      </div>
    </div>

    <div className="flex items-center gap-2 shrink-0">
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 cursor-pointer disabled:opacity-60"
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
        </button>
      )}
      {actions}
    </div>
  </div>
);
