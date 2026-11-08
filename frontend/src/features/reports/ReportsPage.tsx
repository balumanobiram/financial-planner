import { ArrowDownLeft, ArrowUpRight, CircleAlert, Download, FileText, HandCoins, Landmark, PiggyBank, RefreshCcw, Scale, Wallet } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { useDownloadReport, useRegenerateReport, useReport, type ReportData, type ReportQuery } from "../../api/reports";
import { CashflowBarChart } from "../../components/charts/CashflowBarChart";
import { CategoryDonut } from "../../components/charts/CategoryDonut";
import { Page } from "../../components/layout/Page";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ChartCard, PillSelect } from "../../components/ui/ChartCard";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { TextField } from "../../components/ui/Field";
import { Money } from "../../components/ui/Money";
import { Notice } from "../../components/ui/Notice";
import { ListSkeleton, Loading, StatCardSkeleton } from "../../components/ui/Skeleton";
import { StatCard } from "../../components/ui/StatCard";
import { StatusPill } from "../../components/ui/StatusPill";
import { cn } from "../../lib/cn";
import { formatDate, formatDateShort, todayIST } from "../../lib/dates";
import { saveBlob } from "../../lib/download";
import { formatINR, formatINRSigned } from "../../lib/money";
import { rupees } from "../dashboard/dashboardView";
import {
  adjustMonthRange,
  categoryChange,
  currentFinancialYear,
  defaultMonthRange,
  fallbackFilename,
  fyOptions,
  lastMonth,
  monthOptions,
  paramsFromQuery,
  queryFromParams,
  rangeError,
  STATEMENT_PILL,
  yearOptions,
} from "./reportView";

type View = ReportQuery["view"];
const VIEWS: Array<{ value: View; label: string }> = [
  { value: "month", label: "Month" },
  { value: "months", label: "Months" },
  { value: "fy", label: "Financial year" },
  { value: "year", label: "Year" },
  { value: "range", label: "Custom dates" },
];

export function ReportsPage() {
  const today = todayIST();
  const [params, setParams] = useSearchParams();
  // The URL is the state (≈ @RequestParam): links and refresh keep the same report.
  const query = queryFromParams(params, today);
  const setQuery = (q: ReportQuery) => setParams(paramsFromQuery(q), { replace: true });

  const report = useReport(query);
  const download = useDownloadReport();
  const regenerate = useRegenerateReport();
  const [notice, setNotice] = useState<string | null>(null);

  const switchView = (view: View) => {
    if (view === query.view) return;
    if (view === "month") setQuery({ view, month: lastMonth(today) });
    if (view === "months") setQuery({ view, ...defaultMonthRange(today) });
    if (view === "fy") setQuery({ view, fy: currentFinancialYear(today) });
    if (view === "year") setQuery({ view, year: today.slice(0, 4) });
    if (view === "range") setQuery({ view, from: `${today.slice(0, 7)}-01`, to: today });
  };

  const downloadPdf = () =>
    download.mutate(query, { onSuccess: ({ blob, filename }) => saveBlob(blob, filename ?? fallbackFilename(query)) });

  return (
    <Page
      title="Reports"
      actions={
        <Button onClick={downloadPdf} loading={download.isPending} disabled={!report.data} icon={<Download className="size-4" aria-hidden />}>
          <span className="max-sm:sr-only">Download PDF</span>
        </Button>
      }
    >
      <div className="max-w-6xl space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          {/* Five tabs don't fit a phone's width: the row scrolls sideways instead of wrapping. */}
          <div role="tablist" aria-label="Report type" className="flex max-w-full overflow-x-auto rounded-xl bg-surface-muted p-1">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                role="tab"
                aria-selected={query.view === v.value}
                onClick={() => switchView(v.value)}
                className={cn("h-8 shrink-0 rounded-lg px-3 text-sm font-semibold whitespace-nowrap", query.view === v.value ? "bg-surface shadow-sm" : "text-muted")}
              >
                {v.label}
              </button>
            ))}
          </div>
          {query.view === "month" && (
            <PillSelect label="Month" value={query.month} options={monthOptions(today)} onChange={(month) => setQuery({ view: "month", month })} />
          )}
          {query.view === "months" && (
            <div className="flex flex-wrap items-center gap-2">
              <PillSelect
                label="First month"
                value={query.from}
                options={monthOptions(today)}
                onChange={(from) => setQuery({ view: "months", ...adjustMonthRange(from, query.to, "from") })}
              />
              <span className="text-sm text-muted">to</span>
              <PillSelect
                label="Last month"
                value={query.to}
                options={monthOptions(today)}
                onChange={(to) => setQuery({ view: "months", ...adjustMonthRange(query.from, to, "to") })}
              />
            </div>
          )}
          {query.view === "fy" && (
            <PillSelect label="Financial year (April–March)" value={query.fy} options={fyOptions(today)} onChange={(fy) => setQuery({ view: "fy", fy })} />
          )}
          {query.view === "year" && (
            <PillSelect label="Year" value={query.year} options={yearOptions(today)} onChange={(year) => setQuery({ view: "year", year })} />
          )}
          {query.view === "range" && <RangePicker key={`${query.from}${query.to}`} from={query.from} to={query.to} today={today} onApply={setQuery} />}
        </div>

        {download.isError && (
          <Notice tone="error" onDismiss={() => download.reset()}>
            Couldn't download the PDF: {download.error.message}
          </Notice>
        )}
        {notice && (
          <Notice tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Notice>
        )}

        {report.isPending ? (
          <ReportSkeleton />
        ) : report.isError ? (
          <Card>
            <EmptyState
              icon={CircleAlert}
              title="Couldn't load this report"
              description={report.error.message}
              action={<Button onClick={() => report.refetch()}>Try again</Button>}
            />
          </Card>
        ) : (
          <div className={cn("space-y-5 transition-opacity", report.isPlaceholderData && "opacity-60")}>
            <PeriodBar
              data={report.data}
              regenerating={regenerate.isPending}
              onRegenerate={
                query.view === "month"
                  ? () => regenerate.mutate(query.month, { onSuccess: () => setNotice("Rebuilt from your current transactions.") })
                  : undefined
              }
            />
            <ReportBody data={report.data} />
          </div>
        )}
      </div>
    </Page>
  );
}

