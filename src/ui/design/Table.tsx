import type { Key, ReactNode } from 'react';
import { cn } from './cn';

export type Column<Row> = {
  key: string;
  header: ReactNode;
  cell: (row: Row, index: number) => ReactNode;
  /** Times, gaps, money: right-aligned tabular mono so digits line up down the column. */
  numeric?: boolean;
  align?: 'left' | 'center' | 'right';
  /** CSS width, e.g. '3rem' or '20%'. */
  width?: string;
};

export type TableProps<Row> = {
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row, index: number) => Key;
  /** Visible caption; also names the table for assistive technology. */
  caption?: ReactNode;
  className?: string;
};

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

function cellClass<Row>(column: Column<Row>) {
  return cn(
    'px-2 whitespace-nowrap',
    ALIGN[column.align ?? (column.numeric ? 'right' : 'left')],
    column.numeric && 'font-mono tabular-nums',
  );
}

export function Table<Row>({ columns, rows, rowKey, caption, className }: TableProps<Row>) {
  return (
    <div className={cn('overflow-auto', className)}>
      <table className="w-full border-collapse text-sm">
        {caption !== undefined && (
          <caption className="h-row px-2 text-left align-middle text-xs text-lo">{caption}</caption>
        )}
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={column.width !== undefined ? { width: column.width } : undefined} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-panel">
          <tr className="h-row border-b border-line">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(cellClass(column), 'text-xs font-medium text-lo')}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)} className="h-row border-b border-line/60 hover:bg-raised">
              {columns.map((column) => (
                <td key={column.key} className={cellClass(column)}>
                  {column.cell(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
