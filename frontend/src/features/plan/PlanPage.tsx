import { CircleAlert, CircleCheck, PiggyBank, Pencil, Plus, ShoppingBag, Trash2, TrendingUp, Wallet } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { useDeletePlanItem, usePlan, useSavePlanItem, useUpdatePlan, type Plan, type PlanItem } from "../../api/plan";
import { CategoryDonut } from "../../components/charts/CategoryDonut";
import { Page } from "../../components/layout/Page";
import { Button, IconButton } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ChartCard } from "../../components/ui/ChartCard";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { EmptyState } from "../../components/ui/EmptyState";
import { TextAreaField, TextField } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatCard } from "../../components/ui/StatCard";
import { cn } from "../../lib/cn";
import { formatINR, toPaise } from "../../lib/money";
import { Chip, ChipRow } from "../transactions/pickers";
import { GROUPS, groupInfo, groupSlices, itemSlices, salaryInput, validateItem, type ItemErrors, type ItemValues } from "./planForm";

/**
 * Plan: your salary and where it should go. A planning sheet only — saved, but it never reads
 * or changes accounts, transactions or reports.
 */
export function PlanPage() {
  const plan = usePlan();
  const [editing, setEditing] = useState<PlanItem | "new" | null>(null);
  const [deleting, setDeleting] = useState<PlanItem | null>(null);
  const remove = useDeletePlanItem();

  return (
    <Page title="Plan" subtitle="Your salary and where it goes. Just a plan — it doesn't change your accounts." onAdd={() => setEditing("new")} addLabel="Add line">
      {plan.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : plan.isError ? (
        <Card>
          <EmptyState icon={CircleAlert} title="Couldn't load your plan" description={plan.error.message} />
        </Card>
      ) : (
        <PlanBody plan={plan.data} onAdd={() => setEditing("new")} onEdit={setEditing} onDelete={setDeleting} />
      )}

      <ItemModal target={editing} onClose={() => setEditing(null)} />
      <ConfirmModal
        open={deleting !== null}
        title="Delete this line?"
        confirmLabel="Delete"
        danger
        busy={remove.isPending}
        error={remove.isError ? remove.error.message : undefined}
        onClose={() => {
          remove.reset();
          setDeleting(null);
        }}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
      >
        {deleting && (
          <p>
            Remove <span className="font-semibold">{deleting.name}</span> ({formatINR(deleting.amount)}) from your plan?
          </p>
        )}
      </ConfirmModal>
    </Page>
  );
}

