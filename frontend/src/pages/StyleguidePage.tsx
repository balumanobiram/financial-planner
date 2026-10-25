import { ArrowLeftRight, CreditCard, Landmark, Plus, Users } from "lucide-react";
import { useState, type ReactNode } from "react";

import { CashflowBarChart, type CashflowPoint } from "../components/charts/CashflowBarChart";
import { Page } from "../components/layout/Page";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ChartCard, PillSelect } from "../components/ui/ChartCard";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { HeroCard } from "../components/ui/HeroCard";
import { Modal } from "../components/ui/Modal";
import { Money } from "../components/ui/Money";
import { ListSkeleton, Loading, StatCardSkeleton } from "../components/ui/Skeleton";
import { StatCard } from "../components/ui/StatCard";
import { StatusPill, type Status } from "../components/ui/StatusPill";
import { TextField } from "../components/ui/Field";
import { formatDate } from "../lib/dates";

// ---- Sample data (not real) -------------------------------------------------

const swatchGroups = [
  {
    title: "Surfaces & navigation",
    swatches: ["page", "surface", "surface-muted", "sidebar", "sidebar-active"],
  },
  { title: "Brand & text", swatches: ["primary", "secondary", "accent", "ink", "muted"] },
  { title: "Icon tints", swatches: ["tint-indigo", "tint-sky", "tint-blue", "tint-cyan"] },
  { title: "Charts (fixed order)", swatches: ["chart-1", "chart-2"] },
];

const cashflow: CashflowPoint[] = [
  ["Jan", 52000, 31000], ["Feb", 48000, 39000], ["Mar", 61000, 28000], ["Apr", 47000, 42000],
  ["May", 86000, 35000], ["Jun", 52000, 46000], ["Jul", 75000, 38000], ["Aug", 49000, 33000],
  ["Sep", 51000, 30000], ["Oct", 64000, 41000], ["Nov", 47000, 29000], ["Dec", 79000, 44000],
].map(([label, inflow, outflow]) => ({ label: label as string, inflow: inflow as number, outflow: outflow as number }));

type DueRow = { id: string; name: string; kind: string; amount: string; due: string; status: Status };

const dues: DueRow[] = [
  { id: "1", name: "HDFC Regalia", kind: "Credit card", amount: "32500.00", due: "2026-10-22", status: "overdue" },
  { id: "2", name: "Rent", kind: "Bill", amount: "28000.00", due: "2026-11-01", status: "duesoon" },
  { id: "3", name: "Arjun (dinner)", kind: "Owes you", amount: "1850.50", due: "2026-10-20", status: "partpaid" },
  { id: "4", name: "ICICI Amazon Pay", kind: "Credit card", amount: "12890.00", due: "2026-10-15", status: "paid" },
];

const dueColumns: Column<DueRow>[] = [
  { key: "status", header: "Status", cell: (r) => <StatusPill status={r.status} />, mobile: "badge" },
  { key: "name", header: "Name", cell: (r) => <span className="font-medium">{r.name}</span>, mobile: "title" },
  { key: "kind", header: "Type", cell: (r) => <span className="text-muted">{r.kind}</span>, mobile: "subtitle" },
  { key: "amount", header: "Amount", cell: (r) => <Money value={r.amount} className="font-semibold" />, align: "right", mobile: "trailing" },
  { key: "due", header: "Due date", cell: (r) => formatDate(r.due), align: "right", mobile: "subtitle" },
];

// ---- Page -------------------------------------------------------------------

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

