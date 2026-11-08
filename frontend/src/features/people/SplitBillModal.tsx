import { Plus, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { useAccounts } from "../../api/accounts";
import { useCards } from "../../api/cards";
import { useCreateSharedExpense, usePeople } from "../../api/people";
import { Button, IconButton } from "../../components/ui/Button";
import { SelectField, TextField } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { cn } from "../../lib/cn";
import { todayIST } from "../../lib/dates";
import { formatINR, normalizeMoneyInput, toPaise } from "../../lib/money";
import { splitEqually, validateSplitForm, yourShare, type SplitFormErrors, type SplitFormValues } from "./peopleForms";

type Props = {
  open: boolean;
  /** Pre-select this person when opened from their page. */
  personId?: string;
  onClose: () => void;
  onDone: (message: string) => void;
};

/** Record a card or bank spend and who owes you how much of it. */
export function SplitBillModal({ open, personId, onClose, onDone }: Props) {
  const formId = useId();
  const create = useCreateSharedExpense();

  const close = () => {
    create.reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Split a bill"
      description="Something you paid for that others owe you part (or all) of."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={create.isPending}>
            Save split
          </Button>
        </>
      }
    >
      <SplitForm
        formId={formId}
        personId={personId}
        serverError={create.isError ? create.error.message : undefined}
        onSubmit={(input) =>
          create.mutate(input, {
            onSuccess: () => {
              const n = input.shares.length;
              onDone(`Split ${formatINR(input.amount)} with ${n} ${n === 1 ? "person" : "people"}.`);
              close();
            },
          })
        }
      />
    </Modal>
  );
}

