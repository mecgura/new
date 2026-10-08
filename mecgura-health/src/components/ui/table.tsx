import { cn } from "@/lib/cn";
import { EmptyState, LoadingState } from "./states";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right";
  /** Hide this column in the stacked mobile layout */
  hideOnMobile?: boolean;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  loading?: boolean;
  empty?: { title: string; description?: string; action?: React.ReactNode };
}

/**
 * Responsive table: a real <table> from md up; below md every row becomes a stacked card
 * (header label + value). No horizontal page scroll at any width.
 */
export function DataTable<T>({ columns, rows, rowKey, caption, loading, empty }: Props<T>) {
  if (loading) return <LoadingState label="Loading data…" />;
  if (rows.length === 0) return <EmptyState title={empty?.title ?? "Nothing here yet"} description={empty?.description} action={empty?.action} />;
  return (
    <>
      <div className="hidden overflow-x-auto md:block" tabIndex={0} role="region" aria-label={caption}>
        <table className="type-table w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line bg-surface-muted">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("type-label px-4 py-3 whitespace-nowrap", c.align === "right" && "text-right")}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-line last:border-0 hover:bg-surface-muted/60">
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-4 py-3 align-middle", c.align === "right" && "text-right")}>{c.cell(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={rowKey(row)} className="space-y-1.5 p-card">
            {columns.filter((c) => !c.hideOnMobile).map((c) => (
              <div key={c.key} className="type-table flex items-start justify-between gap-4">
                <span className="type-caption shrink-0">{c.header}</span>
                <span className="min-w-0 text-right break-words">{c.cell(row)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}
