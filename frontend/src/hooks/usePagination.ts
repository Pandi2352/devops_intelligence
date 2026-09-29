import { useMemo, useState } from 'react';

// Client-side paging for lists that don't need search/sort in the URL (modals, side lists, tables inside tabs).
// The page resets when resetKey changes (e.g. a new filter or selection).
export function usePagination<T>(items: T[], defaultPageSize = 10, resetKey?: unknown) {
  const [state, setState] = useState<{ page: number; pageSize: number; key: unknown }>({ page: 1, pageSize: defaultPageSize, key: resetKey });
  const pageSize = state.pageSize;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  // A changed resetKey or a shrunk list moves back into range without an extra render.
  const page = state.key !== resetKey ? 1 : Math.min(state.page, totalPages);
  const pageItems = useMemo(() => items.slice((page - 1) * pageSize, page * pageSize), [items, page, pageSize]);
  return {
    page,
    pageSize,
    total: items.length,
    totalPages,
    pageItems,
    setPage: (p: number) => setState({ page: p, pageSize, key: resetKey }),
    setPageSize: (size: number) => setState({ page: 1, pageSize: size, key: resetKey }),
  };
}