function SplitForm({
  formId,
  personId,
  serverError,
  onSubmit,
}: {
  formId: string;
  personId?: string;
  serverError?: string;
  onSubmit: (input: NonNullable<ReturnType<typeof validateSplitForm>["input"]>) => void;
}) {
  const accounts = useAccounts();
  const cards = useCards();
  const people = usePeople();
  const activeAccounts = (accounts.data?.items ?? []).filter((a) => !a.is_archived);
  const activeCards = (cards.data?.items ?? []).filter((c) => !c.is_archived);
  const activePeople = (people.data?.items ?? []).filter((p) => !p.is_archived);
  const defaultSource = activeCards[0] ? `card:${activeCards[0].id}` : activeAccounts[0] ? `account:${activeAccounts[0].id}` : "";

  const [values, setValues] = useState<SplitFormValues>({
    source: "",
    amount: "",
    occurred_on: todayIST(),
    description: "",
    rows: [{ person_id: personId ?? "", amount: "" }],
  });
  const [errors, setErrors] = useState<SplitFormErrors>({});
  const source = values.source || defaultSource;

  const setField = (key: Exclude<keyof SplitFormValues, "rows">, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const setRows = (rows: SplitFormValues["rows"]) => {
    setValues((v) => ({ ...v, rows }));
    setErrors((e) => ({ ...e, rows: undefined, rowErrors: undefined }));
  };

  const total = normalizeMoneyInput(values.amount);
  const canSplit = total !== null && toPaise(total) > 0n && values.rows.length > 0;
  const applySplit = (includeMe: boolean) => {
    if (!canSplit || total === null) return;
    const amounts = splitEqually(total, values.rows.length, includeMe);
    setRows(values.rows.map((row, i) => ({ ...row, amount: amounts[i] })));
  };
  const mine = yourShare(values.amount, values.rows);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = validateSplitForm({ ...values, source });
    setErrors(result.errors);
    if (result.input) onSubmit(result.input);
  };

  const loading = accounts.isPending || cards.isPending || people.isPending;
  if (!loading && activeAccounts.length + activeCards.length === 0) {
    return <Notice tone="error">Add a card or bank account first — that's what you paid with.</Notice>;
  }
  if (!loading && activePeople.length === 0) {
    return <Notice tone="error">Add a person first — then you can split bills with them.</Notice>;
  }

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4 pb-2">
      {serverError && <Notice tone="error">{serverError}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Total you spent (₹)"
          placeholder="1800"
          inputMode="decimal"
          autoComplete="off"
          data-autofocus
          value={values.amount}
          onChange={(e) => setField("amount", e.target.value)}
          error={errors.amount}
        />
        <SelectField label="Paid with" value={source} onChange={(e) => setField("source", e.target.value)} error={errors.source}>
          {activeCards.length > 0 && (
            <optgroup label="Cards">
              {activeCards.map((c) => (
                <option key={c.id} value={`card:${c.id}`}>
                  {c.bank_name} · {c.card_name}
                  {c.last4 ? ` ••${c.last4}` : ""}
                </option>
              ))}
            </optgroup>
          )}
          {activeAccounts.length > 0 && (
            <optgroup label="Bank accounts">
              {activeAccounts.map((a) => (
                <option key={a.id} value={`account:${a.id}`}>
                  {a.bank_name} · {a.nickname}
                </option>
              ))}
            </optgroup>
          )}
        </SelectField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="What was it?"
          placeholder="Dinner at Toit"
          value={values.description}
          onChange={(e) => setField("description", e.target.value)}
          error={errors.description}
        />
        <TextField
          label="Date"
          type="date"
          max={todayIST()}
          value={values.occurred_on}
          onChange={(e) => setField("occurred_on", e.target.value)}
          error={errors.occurred_on}
        />
      </div>

      <fieldset className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <legend className="text-sm font-medium">Who owes you</legend>
          <div className="flex gap-1.5">
            <Button size="sm" variant="secondary" disabled={!canSplit} onClick={() => applySplit(true)}>
              Split equally with me
            </Button>
            <Button size="sm" variant="secondary" disabled={!canSplit} onClick={() => applySplit(false)}>
              They pay all
            </Button>
          </div>
        </div>

        {values.rows.map((row, i) => {
          const rowError = errors.rowErrors?.[i];
          return (
            <div key={i}>
              <div className="flex items-start gap-2">
                <SelectField
                  label={`Person ${i + 1}`}
                  className="min-w-0 flex-1 [&_label]:sr-only"
                  value={row.person_id}
                  onChange={(e) => setRows(values.rows.map((r, j) => (j === i ? { ...r, person_id: e.target.value } : r)))}
                >
                  <option value="">Choose…</option>
                  {activePeople.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.relation ? ` (${p.relation})` : ""}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  label={`Share for person ${i + 1} (₹)`}
                  className="w-32 [&_label]:sr-only"
                  placeholder="₹ share"
                  inputMode="decimal"
                  autoComplete="off"
                  value={row.amount}
                  onChange={(e) => setRows(values.rows.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))}
                />
                <IconButton
                  label={`Remove person ${i + 1}`}
                  icon={<X className="size-4" aria-hidden />}
                  className="mt-1"
                  disabled={values.rows.length === 1}
                  onClick={() => setRows(values.rows.filter((_, j) => j !== i))}
                />
              </div>
              {rowError && <p className="mt-1 text-xs font-medium text-negative">{rowError}</p>}
            </div>
          );
        })}

        <Button
          size="sm"
          variant="ghost"
          icon={<Plus className="size-3.5" aria-hidden />}
          disabled={values.rows.length >= Math.min(20, activePeople.length)}
          onClick={() => setRows([...values.rows, { person_id: "", amount: "" }])}
        >
          Add person
        </Button>

        {errors.rows && <p className="text-xs font-medium text-negative">{errors.rows}</p>}
        {mine !== null && (
          <p
            className={cn("rounded-xl px-3.5 py-2.5 text-sm", toPaise(mine) < 0n ? "bg-pill-overdue text-pill-overdue-fg" : "bg-surface-muted text-muted")}
            aria-live="polite"
          >
            Your share: <span className="font-semibold text-ink tabular-nums">{formatINR(mine)}</span>
          </p>
        )}
      </fieldset>
    </form>
  );
}
