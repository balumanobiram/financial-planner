import { ArrowDownLeft, ArrowUpRight, CircleAlert, ListFilter, ReceiptText, Search, Upload, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { useAccounts } from "../../api/accounts";
import { useCards } from "../../api/cards";
import { useCategories } from "../../api/categories";
import { usePeople } from "../../api/people";
import { useTransactions, type Transaction, type TransactionType } from "../../api/transactions";
import { Page } from "../../components/layout/Page";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { PillSelect } from "../../components/ui/ChartCard";
import { EmptyState } from "../../components/ui/EmptyState";
import { SelectField, TextField } from "../../components/ui/Field";
import { Notice } from "../../components/ui/Notice";
import { ListSkeleton, Loading } from "../../components/ui/Skeleton";
import { cn } from "../../lib/cn";
import { todayIST } from "../../lib/dates";
import { formatINR } from "../../lib/money";
import { EditTransactionModal } from "./EditTransactionModal";
import { useQuickAdd } from "./quickAddContext";
import { TransactionRow } from "./TransactionRow";
import { TYPE_LABELS } from "./transactionForm";
import {
  activeFilterCount,
  apiFilters,
  DATE_PRESETS,
  dayLabel,
  filtersFromParams,
  groupByDay,
  paramsFromFilters,
  visibleRows,
  type ListFilters,
} from "./transactionList";

export function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  // Filters live in the URL (≈ @RequestParam): shareable, survive refresh, and Back undoes them.
  const filters = filtersFromParams(params);
  const setFilters = (patch: Partial<ListFilters>) => setParams(paramsFromFilters({ ...filters, ...patch }), { replace: true });

  const today = todayIST();
  const query = useTransactions(apiFilters(filters, today));
  const openQuickAdd = useQuickAdd();
  const [showFilters, setShowFilters] = useState(activeFilterCount(filters) > 0);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const bySource = Boolean(filters.source);
  const rows = visibleRows(query.data?.pages.flatMap((p) => p.items) ?? [], bySource);
  const summary = query.data?.pages[0]?.summary;
  const anyFilter = activeFilterCount(filters) > 0 || filters.range !== "all" || filters.q.trim() !== "";

  return (
    <Page
      title="Transactions"
      subtitle="Tap an entry to edit or delete it"
      actions={
        <Link
          to={`/import${filters.source ? `?${filters.source.replace(":", "_id=")}` : ""}`}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-surface-muted px-3 text-sm font-semibold hover:bg-line sm:px-4"
        >
          <Upload className="size-4" aria-hidden />
          Import
        </Link>
      }
    >
      <div className="max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={filters.q} onChange={(q) => setFilters({ q })} />
          <PillSelect label="Date range" value={filters.range} options={DATE_PRESETS} onChange={(range) => setFilters({ range })} />
          <Button
            variant={showFilters || activeFilterCount(filters) ? "primary" : "secondary"}
            size="md"
            className="h-9"
            aria-expanded={showFilters}
            icon={<ListFilter className="size-4" aria-hidden />}
            onClick={() => setShowFilters((s) => !s)}
          >
            Filters{activeFilterCount(filters) ? ` (${activeFilterCount(filters)})` : ""}
          </Button>
        </div>

        {filters.range === "custom" && (
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <TextField label="From" type="date" max={filters.to || today} value={filters.from} onChange={(e) => setFilters({ from: e.target.value })} />
            <TextField label="To" type="date" min={filters.from} max={today} value={filters.to} onChange={(e) => setFilters({ to: e.target.value })} />
          </div>
        )}

        {showFilters && <FilterPanel filters={filters} onChange={setFilters} />}

        {notice && (
          <Notice tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Notice>
        )}

        {summary && <SummaryStrip count={summary.count} moneyIn={summary.money_in} moneyOut={summary.money_out} />}

        {query.isPending ? (
          <Card flush className="p-2">
            <Loading label="Loading transactions">
              <ListSkeleton rows={6} />
            </Loading>
          </Card>
        ) : query.isError && !query.data ? (
          <Card>
            <EmptyState
              icon={CircleAlert}
              title="Couldn't load transactions"
              description={query.error.message}
              action={<Button onClick={() => query.refetch()}>Try again</Button>}
            />
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <EmptyState
              icon={ReceiptText}
              title={anyFilter ? "Nothing matches" : "No transactions yet"}
              description={anyFilter ? "Try a different search or clear the filters." : "Tap + to log your first expense — it takes a few seconds."}
              action={
                anyFilter ? (
                  <Button variant="secondary" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                    Clear filters
                  </Button>
                ) : (
                  <Button onClick={() => openQuickAdd()}>Add transaction</Button>
                )
              }
            />
          </Card>
        ) : (
          <Card flush className={cn("p-1.5 transition-opacity sm:p-2", query.isPlaceholderData && "opacity-60")}>
            {groupByDay(rows).map((group) => (
              <section key={group.date} aria-label={dayLabel(group.date, today)}>
                <h2 className="sticky top-0 z-10 bg-surface px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                  {dayLabel(group.date, today)}
                </h2>
                <ul>
                  {group.items.map((t) => (
                    <TransactionRow key={t.id} txn={t} filteredBySource={bySource} onOpen={() => setEditing(t)} />
                  ))}
                </ul>
              </section>
            ))}
            <LoadMore
              hasMore={query.hasNextPage}
              loading={query.isFetchingNextPage}
              error={query.isFetchNextPageError ? query.error?.message : undefined}
              onLoad={() => query.fetchNextPage()}
            />
          </Card>
        )}
      </div>

      <EditTransactionModal txn={editing} onClose={() => setEditing(null)} onDone={setNotice} />
    </Page>
  );
}