function RangePicker({ from, to, today, onApply }: { from: string; to: string; today: string; onApply: (q: ReportQuery) => void }) {
  const [values, setValues] = useState({ from, to });
  const error = rangeError(values.from, values.to, today);
  const changed = values.from !== from || values.to !== to;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <TextField label="From" type="date" max={today} className="w-40" value={values.from} onChange={(e) => setValues({ ...values, from: e.target.value })} />
      <TextField label="To" type="date" max={today} className="w-40" value={values.to} onChange={(e) => setValues({ ...values, to: e.target.value })} />
      <Button className="h-11" disabled={!changed || error !== null} onClick={() => onApply({ view: "range", ...values })}>
        Show
      </Button>
      {changed && error && <p className="w-full text-xs font-medium text-negative">{error}</p>}
    </div>
  );
}

function PeriodBar({ data, regenerating, onRegenerate }: { data: ReportData; regenerating: boolean; onRegenerate?: () => void }) {
  const p = data.period;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 className="text-xl font-bold">{p.label}</h2>
      <span className="text-sm text-muted">
        {formatDate(p.start)} – {formatDate(p.end)}
      </span>
      {!p.is_complete ? (
        <StatusPill status="duesoon" label="In progress" />
      ) : data.from_snapshot ? (
        <>
          <StatusPill status="partpaid" label={`Frozen ${formatDateShort(data.generated_at.slice(0, 10))}`} />
          {onRegenerate && (
            <Button variant="ghost" size="sm" loading={regenerating} onClick={onRegenerate} icon={<RefreshCcw className="size-3.5" aria-hidden />}>
              Regenerate
            </Button>
          )}
        </>
      ) : null}
    </div>
  );
}

const TONE_CLASS: Record<ReportData["insights"][number]["tone"], string> = {
  bad: "bg-pill-overdue text-pill-overdue-fg",
  warn: "bg-pill-duesoon text-pill-duesoon-fg",
  good: "bg-positive/10 text-positive",
  info: "bg-tint-blue text-tint-blue-fg",
};