function PlanBody({ plan, onAdd, onEdit, onDelete }: { plan: Plan; onAdd: () => void; onEdit: (i: PlanItem) => void; onDelete: (i: PlanItem) => void }) {
  const amountOf = (g: string) => plan.groups.find((x) => x.group === g)?.amount ?? "0.00";
  const negative = toPaise(plan.left_over) < 0n;
  const hasSalary = toPaise(plan.salary) > 0n;
  const byGroup = groupSlices(plan);
  const byItem = itemSlices(plan);

  return (
    <div className="space-y-4 lg:space-y-6">
      <SalaryCard plan={plan} />

      <Card flush className="flex flex-wrap items-end justify-between gap-3 p-5">
        <div>
          <p className="text-sm font-medium text-muted">Left over each month</p>
          <p className={cn("mt-0.5 text-3xl font-bold tabular-nums sm:text-4xl", negative ? "text-negative" : "text-positive")}>{formatINR(plan.left_over)}</p>
        </div>
        <p className="text-sm text-muted">
          {!hasSalary
            ? "Add your salary to see what's left."
            : negative
              ? `You've planned ${formatINR(plan.left_over.replace("-", ""))} more than you earn.`
              : `${plan.left_over_percent}% of your salary isn't planned yet.`}
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard icon={Wallet} tint="blue" label="Needs" amount={amountOf("needs")} tileOnMobile />
        <StatCard icon={ShoppingBag} tint="indigo" label="Wants" amount={amountOf("wants")} tileOnMobile />
        <StatCard icon={PiggyBank} tint="cyan" label="Savings" amount={amountOf("savings")} tileOnMobile />
        <StatCard icon={TrendingUp} tint="sky" label="Investments" amount={amountOf("investments")} tileOnMobile />
      </div>

      {plan.items.length === 0 ? (
        <Card>
          <EmptyState
            title="Add where your money goes"
            description="Rent, groceries, SIPs, savings… each as a line. The charts appear as soon as you add one."
            action={
              <Button onClick={onAdd} icon={<Plus className="size-4" aria-hidden />}>
                Add a line
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
            <ChartCard title="Where the salary goes" subtitle={hasSalary ? "By group, as a share of your salary" : "By group"}>
              <CategoryDonut slices={byGroup.slices} total={byGroup.total} centerLabel={hasSalary && !negative ? "Salary" : "Planned"} />
            </ChartCard>
            <ChartCard title="Every line" subtitle="Each planned amount, coloured by its group">
              <CategoryDonut slices={byItem.slices} total={byItem.total} centerLabel="Planned" />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
            <Insights plan={plan} />
            <Card>
              <h3 className="text-lg font-semibold">Biggest lines</h3>
              <ol className="mt-3 space-y-2.5 text-sm">
                {plan.top_items.map((item, i) => (
                  <li key={item.id} className="flex items-center gap-3">
                    <span className="w-4 text-muted tabular-nums">{i + 1}</span>
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: groupInfo(item.group).color }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="tabular-nums">{formatINR(item.amount, { showDecimals: false })}</span>
                    {item.percent_of_salary && <span className="w-12 text-right text-muted tabular-nums">{item.percent_of_salary}%</span>}
                  </li>
                ))}
              </ol>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
            {GROUPS.map((g) => (
              <GroupList key={g.value} plan={plan} group={g.value} onEdit={onEdit} onDelete={onDelete} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SalaryCard({ plan }: { plan: Plan }) {
  const update = useUpdatePlan();
  const [salary, setSalary] = useState(toPaise(plan.salary) > 0n ? plan.salary.replace(/\.00$/, "") : "");
  const [notes, setNotes] = useState(plan.notes ?? "");
  const [error, setError] = useState<string>();
  const dirty = salaryInput(salary) !== plan.salary || (notes.trim() || null) !== plan.notes;

  const save = (e: FormEvent) => {
    e.preventDefault();
    const value = salaryInput(salary);
    if (value === null) return setError("Enter your monthly salary, e.g. 80000.");
    setError(undefined);
    update.mutate({ salary: value, notes: notes.trim() || null });
  };

  return (
    <Card>
      <form onSubmit={save} noValidate className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <TextField
            label="Monthly salary (take-home, ₹)"
            className="min-w-48 flex-1"
            inputMode="decimal"
            autoComplete="off"
            placeholder="80000"
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
            error={error ?? (update.isError ? update.error.message : undefined)}
          />
          <Button type="submit" loading={update.isPending} disabled={!dirty} variant={dirty ? "primary" : "secondary"}>
            {dirty ? "Save" : "Saved"}
          </Button>
        </div>
        <TextAreaField label="Notes (optional)" placeholder="e.g. bonus in March, rent goes up in June" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </form>
    </Card>
  );
}

function Insights({ plan }: { plan: Plan }) {
  return (
    <Card>
      <h3 className="text-lg font-semibold">50 / 30 / 20 check</h3>
      <p className="mt-0.5 text-sm text-muted">A common rule of thumb: needs ≤ 50%, wants ≤ 30%, save or invest ≥ 20% of your salary.</p>
      <ul className="mt-4 space-y-3 text-sm">
        {plan.rule_50_30_20.map((rule) => {
          const width = Math.min(Number(rule.actual ?? 0), 100);
          return (
            <li key={rule.label}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-medium">
                  {rule.ok === null ? null : rule.ok ? (
                    <CircleCheck className="size-4 text-positive" aria-label="On target" />
                  ) : (
                    <CircleAlert className="size-4 text-negative" aria-label="Off target" />
                  )}
                  {rule.label}
                </span>
                <span className="tabular-nums">
                  {rule.actual === null ? "—" : `${rule.actual}%`} <span className="text-muted">/ {rule.at_most ? "≤" : "≥"} {rule.target}%</span>
                </span>
              </div>
              <div className="relative mt-1.5 h-2 rounded-full bg-surface-muted" aria-hidden>
                <div className={cn("h-2 rounded-full", rule.ok === false ? "bg-negative" : "bg-primary")} style={{ width: `${width}%` }} />
                <div className="absolute top-[-3px] h-3.5 w-0.5 bg-ink/50" style={{ left: `${Number(rule.target)}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      {plan.saving_rate !== null && (
        <p className="mt-4 rounded-xl bg-surface-muted px-3.5 py-2.5 text-sm">
          You plan to save or invest <span className="font-semibold tabular-nums">{plan.saving_rate}%</span> of your salary.
        </p>
      )}
    </Card>
  );
}

function GroupList({ plan, group, onEdit, onDelete }: { plan: Plan; group: ItemValues["group"]; onEdit: (i: PlanItem) => void; onDelete: (i: PlanItem) => void }) {
  const info = groupInfo(group);
  const items = plan.items.filter((i) => i.group === group);
  const total = plan.groups.find((g) => g.group === group);
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <span className="size-3 rounded-full" style={{ background: info.color }} aria-hidden />
          {info.label}
        </h3>
        <span className="text-sm text-muted tabular-nums">
          {formatINR(total?.amount ?? "0", { showDecimals: false })}
          {total?.percent_of_salary ? ` · ${total.percent_of_salary}%` : ""}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing yet — {info.hint.toLowerCase()}.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
              <span className="text-sm font-semibold tabular-nums">{formatINR(item.amount, { showDecimals: false })}</span>
              {item.percent_of_salary && <span className="w-12 text-right text-xs text-muted tabular-nums">{item.percent_of_salary}%</span>}
              <IconButton label={`Edit ${item.name}`} icon={<Pencil className="size-4" aria-hidden />} onClick={() => onEdit(item)} />
              <IconButton label={`Delete ${item.name}`} icon={<Trash2 className="size-4" aria-hidden />} onClick={() => onDelete(item)} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ItemModal({ target, onClose }: { target: PlanItem | "new" | null; onClose: () => void }) {
  const formId = useId();
  const save = useSavePlanItem();
  const item = target === "new" ? null : target;
  const close = () => {
    save.reset();
    onClose();
  };
  return (
    <Modal
      open={target !== null}
      onClose={close}
      title={item ? "Edit line" : "Add a line"}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {item ? "Save" : "Add"}
          </Button>
        </>
      }
    >
      {target !== null && (
        <ItemForm
          key={item?.id ?? "new"}
          formId={formId}
          item={item}
          serverError={save.isError ? save.error.message : undefined}
          onSubmit={(input) => save.mutate({ id: item?.id, input }, { onSuccess: close })}
        />
      )}
    </Modal>
  );
}

function ItemForm({
  formId,
  item,
  serverError,
  onSubmit,
}: {
  formId: string;
  item: PlanItem | null;
  serverError?: string;
  onSubmit: (input: NonNullable<ReturnType<typeof validateItem>["input"]>) => void;
}) {
  const [values, setValues] = useState<ItemValues>(() => ({ name: item?.name ?? "", amount: item?.amount.replace(/\.00$/, "") ?? "", group: item?.group ?? "needs" }));
  const [errors, setErrors] = useState<ItemErrors>({});
  const set = <K extends keyof ItemValues>(key: K, value: ItemValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = validateItem(values);
    setErrors(result.errors);
    if (result.input) onSubmit(result.input);
  };

  return (
    <form id={formId} onSubmit={submit} noValidate className="space-y-4 pb-2">
      {serverError && <p className="text-sm font-medium text-negative">{serverError}</p>}
      <TextField label="What is it?" placeholder="Rent" data-autofocus maxLength={100} value={values.name} onChange={(e) => set("name", e.target.value)} error={errors.name} />
      <TextField label="Amount per month (₹)" placeholder="18000" inputMode="decimal" autoComplete="off" value={values.amount} onChange={(e) => set("amount", e.target.value)} error={errors.amount} />
      <div role="group" aria-label="Group">
        <p className="mb-2 text-sm font-medium">Group</p>
        <ChipRow>
          {GROUPS.map((g) => (
            <Chip key={g.value} selected={values.group === g.value} onClick={() => set("group", g.value)}>
              <span className="size-2.5 rounded-full" style={{ background: g.color }} aria-hidden />
              {g.label}
            </Chip>
          ))}
        </ChipRow>
        <p className="mt-1.5 text-xs text-muted">{groupInfo(values.group).hint}</p>
      </div>
    </form>
  );
}