/** Debounced: the list refetches 300ms after you stop typing, not on every key. */
function SearchBox({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);
  // The URL changed from outside (e.g. "Clear filters"): adopt it. Adjusting state while
  // rendering is React's recommended alternative to a setState-in-effect here.
  if (value !== synced) {
    setSynced(value);
    setText(value);
  }
  const commit = useEffectEvent((q: string) => onChange(q));

  useEffect(() => {
    if (text === synced) return;
    const timer = window.setTimeout(() => commit(text), 300);
    return () => window.clearTimeout(timer);
  }, [text, synced]);

  return (
    <label className="relative min-w-0 flex-1 basis-full sm:basis-60">
      <span className="sr-only">Search notes and tags</span>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        placeholder="Search notes, tags…"
        maxLength={100}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="h-10 w-full rounded-xl border border-line bg-surface pr-9 pl-9 text-base placeholder:text-muted/70 focus:border-primary focus:ring-2 focus:ring-primary/25 focus:outline-none sm:h-9 sm:text-sm"
      />
      {text && (
        <button type="button" aria-label="Clear search" onClick={() => setText("")} className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-ink">
          <X className="size-4" aria-hidden />
        </button>
      )}
    </label>
  );
}

function FilterPanel({ filters, onChange }: { filters: ListFilters; onChange: (patch: Partial<ListFilters>) => void }) {
  const accounts = useAccounts();
  const cards = useCards();
  const categories = useCategories();
  const people = usePeople();

  return (
    <Card flush className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <SelectField label="Account / card" value={filters.source} onChange={(e) => onChange({ source: e.target.value })}>
        <option value="">All</option>
        {(cards.data?.items.length ?? 0) > 0 && (
          <optgroup label="Cards">
            {cards.data?.items.map((c) => (
              <option key={c.id} value={`card:${c.id}`}>
                {c.card_name}
                {c.last4 ? ` ••${c.last4}` : ""}
                {c.is_archived ? " (archived)" : ""}
              </option>
            ))}
          </optgroup>
        )}
        {(accounts.data?.items.length ?? 0) > 0 && (
          <optgroup label="Bank accounts">
            {accounts.data?.items.map((a) => (
              <option key={a.id} value={`account:${a.id}`}>
                {a.bank_name} · {a.nickname}
                {a.is_archived ? " (archived)" : ""}
              </option>
            ))}
          </optgroup>
        )}
      </SelectField>
      <SelectField label="Category" value={filters.categoryId} onChange={(e) => onChange({ categoryId: e.target.value })}>
        <option value="">All</option>
        {categories.data?.items.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.is_archived ? " (archived)" : ""}
          </option>
        ))}
      </SelectField>
      <SelectField label="Person" value={filters.personId} onChange={(e) => onChange({ personId: e.target.value })}>
        <option value="">Anyone</option>
        {people.data?.items.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>
      <SelectField label="Type" value={filters.type} onChange={(e) => onChange({ type: e.target.value as TransactionType | "" })}>
        <option value="">All types</option>
        {(Object.keys(TYPE_LABELS) as TransactionType[]).map((t) => (
          <option key={t} value={t}>
            {TYPE_LABELS[t]}
          </option>
        ))}
      </SelectField>
      {activeFilterCount(filters) > 0 && (
        <div className="sm:col-span-2 lg:col-span-4">
          <Button variant="ghost" size="sm" onClick={() => onChange({ source: "", categoryId: "", personId: "", type: "" })}>
            Clear these filters
          </Button>
        </div>
      )}
    </Card>
  );
}

function SummaryStrip({ count, moneyIn, moneyOut }: { count: number; moneyIn: string; moneyOut: string }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex items-center gap-3 rounded-card bg-surface p-3.5 shadow-card">
        <span className="grid size-9 shrink-0 place-items-center rounded-full max-sm:hidden bg-tint-cyan text-tint-cyan-fg">
          <ArrowDownLeft className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted">Money in</p>
          <p className="truncate font-bold tabular-nums">{formatINR(moneyIn)}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-card bg-surface p-3.5 shadow-card">
        <span className="grid size-9 shrink-0 place-items-center rounded-full max-sm:hidden bg-tint-indigo text-tint-indigo-fg">
          <ArrowUpRight className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted">Money out</p>
          <p className="truncate font-bold tabular-nums">{formatINR(moneyOut)}</p>
        </div>
      </div>
      <p className="col-span-2 -mt-1 text-xs text-muted">
        {count} {count === 1 ? "entry" : "entries"} · transfers and card bills aren't counted as in/out
      </p>
    </div>
  );
}

/**
 * Infinite scroll: an invisible marker at the end of the list; when it scrolls into view
 * (IntersectionObserver), fetch the next page. The button is the fallback.
 */
function LoadMore({ hasMore, loading, error, onLoad }: { hasMore: boolean; loading: boolean; error?: string; onLoad: () => void }) {
  const marker = useRef<HTMLDivElement>(null);
  const load = useEffectEvent(onLoad);

  useEffect(() => {
    const el = marker.current;
    if (!el || !hasMore || error) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && load(), { rootMargin: "400px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, error]);

  if (!hasMore) return <p className="py-4 text-center text-xs text-muted">That's everything.</p>;
  return (
    <div ref={marker} className="flex flex-col items-center gap-2 py-4">
      {error && <p className="text-xs font-medium text-negative">{error}</p>}
      <Button variant="secondary" size="sm" loading={loading} onClick={onLoad}>
        {error ? "Try again" : "Load more"}
      </Button>
    </div>
  );
}
