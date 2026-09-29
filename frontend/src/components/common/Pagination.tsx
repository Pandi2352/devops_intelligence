import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { PAGE_SIZE_OPTIONS } from '../../hooks/useListQuery';
import { Dropdown } from './Dropdown';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  itemLabel?: string;
  className?: string;
  /** Smaller layout for modals and side panels: no rows selector unless onPageSizeChange is given. */
  compact?: boolean;
}

// Page numbers with ellipses, e.g. 1 … 4 5 6 … 12
const buildPages = (page: number, totalPages: number): (number | 'gap')[] => {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages: (number | 'gap')[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) pages.push('gap');
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < totalPages - 1) pages.push('gap');
  pages.push(totalPages);
  return pages;
};

const navButton =
  'inline-flex items-center justify-center h-7 min-w-7 px-1.5 rounded-md border text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

export const Pagination: React.FC<PaginationProps> = ({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  itemLabel = 'items',
  className = '',
  compact = false,
}) => {
  const [jump, setJump] = useState('');
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const goTo = () => {
    const n = Number(jump);
    if (Number.isInteger(n) && n >= 1 && n <= totalPages) onPageChange(n);
    setJump('');
  };

  return (
    <nav
      aria-label="Pagination"
      className={`flex flex-col sm:flex-row sm:items-center justify-between ${compact ? 'gap-2 text-[11px]' : 'gap-3 text-xs'} text-slate-600 ${className}`}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span>
          Showing <strong className="text-slate-900">{from}</strong>–<strong className="text-slate-900">{to}</strong> of{' '}
          <strong className="text-slate-900">{total}</strong> {itemLabel}
        </span>
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500" aria-hidden>
              Rows
            </span>
            <Dropdown<number>
              ariaLabel="Rows per page"
              value={pageSize}
              onChange={onPageSizeChange}
              options={pageSizeOptions.map((size) => ({ value: size, label: String(size) }))}
              size="xs"
              menuMinWidth={80}
              buttonClassName="min-w-[64px]"
            />
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            className={`${navButton} border-slate-200 bg-white hover:bg-slate-50`}
            onClick={() => onPageChange(1)}
            disabled={page === 1}
            aria-label="First page"
          >
            <ChevronsLeft size={14} />
          </button>
          <button
            type="button"
            className={`${navButton} border-slate-200 bg-white hover:bg-slate-50`}
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            aria-label="Previous page"
          >
            <ChevronLeft size={14} />
          </button>
          {buildPages(page, totalPages).map((p, i) =>
            p === 'gap' ? (
              <span key={`gap-${i}`} className="px-1 text-slate-400" aria-hidden>
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                aria-current={p === page ? 'page' : undefined}
                aria-label={`Page ${p}`}
                className={`${navButton} ${
                  p === page ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                {p}
              </button>
            )
          )}
          <button
            type="button"
            className={`${navButton} border-slate-200 bg-white hover:bg-slate-50`}
            onClick={() => onPageChange(page + 1)}
            disabled={page === totalPages}
            aria-label="Next page"
          >
            <ChevronRight size={14} />
          </button>
          <button
            type="button"
            className={`${navButton} border-slate-200 bg-white hover:bg-slate-50`}
            onClick={() => onPageChange(totalPages)}
            disabled={page === totalPages}
            aria-label="Last page"
          >
            <ChevronsRight size={14} />
          </button>
          {totalPages > 7 && (
            <form
              className="flex items-center gap-1 ml-1"
              onSubmit={(e) => {
                e.preventDefault();
                goTo();
              }}
            >
              <label htmlFor={`page-jump-${itemLabel}`} className="text-slate-500">
                Go to
              </label>
              <input
                id={`page-jump-${itemLabel}`}
                inputMode="numeric"
                value={jump}
                onChange={(e) => setJump(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={() => jump && goTo()}
                placeholder={`1–${totalPages}`}
                aria-label={`Go to page (1 to ${totalPages})`}
                className="h-7 w-14 px-1.5 rounded-md border border-slate-200 bg-white text-center focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
              />
            </form>
          )}
        </div>
      )}
    </nav>
  );
};
