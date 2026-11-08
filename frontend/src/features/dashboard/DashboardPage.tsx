import { CircleAlert, CreditCard, HandCoins, Landmark, PieChart, Scale } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { useDashboard, type CardDue, type DashboardSummary } from "../../api/dashboard";
import type { Transaction } from "../../api/transactions";
import { CashflowBarChart } from "../../components/charts/CashflowBarChart";
import { CategoryDonut } from "../../components/charts/CategoryDonut";
import { WeekBarChart } from "../../components/charts/WeekBarChart";
import { Page } from "../../components/layout/Page";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ChartCard, PillSelect } from "../../components/ui/ChartCard";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { HeroCard } from "../../components/ui/HeroCard";
import { Money } from "../../components/ui/Money";
import { ListSkeleton, Loading, Skeleton, StatCardSkeleton } from "../../components/ui/Skeleton";
import { ChangeChip, StatCard } from "../../components/ui/StatCard";
import { StatusPill } from "../../components/ui/StatusPill";
import { cn } from "../../lib/cn";
import { formatDateShort } from "../../lib/dates";
import { formatINR } from "../../lib/money";
import { useQuickAdd } from "../transactions/quickAddContext";
import { EditTransactionModal } from "../transactions/EditTransactionModal";
import { TransactionRow } from "../transactions/TransactionRow";
import { changeValue, daysLeftLabel, heroText, insightsChartData, weekChartData } from "./dashboardView";

/*
 * Grid placement. The DOM is in PHONE order (hero → stats → card dues → insights → week →
 * expenses → recent), which is also the screen-reader and keyboard order; on large screens
 * each section is placed into the design-reference grid explicitly.
 */
const AREA = {
  hero: "lg:col-span-3 lg:col-start-1 lg:row-start-1",
  stats: "lg:col-span-3 lg:col-start-4 lg:row-start-1",
  insights: "lg:col-span-6 lg:col-start-7 lg:row-start-1",
  week: "lg:col-span-6 lg:col-start-1 lg:row-start-2",
  dues: "lg:col-span-6 lg:col-start-7 lg:row-start-2",
  expenses: "lg:col-span-6 lg:col-start-1 lg:row-start-3 lg:self-start", // don't stretch to the recent list's height
  recent: "lg:col-span-6 lg:col-start-7 lg:row-start-3",
};

export function DashboardPage() {
  const dashboard = useDashboard();
  const [editing, setEditing] = useState<Transaction | null>(null);

  return (
    <Page title="Dashboard">
      {dashboard.isPending ? (
        <DashboardSkeleton />
      ) : dashboard.isError ? (
        <Card>
          <EmptyState
            icon={CircleAlert}
            title="Couldn't load your dashboard"
            description={dashboard.error.message}
            action={<Button onClick={() => dashboard.refetch()}>Try again</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
          <Hero due={dashboard.data.hero} className={AREA.hero} />
          <Stats stats={dashboard.data.stats} className={AREA.stats} />
          <CardDues dues={dashboard.data.card_dues} className={AREA.dues} />
          <Insights months={dashboard.data.money_insights} className={AREA.insights} />
          <Week week={dashboard.data.week} today={dashboard.data.today} className={AREA.week} />
          <Expenses expenses={dashboard.data.expenses} className={AREA.expenses} />
          <Recent items={dashboard.data.recent} onOpen={setEditing} className={AREA.recent} />
        </div>
      )}
      <EditTransactionModal txn={editing} onClose={() => setEditing(null)} onDone={() => setEditing(null)} />
    </Page>
  );
}

// Phones: the hero is short, so leave room above the text for the decorative ribbon.
const HERO_ROOM = "max-lg:pt-24";

function Hero({ due, className }: { due: CardDue | null; className: string }) {
  const quickAdd = useQuickAdd();
  if (!due) {
    return (
      <HeroCard
        className={cn(className, HERO_ROOM)}
        eyebrow="All clear"
        title="No card bills due this week"
        subtitle="Log today's spending in a few taps."
        ctaLabel="Quick add transaction"
        onCta={() => quickAdd()}
      />
    );
  }
  const text = heroText(due);
  return (
    <HeroCard
      className={cn(className, HERO_ROOM)}
      eyebrow={due.status === "overdue" ? "Overdue card bill" : "Next card bill due"}
      title={text.title}
      subtitle={text.subtitle}
      ctaLabel="Pay now"
      onCta={() => quickAdd({ type: "card_payment", card: due.card_id, amount: due.amount })}
    />
  );
}

function Stats({ stats, className }: { stats: DashboardSummary["stats"]; className: string }) {
  return (
    // 2×2 on phones (labels shortened to fit), a single column beside the hero on desktop.
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-1 lg:gap-4", className)}>
      <StatCard tileOnMobile icon={Landmark} tint="indigo" label="In banks" amount={stats.bank_total.value} change={changeValue(stats.bank_total.change_pct)} />
      <StatCard
        tileOnMobile
        icon={CreditCard}
        tint="sky"
        label="Card dues"
        amount={stats.card_outstanding.value}
        change={changeValue(stats.card_outstanding.change_pct)}
        goodWhen="down"
      />
      <StatCard tileOnMobile icon={HandCoins} tint="blue" label="Owed to me" amount={stats.owed_to_me.value} change={changeValue(stats.owed_to_me.change_pct)} />
      <StatCard tileOnMobile icon={Scale} tint="cyan" label="Net position" amount={stats.net_position.value} change={changeValue(stats.net_position.change_pct)} />
    </div>
  );
}

const dueColumns: Column<CardDue>[] = [
  { key: "status", header: "Status", cell: (d) => <StatusPill status={d.status} />, mobile: "badge" },
  { key: "card", header: "Card · bank", cell: (d) => <CardName due={d} />, mobile: "title" },
  // On desktop the bank sits under the card name (the table is half the page wide).
  { key: "bank", header: "Bank", cell: (d) => d.bank_name, mobile: "subtitle", desktop: false },
  { key: "amount", header: "Amount", cell: (d) => <Money value={d.amount} />, align: "right", mobile: "trailing" },
  {
    key: "due",
    header: "Due",
    cell: (d) => (
      <span className={cn(d.status === "overdue" && "font-semibold text-negative")} title={daysLeftLabel(d.days_left)}>
        {formatDateShort(d.due_date)}
      </span>
    ),
    align: "right",
    mobile: "subtitle",
  },
];

function CardName({ due }: { due: CardDue }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="size-2.5 shrink-0 rounded-full ring-1 ring-ink/10" style={{ background: due.color }} aria-hidden />
      <span>
        {due.card_name}
        {due.last4 && <span className="text-muted"> ••{due.last4}</span>}
        <span className="hidden text-xs text-muted md:block">{due.bank_name}</span>
      </span>
    </span>
  );
}