export function StyleguidePage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [period, setPeriod] = useState<"monthly" | "weekly">("monthly");

  return (
    <Page title="Styleguide" subtitle="Every component with sample data" onAdd={() => setModalOpen(true)}>
      <div className="space-y-8">
        <Section title="Stat cards">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Landmark} tint="indigo" label="Total balance" amount="2735000.00" change={3.6} />
            <StatCard icon={CreditCard} tint="sky" label="Card dues" amount="70200.00" change={-2.05} />
            <StatCard icon={Users} tint="blue" label="Owed to you" amount="4950.00" change={1.3} />
            <StatCard icon={ArrowLeftRight} tint="cyan" label="Transactions" value="3,065" change={5.04} />
          </div>
        </Section>

        <Section title="Hero card · Chart card">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <HeroCard
              title="Add your first bank account"
              subtitle="Track balances and reconcile with your bank app in seconds."
              ctaLabel="Add account"
              onCta={() => setModalOpen(true)}
            />
            <ChartCard
              title="Money insights"
              subtitle="Cash coming in and going out"
              action={
                <PillSelect
                  label="Period"
                  value={period}
                  onChange={setPeriod}
                  options={[
                    { value: "monthly", label: "Monthly" },
                    { value: "weekly", label: "Weekly" },
                  ]}
                />
              }
            >
              <CashflowBarChart data={cashflow} />
            </ChartCard>
          </div>
        </Section>

        <Section title="Data table (stacks into a list below 768px)">
          <ChartCard title="Upcoming dues" action={<Button variant="secondary" size="sm">View all</Button>}>
            <DataTable caption="Upcoming dues" columns={dueColumns} rows={dues} rowKey={(r) => r.id} />
          </ChartCard>
        </Section>

        <div className="grid gap-8 lg:grid-cols-2">
          <Section title="Buttons">
            <Card className="flex flex-wrap gap-3">
              <Button icon={<Plus className="size-4" aria-hidden />} iconPosition="right">Add</Button>
              <Button variant="accent">Accent</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Archive</Button>
              <Button loading>Saving</Button>
              <Button size="sm" variant="secondary">Small</Button>
            </Card>
          </Section>

          <Section title="Status pills">
            <Card className="flex flex-wrap gap-3">
              {(["overdue", "duesoon", "partpaid", "paid"] as const).map((s) => (
                <StatusPill key={s} status={s} />
              ))}
            </Card>
          </Section>

          <Section title="Money">
            <Card>
              <ul className="divide-y divide-line text-sm">
                {["123456", "1234567.89", "-2500.5", "0", "99999999.99"].map((v) => (
                  <li key={v} className="flex items-center justify-between py-2.5">
                    <code className="text-muted">"{v}"</code>
                    <Money value={v} className="font-semibold" />
                  </li>
                ))}
              </ul>
            </Card>
          </Section>

          <Section title="Form fields">
            <Card className="space-y-4">
              <TextField label="Nickname" placeholder="e.g. Salary account" hint="Shown on cards and lists." />
              <TextField label="Last 4 digits" defaultValue="12a4" error="Enter exactly 4 digits." inputMode="numeric" />
            </Card>
          </Section>

          <Section title="Empty state">
            <Card>
              <EmptyState
                icon={Landmark}
                title="No accounts yet"
                description="Add a bank account or wallet to start tracking balances."
                action={<Button onClick={() => setModalOpen(true)}>Add account</Button>}
              />
            </Card>
          </Section>

          <Section title="Loading skeletons">
            <Loading>
              <div className="space-y-4">
                <StatCardSkeleton />
                <Card>
                  <ListSkeleton rows={3} />
                </Card>
              </div>
            </Loading>
          </Section>
        </div>

        <Section title="Colour tokens">
          <Card className="space-y-5">
            {swatchGroups.map((group) => (
              <div key={group.title}>
                <h3 className="mb-2 text-sm font-semibold">{group.title}</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {group.swatches.map((name) => (
                    <div key={name} className="overflow-hidden rounded-xl ring-1 ring-line">
                      <div className="h-12" style={{ background: `var(--${name})` }} />
                      <p className="bg-surface px-2.5 py-1.5 text-xs font-medium">{name}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        </Section>

        <Section title="Typography">
          <Card className="space-y-2">
            <p className="text-[28px] font-bold">Page title — 28px bold</p>
            <p className="text-lg font-semibold">Card title — 18px semibold</p>
            <p className="text-sm text-muted">Label — 14px muted</p>
            <p className="text-[30px] leading-tight font-bold">
              <Money value="2735000" showDecimals={false} />
            </p>
          </Card>
        </Section>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Add account"
        description="Bottom sheet on phones, dialog on desktop."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => setModalOpen(false)}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <TextField label="Bank name" placeholder="HDFC Bank" data-autofocus />
          <TextField label="Nickname" placeholder="Salary" />
          <TextField label="Opening balance (₹)" placeholder="0.00" inputMode="decimal" />
        </div>
      </Modal>
    </Page>
  );
}
