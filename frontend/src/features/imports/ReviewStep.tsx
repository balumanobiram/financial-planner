import { CircleAlert, Copy } from "lucide-react";
import { useState } from "react";

import { useCategories } from "../../api/categories";
import { useCommitImport, type ColumnMapping, type ImportSource, type ParsedRow, type ParseResult } from "../../api/imports";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Notice } from "../../components/ui/Notice";
import { cn } from "../../lib/cn";
import { formatDate } from "../../lib/dates";
import { formatINR } from "../../lib/money";
import { buildCommit, filterRows, isImportable, selectionTotals, type ReviewTab } from "./importForm";

type Props = {
  parsed: ParseResult;
  mapping: ColumnMapping;
  source: ImportSource;
  sourceName: string;
  selected: Set<number>;
  onSelected: (s: Set<number>) => void;
  onBack: () => void;
  onDone: (created: number) => void;
};

const PAGE = 200; // rows rendered at once; "Show more" for the rest

/** Step 3: tick what to import (possible duplicates start unticked), optionally categorise, import. */
export function ReviewStep({ parsed, mapping, source, sourceName, selected, onSelected, onBack, onDone }: Props) {
  const commit = useCommitImport();
  const categories = useCategories();
  const [tab, setTab] = useState<ReviewTab>("all");
  const [shown, setShown] = useState(PAGE);
  const [rowCategory, setRowCategory] = useState<Record<number, string>>({});
  const [bulkCategory, setBulkCategory] = useState("");

  const { rows, summary } = parsed;
  const visible = filterRows(rows, tab, selected);
  const totals = selectionTotals(rows, selected);
  const activeCategories = (categories.data?.items ?? []).filter((c) => !c.is_archived);

  const toggle = (n: number) => {
    const next = new Set(selected);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    onSelected(next);
  };
  const visibleImportable = visible.filter(isImportable);
  const allVisibleOn = visibleImportable.length > 0 && visibleImportable.every((r) => selected.has(r.row_number));
  const toggleAllVisible = () => {
    const next = new Set(selected);
    for (const r of visibleImportable) {
      if (allVisibleOn) next.delete(r.row_number);
      else next.add(r.row_number);
    }
    onSelected(next);
  };
  const applyBulk = () => {
    const next = { ...rowCategory };
    for (const n of selected) next[n] = bulkCategory;
    setRowCategory(next);
  };

  const tabs: Array<{ key: ReviewTab; label: string; count: number }> = [
    { key: "all", label: "All", count: rows.length },
    { key: "selected", label: "To import", count: totals.count },
    { key: "duplicates", label: "Possible duplicates", count: summary.duplicates },
    { key: "errors", label: "Skipped", count: summary.errors },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat className="col-span-2 sm:col-span-1" label="To import" value={String(totals.count)} hint={summary.date_from && summary.date_to ? `${formatDate(summary.date_from)} – ${formatDate(summary.date_to)}` : undefined} />
        <Stat label="Money in" value={formatINR(totals.moneyIn)} />
        <Stat label="Money out" value={formatINR(totals.moneyOut)} />
      </div>
      {summary.duplicates > 0 && (
        <Notice tone="success">
          {summary.duplicates} {summary.duplicates === 1 ? "row looks" : "rows look"} like {summary.duplicates === 1 ? "an entry" : "entries"} already in {sourceName} — left unticked. Tick any that are really new.
        </Notice>
      )}
      {commit.isError && <Notice tone="error">{commit.error.message}</Notice>}

      <Card flush>
        <div role="tablist" aria-label="Show rows" className="flex gap-1 overflow-x-auto border-b border-line px-3 pt-3">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => {
                setTab(t.key);
                setShown(PAGE);
              }}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-3 pb-2.5 text-sm font-semibold whitespace-nowrap",
                tab === t.key ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink",
              )}
            >
              {t.label} <span className="ml-0.5 rounded-md bg-surface-muted px-1.5 text-xs tabular-nums">{t.count}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="size-4.5 accent-primary" checked={allVisibleOn} disabled={visibleImportable.length === 0} onChange={toggleAllVisible} />
            {allVisibleOn ? "Untick" : "Tick"} all shown
          </label>
          <span className="flex-1" />
          <label className="sr-only" htmlFor="bulk-category">
            Category for ticked rows
          </label>
          <select
            id="bulk-category"
            value={bulkCategory}
            onChange={(e) => setBulkCategory(e.target.value)}
            className="h-9 rounded-xl border border-line bg-surface px-2.5 text-sm"
          >
            <option value="">No category</option>
            {activeCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" className="h-9" disabled={selected.size === 0} onClick={applyBulk}>
            Set for ticked
          </Button>
        </div>

        {visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">Nothing here.</p>
        ) : (
          <ul className="divide-y divide-line">
            {visible.slice(0, shown).map((r) => (
              <ReviewRow
                key={r.row_number}
                row={r}
                checked={selected.has(r.row_number)}
                onToggle={() => toggle(r.row_number)}
                category={rowCategory[r.row_number] ?? ""}
                onCategory={(id) => setRowCategory({ ...rowCategory, [r.row_number]: id })}
                categories={activeCategories}
              />
            ))}
          </ul>
        )}
        {visible.length > shown && (
          <div className="border-t border-line p-3 text-center">
            <Button variant="secondary" size="sm" onClick={() => setShown(shown + PAGE)}>
              Show {Math.min(PAGE, visible.length - shown)} more of {visible.length - shown}
            </Button>
          </div>
        )}
      </Card>

      {/* Sticky on phones so the import button is always reachable in a long list. */}
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex flex-col-reverse gap-2 border-t border-line bg-page/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:justify-between sm:border-0 sm:bg-transparent sm:p-0 lg:bottom-0">
        <Button variant="secondary" onClick={onBack}>
          Back to columns
        </Button>
        <Button
          loading={commit.isPending}
          disabled={totals.count === 0}
          onClick={() =>
            commit.mutate(buildCommit(source, mapping, rows, selected, rowCategory), { onSuccess: (res) => onDone(res.created) })
          }
        >
          Import {totals.count} {totals.count === 1 ? "transaction" : "transactions"}
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, className }: { label: string; value: string; hint?: string; className?: string }) {
  return (
    <div className={cn("rounded-card bg-surface p-4 shadow-card", className)}>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 truncate text-lg font-bold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function ReviewRow({
  row: r,
  checked,
  onToggle,
  category,
  onCategory,
  categories,
}: {
  row: ParsedRow;
  checked: boolean;
  onToggle: () => void;
  category: string;
  onCategory: (id: string) => void;
  categories: Array<{ id: string; name: string }>;
}) {
  const importable = isImportable(r);
  const out = r.amount?.startsWith("-");
  const id = `row-${r.row_number}`;

  return (
    <li className={cn("flex items-start gap-3 px-4 py-3", !importable && "bg-surface-muted/50")}>
      <input
        id={id}
        type="checkbox"
        className="mt-1 size-4.5 shrink-0 accent-primary"
        checked={checked && importable}
        disabled={!importable}
        onChange={onToggle}
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="flex items-baseline justify-between gap-3">
          <span className={cn("line-clamp-2 min-w-0 font-medium break-words", !importable && "text-muted")}>{r.description ?? "(no description)"}</span>
          {r.amount !== null && (
            <span className={cn("shrink-0 font-semibold tabular-nums", !out && "text-positive", !importable && "text-muted")}>
              {out ? "−" : "+"}
              {formatINR(r.amount.replace("-", ""))}
            </span>
          )}
        </label>
        <p className="mt-0.5 text-xs text-muted">
          Row {r.row_number}
          {r.occurred_on && <> · {formatDate(r.occurred_on)}</>}
        </p>
        {r.error && (
          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-muted">
            <CircleAlert className="size-3.5 shrink-0" aria-hidden />
            {r.error}
          </p>
        )}
        {r.duplicate && (
          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-pill-duesoon-fg">
            <Copy className="size-3.5 shrink-0" aria-hidden />
            Possible duplicate of “{r.duplicate.description ?? r.duplicate.type.replace("_", " ")}”
          </p>
        )}
        {checked && importable && (
          <select
            aria-label={`Category for row ${r.row_number}`}
            value={category}
            onChange={(e) => onCategory(e.target.value)}
            className="mt-2 h-8 max-w-full rounded-lg border border-line bg-surface px-2 text-xs"
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </li>
  );
}