function ReportBody({ data }: { data: ReportData }) {
  const s = data.summary;
  const net = data.net_position;
  const vs = data.period.compare_label;
  const netPct = Number(net.previous_value) !== 0 ? (Number(net.change) / Math.abs(Number(net.previous_value))) * 100 : undefined;
  const slices = data.expense_categories.filter((c) => Number(c.amount) > 0);

  return (
    <>
      {data.insights.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Insights">
          {data.insights.map((i) => (
            <li key={i.text} className={cn("rounded-full px-3 py-1.5 text-sm font-medium", TONE_CLASS[i.tone])}>
              {i.text}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard tileOnMobile icon={ArrowDownLeft} tint="cyan" label="Income" amount={s.income} />
        <StatCard tileOnMobile icon={ArrowUpRight} tint="indigo" label="Expenses" amount={s.expenses} />
        <StatCard tileOnMobile icon={PiggyBank} tint="blue" label="Net savings" amount={s.net_savings} />
        <StatCard tileOnMobile icon={Wallet} tint="sky" label="Savings rate" value={s.savings_rate === null ? "—" : `${s.savings_rate}%`} />
        <StatCard tileOnMobile icon={Scale} tint="blue" label="Net position" amount={net.value} change={netPct} />
        <StatCard tileOnMobile icon={Landmark} tint="indigo" label="In banks" amount={net.banks} />
        <StatCard tileOnMobile icon={HandCoins} tint="cyan" label="Owed to me" amount={net.owed_to_me} />
        <StatCard tileOnMobile icon={FileText} tint="sky" label="Card outstanding" amount={net.card_outstanding} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Expenses by category" subtitle="Your share — splits and refunds taken out">
          {slices.length ? <CategoryDonut slices={slices} total={s.expenses} /> : <EmptyState title="No spending in this period" className="py-6" />}
        </ChartCard>
        <ChartCard title="Income vs expenses" subtitle="By month">
          <CashflowBarChart
            names={["Income", "Expenses"]}
            height={240}
            data={data.trend.map((t) => ({
              label: new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(new Date(`${t.month}T00:00:00Z`)),
              inflow: rupees(t.income),
              outflow: rupees(t.expenses),
            }))}
          />
        </ChartCard>
      </div>

      <Section title="Categories" subtitle={`Compared with ${vs}`} empty={data.expense_categories.length === 0}>
        <DataTable caption="Spending by category" rowKey={(c) => c.name} rows={data.expense_categories} columns={categoryColumns(vs)} />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Income" empty={data.income_sources.length === 0} emptyText="No income recorded in this period.">
          <DataTable caption="Income by source" rowKey={(i) => i.source} rows={data.income_sources} columns={incomeColumns} />
        </Section>
        <Section title="Bank accounts" empty={s.accounts.length === 0}>
          <DataTable caption="Bank accounts, opening and closing" rowKey={(a) => a.account_id} rows={s.accounts} columns={accountColumns} />
        </Section>
      </div>

      <Section title="Credit cards" subtitle="Statements generated in this period" empty={data.cards.length === 0} emptyText="No card statements in this period.">
        <DataTable caption="Card statements" rowKey={(c) => `${c.card_id}-${c.statement_date}`} rows={data.cards} columns={cardColumns} />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Largest expenses" empty={data.top_expenses.length === 0}>
          <DataTable caption="Largest expenses" rowKey={(t) => t.transaction_id} rows={data.top_expenses} columns={topColumns} />
        </Section>
        <Section title="People" empty={data.people.length === 0} emptyText="Nobody owed you anything in this period.">
          <DataTable caption="Money people owe you" rowKey={(p) => p.person_id} rows={data.people} columns={peopleColumns} />
        </Section>
      </div>
    </>
  );
}

function Section({ title, subtitle, empty, emptyText = "Nothing in this period.", children }: { title: string; subtitle?: string; empty: boolean; emptyText?: string; children: ReactNode }) {
  return (
    <ChartCard title={title} subtitle={subtitle}>
      {empty ? <p className="py-4 text-sm text-muted">{emptyText}</p> : children}
    </ChartCard>
  );
}

// ---- Table columns ------------------------------------------------------------------------------

type Row<K extends keyof ReportData> = ReportData[K] extends Array<infer T> ? T : never;

const Swatch = ({ color }: { color: string }) => <span className="size-2.5 shrink-0 rounded-full ring-1 ring-ink/10" style={{ background: color }} aria-hidden />;

function categoryColumns(vs: string): Column<Row<"expense_categories">>[] {
  return [
    { key: "name", header: "Category", cell: (c) => <span className="inline-flex items-center gap-2"><Swatch color={c.color} />{c.name}</span>, mobile: "title" },
    { key: "amount", header: "Amount", cell: (c) => <Money value={c.amount} />, align: "right", mobile: "trailing" },
    { key: "share", header: "Share", cell: (c) => `${c.percent}%`, align: "right", mobile: "subtitle" },
    { key: "previous", header: `In ${vs}`, cell: (c) => <Money value={c.previous} className="text-muted" />, align: "right" },
    {
      key: "change",
      header: "Change",
      cell: (c) => {
        const ch = categoryChange(c.change_pct, c.amount);
        return <span className={cn("font-semibold", ch.tone === "up" ? "text-negative" : ch.tone === "down" ? "text-positive" : "text-muted")}>{ch.text}</span>;
      },
      align: "right",
      mobile: "badge",
    },
  ];
}

const incomeColumns: Column<Row<"income_sources">>[] = [
  { key: "label", header: "Source", cell: (i) => i.label, mobile: "title" },
  { key: "share", header: "Share", cell: (i) => `${i.percent}%`, align: "right", mobile: "subtitle" },
  { key: "amount", header: "Amount", cell: (i) => <Money value={i.amount} />, align: "right", mobile: "trailing" },
];

const accountColumns: Column<ReportData["summary"]["accounts"][number]>[] = [
  { key: "name", header: "Account", cell: (a) => `${a.name}${a.is_archived ? " (archived)" : ""}`, mobile: "title" },
  { key: "opening", header: "Opening", cell: (a) => <Money value={a.opening} />, align: "right", mobile: "subtitle" },
  { key: "closing", header: "Closing", cell: (a) => <Money value={a.closing} />, align: "right", mobile: "trailing" },
  {
    key: "change",
    header: "Change",
    cell: (a) => <span className={cn("font-medium tabular-nums", Number(a.change) > 0 ? "text-positive" : Number(a.change) < 0 && "text-negative")}>{formatINRSigned(a.change)}</span>,
    align: "right",
    mobile: "badge",
  },
];

const cardColumns: Column<Row<"cards">>[] = [
  { key: "status", header: "Status", cell: (c) => <StatusPill {...STATEMENT_PILL[c.status]} />, mobile: "badge" },
  { key: "card", header: "Card", cell: (c) => <span className="inline-flex items-center gap-2"><Swatch color={c.color} />{c.card_name}{c.last4 && <span className="text-muted">••{c.last4}</span>}</span>, mobile: "title" },
  { key: "statement", header: "Statement", cell: (c) => formatDateShort(c.statement_date), mobile: "subtitle" },
  { key: "due", header: "Due", cell: (c) => formatDateShort(c.due_date), mobile: "subtitle" },
  { key: "amount", header: "Amount", cell: (c) => <Money value={c.amount} />, align: "right", mobile: "trailing" },
  { key: "paid", header: "Paid", cell: (c) => <Money value={c.paid} />, align: "right" },
  { key: "used", header: "Used", cell: (c) => (c.utilization_pct === null ? "—" : `${c.utilization_pct}%`), align: "right" },
  { key: "fees", header: "Fees", cell: (c) => (Number(c.fees) > 0 ? <span className="text-negative">{formatINR(c.fees)}</span> : "—"), align: "right" },
];

const topColumns: Column<Row<"top_expenses">>[] = [
  { key: "what", header: "Expense", cell: (t) => t.description ?? t.category ?? "Expense", mobile: "title" },
  { key: "date", header: "Date", cell: (t) => formatDateShort(t.occurred_on), mobile: "subtitle" },
  { key: "source", header: "Paid with", cell: (t) => t.source, mobile: "subtitle" },
  { key: "amount", header: "Amount", cell: (t) => <Money value={t.amount} />, align: "right", mobile: "trailing" },
];

const peopleColumns: Column<Row<"people">>[] = [
  { key: "name", header: "Person", cell: (p) => p.name, mobile: "title" },
  { key: "new", header: "New shares", cell: (p) => <Money value={p.new_shares} />, align: "right" },
  { key: "settled", header: "Paid back", cell: (p) => <Money value={p.settled} />, align: "right", mobile: "subtitle" },
  { key: "pending", header: "Pending", cell: (p) => <Money value={p.pending} className="font-semibold" />, align: "right", mobile: "trailing" },
];

function ReportSkeleton() {
  return (
    <Loading label="Loading report">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
        <Card>
          <ListSkeleton rows={5} />
        </Card>
      </div>
    </Loading>
  );
}
