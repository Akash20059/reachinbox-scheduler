import React from 'react';

export interface Column<T> {
  header: string;
  accessorKey?: keyof T;
  cell?: (item: T) => React.ReactNode;
  className?: string;
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyState?: React.ReactNode;
  onRowClick?: (item: T) => void;
}

export function Table<T extends { id?: string | number }>({
  columns,
  data,
  loading = false,
  emptyState,
  onRowClick,
}: TableProps<T>) {
  if (loading) {
    return (
      <div className="w-full bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden p-6 space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="animate-pulse flex items-center gap-4">
            <div className="h-4 w-32 bg-slate-200 rounded"></div>
            <div className="h-6 w-24 bg-slate-100 rounded-full"></div>
            <div className="h-4 flex-1 bg-slate-100 rounded"></div>
            <div className="h-4 w-8 bg-slate-200 rounded"></div>
          </div>
        ))}
      </div>
    );
  }

  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className="w-full bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {columns.map((col, index) => (
                <th key={index} className={`px-5 py-3.5 ${col.className || ''}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
            {data.map((item, rowIdx) => (
              <tr
                key={item.id || rowIdx}
                onClick={() => onRowClick && onRowClick(item)}
                className={`transition-colors ${
                  onRowClick ? 'cursor-pointer hover:bg-slate-50/80' : ''
                }`}
              >
                {columns.map((col, colIdx) => (
                  <td key={colIdx} className={`px-5 py-4 ${col.className || ''}`}>
                    {col.cell
                      ? col.cell(item)
                      : col.accessorKey
                      ? String(item[col.accessorKey] ?? '')
                      : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
