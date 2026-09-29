import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface SortOption<T> {
  value: string;
  label: string;
  compare: (a: T, b: T) => number;
}

interface ListQueryOptions<T> {
  /** Text searched by the query box (lower-cased internally). */
  searchText: (item: T) => string;
  /** Value matched against the status filter. */
  status?: (item: T) => string;
  sortOptions: SortOption<T>[];
  defaultPageSize?: number;
  /** Keep search / filter / sort / page in the URL so views are shareable and survive reloads. */
  syncWithUrl?: boolean;
}

export const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];
const KEYS = ['q', 'status', 'sort', 'page', 'size'] as const;
type QueryKey = (typeof KEYS)[number];

// Client-side search, filter, sort and pagination for any list, optionally mirrored to the URL.
export function useListQuery<T>(items: T[], options: ListQueryOptions<T>) {
  const { searchText, status, sortOptions, defaultPageSize = 10, syncWithUrl = false } = options;
  const [searchParams, setSearchParams] = useSearchParams();
  const [localParams, setLocalParams] = useState<Partial<Record<QueryKey, string>>>({});

  const read = (key: QueryKey) => (syncWithUrl ? searchParams.get(key) ?? '' : localParams[key] ?? '');

  const write = useCallback(
    (patch: Partial<Record<QueryKey, string | null>>) => {
      if (syncWithUrl) {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
            return next;
          },
          { replace: true }
        );
      } else {
        setLocalParams((prev) => {
          const next = { ...prev };
          Object.entries(patch).forEach(([k, v]) => {
            if (v) next[k as QueryKey] = v;
            else delete next[k as QueryKey];
          });
          return next;
        });
      }
    },
    [syncWithUrl, setSearchParams]
  );

  const query = read('q');
  const statusFilter = read('status');
  const sort = sortOptions.some((o) => o.value === read('sort')) ? read('sort') : sortOptions[0]?.value ?? '';
  const parsedSize = Number(read('size'));
  const pageSize = PAGE_SIZE_OPTIONS.includes(parsedSize) ? parsedSize : defaultPageSize;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = items.filter((item) => {
      if (needle && !searchText(item).toLowerCase().includes(needle)) return false;
      if (statusFilter && status && status(item) !== statusFilter) return false;
      return true;
    });
    const sorter = sortOptions.find((o) => o.value === sort);
    return sorter ? [...matches].sort(sorter.compare) : matches;
  }, [items, query, statusFilter, sort, searchText, status, sortOptions]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const requestedPage = Math.max(1, Number(read('page')) || 1);
  const page = Math.min(requestedPage, totalPages);
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  return {
    query,
    setQuery: (value: string) => write({ q: value, page: null }),
    status: statusFilter,
    setStatus: (value: string) => write({ status: value, page: null }),
    sort,
    setSort: (value: string) => write({ sort: value === sortOptions[0]?.value ? null : value }),
    page,
    setPage: (value: number) => write({ page: value > 1 ? String(value) : null }),
    pageSize,
    setPageSize: (value: number) => write({ size: value === defaultPageSize ? null : String(value), page: null }),
    clearFilters: () => write({ q: null, status: null, page: null }),
    hasFilters: Boolean(query || statusFilter),
    filteredCount: filtered.length,
    totalCount: items.length,
    totalPages,
    pageItems,
  };
}
