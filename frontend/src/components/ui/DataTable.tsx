import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

/**
 * Where a column shows up on phones, where the table becomes a stacked list:
 *  title    — bold first line          subtitle — small muted line(s) under it
 *  trailing — right-aligned (amounts)  badge    — under the trailing value (pills)
 *  hidden   — desktop only
 */
export type MobileSlot = "title" | "subtitle" | "trailing" | "badge" | "hidden";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  mobile?: MobileSlot;
};

type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Read by screen readers; describes the table. */
  caption: string;
};

export function DataTable<T>({ columns, rows, rowKey, caption }: DataTableProps<T>) {
  const slot = (name: MobileSlot) => columns.filter((c) => (c.mobile ?? "hidden") === name);

  return (
    <>
      {/* ≥ md: real table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "pb-3 text-[11px] font-semibold tracking-wide whitespace-nowrap text-muted uppercase",
                    c.align === "right" ? "text-right" : "text-left",
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-t border-line">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "py-3.5 pr-3 whitespace-nowrap last:pr-0",
                      c.align === "right" && "text-right tabular-nums",
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* < md: stacked list items */}
      <ul className="divide-y divide-line md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={rowKey(row)} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              {slot("title").map((c) => (
                <p key={c.key} className="truncate font-semibold">
                  {c.cell(row)}
                </p>
              ))}
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
                {slot("subtitle").map((c) => (
                  <span key={c.key}>{c.cell(row)}</span>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {slot("trailing").map((c) => (
                <span key={c.key} className="font-semibold tabular-nums">
                  {c.cell(row)}
                </span>
              ))}
              {slot("badge").map((c) => (
                <span key={c.key}>{c.cell(row)}</span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