function CardDues({ dues, className }: { dues: CardDue[]; className: string }) {
  return (
    <ChartCard title="Card dues" className={className} action={<SeeAll to="/cards" label="All cards" />}>
      {dues.length === 0 ? (
        <EmptyState icon={CreditCard} title="No cards yet" description="Add a card to see its bills and due dates here." className="py-6" />
      ) : (
        <DataTable caption="Card dues" columns={dueColumns} rows={dues} rowKey={(d) => d.card_id} />
      )}
    </ChartCard>
  );
}

function Insights({ months, className }: { months: DashboardSummary["money_insights"]; className: string }) {
  const data = insightsChartData(months);
  return (
    <ChartCard title="Money insights" subtitle="Money in and out, last 12 months (transfers excluded)" className={className}>
      <CashflowBarChart data={data} height={240} />
      <table className="sr-only">
        <caption>Money in and out by month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">In</th>
            <th scope="col">Out</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row">{m.month.slice(0, 7)}</th>
              <td>{formatINR(m.inflow)}</td>
              <td>{formatINR(m.outflow)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartCard>
  );
}

function Week({ week, today, className }: { week: DashboardSummary["week"]; today: string; className: string }) {
  const bars = weekChartData(week, today);
  const change = changeValue(week.change_pct);
  return (
    <ChartCard title="This week's spending" subtitle="Your share — splits and refunds taken out" className={className}>
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <span className="text-3xl font-bold tabular-nums">{formatINR(week.total, { showDecimals: false })}</span>
        {change !== undefined && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
            <ChangeChip value={change} goodWhen="down" />
            vs same days last week ({formatINR(week.last_week_total, { showDecimals: false })})
          </span>
        )}
      </div>
      <WeekBarChart data={bars} />
      <ul className="sr-only">
        {bars.map((b) => (
          <li key={b.day}>
            {b.label}: {formatINR(b.amount)}
            {b.isToday ? " (today)" : ""}
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

type Period = "week" | "month";
const PERIODS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
];

function Expenses({ expenses, className }: { expenses: DashboardSummary["expenses"]; className: string }) {
  const [period, setPeriod] = useState<Period>("month");
  const slices = expenses[period];
  const total = period === "week" ? expenses.week_total : expenses.month_total;
  return (
    <ChartCard
      title="Expenses analysis"
      subtitle={period === "week" ? "This week, by category" : "This month, by category"}
      className={className}
      action={<PillSelect label="Period" value={period} options={PERIODS} onChange={setPeriod} />}
    >
      {slices.length === 0 ? (
        <EmptyState icon={PieChart} title="No spending yet" description={`Nothing spent ${period === "week" ? "this week" : "this month"} so far.`} className="py-6" />
      ) : (
        <CategoryDonut slices={slices} total={total} />
      )}
    </ChartCard>
  );
}

function Recent({ items, onOpen, className }: { items: Transaction[]; onOpen: (t: Transaction) => void; className: string }) {
  const quickAdd = useQuickAdd();
  return (
    <ChartCard title="Recent transactions" className={className} action={<SeeAll to="/transactions" label="See all" />}>
      {items.length === 0 ? (
        <EmptyState
          title="Nothing logged yet"
          description="Your latest entries show up here."
          action={<Button onClick={() => quickAdd()}>Add transaction</Button>}
          className="py-6"
        />
      ) : (
        <ul className="-mx-3 -my-1">
          {items.map((t) => (
            <TransactionRow key={t.id} txn={t} filteredBySource={false} onOpen={() => onOpen(t)} />
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

function SeeAll({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="inline-flex h-9 items-center rounded-xl bg-surface-muted px-3 text-sm font-semibold hover:bg-line">
      {label}
    </Link>
  );
}

function DashboardSkeleton() {
  return (
    <Loading label="Loading dashboard">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
        <Skeleton className={cn("h-60 rounded-card", AREA.hero)} />
        <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-1", AREA.stats)}>
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
        <Card className={AREA.insights}>
          <Skeleton className="h-64" />
        </Card>
        <Card className={AREA.week}>
          <Skeleton className="h-52" />
        </Card>
        <Card className={AREA.dues}>
          <ListSkeleton rows={4} />
        </Card>
      </div>
    </Loading>
  );
}
