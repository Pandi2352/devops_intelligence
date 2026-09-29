import React from 'react';

export interface DataColumn<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
}

interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  empty?: React.ReactNode;
  footer?: React.ReactNode;
  caption?: string;
}

export function DataTable<T>({ columns, rows, rowKey, isLoading, empty, footer, caption }: DataTableProps<T>) {
  return (
    <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-700">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            <tr>
              {columns.map((col) => (
                <th key={col.key} scope="col" className={`px-4 py-2.5 whitespace-nowrap ${col.headerClassName || ''}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && rows.length === 0 ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={`skeleton-${i}`}>
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3.5">
                      <div className="h-3 rounded bg-slate-100 animate-pulse" style={{ width: `${50 + ((i * 17) % 40)}%` }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={rowKey(row)} className="hover:bg-slate-50/70 transition-colors align-middle">
                  {columns.map((col) => (
                    <td key={col.key} className={`px-4 py-3 ${col.className || ''}`}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {footer && <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/60">{footer}</div>}
    </div>
  );
}
