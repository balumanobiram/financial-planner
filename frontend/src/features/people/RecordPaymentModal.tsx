import { useId, useState, type FormEvent } from "react";

import { useAccounts } from "../../api/accounts";
import { useRecordPayment, type Person } from "../../api/people";
import { Button } from "../../components/ui/Button";
import { SelectField, TextField } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { cn } from "../../lib/cn";
import { todayIST } from "../../lib/dates";
import { formatINR, toPaise } from "../../lib/money";
import { validatePaymentForm, type PaymentFormValues, type PaymentKind } from "./peopleForms";

type Props = {
  person: Person | null;
  onClose: () => void;
  onDone: (message: string) => void;
};

/** "Record payment from person": either paying back what they owe, or a gift/income. */
export function RecordPaymentModal({ person, onClose, onDone }: Props) {
  const formId = useId();
  const record = useRecordPayment();

  const close = () => {
    record.reset();
    onClose();
  };

  return (
    <Modal
      open={person !== null}
      onClose={close}
      title={person ? `Payment from ${person.name}` : "Record payment"}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={record.isPending}>
            Record payment
          </Button>
        </>
      }
    >
      {person && (
        <PaymentForm
          formId={formId}
          person={person}
          serverError={record.isError ? record.error.message : undefined}
          onSubmit={(kind, input) =>
            record.mutate(
              { personId: person.id, kind, input },
              {
                onSuccess: () => {
                  onDone(
                    kind === "settlement"
                      ? `Recorded ${formatINR(input.amount)} paid back by ${person.name}.`
                      : `Recorded ${formatINR(input.amount)} from ${person.name}.`,
                  );
                  close();
                },
              },
            )
          }
        />
      )}
    </Modal>
  );
}

function PaymentForm({
  formId,
  person,
  serverError,
  onSubmit,
}: {
  formId: string;
  person: Person;
  serverError?: string;
  onSubmit: (kind: PaymentKind, input: NonNullable<ReturnType<typeof validatePaymentForm>["input"]>) => void;
}) {
  const accounts = useAccounts();
  const active = (accounts.data?.items ?? []).filter((a) => !a.is_archived);
  const outstanding = person.totals.outstanding;
  const owes = toPaise(outstanding) > 0n;

  const [values, setValues] = useState<PaymentFormValues>({
    kind: owes ? "settlement" : "income",
    account_id: "",
    amount: "",
    occurred_on: todayIST(),
    description: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof PaymentFormValues, string>>>({});
  const accountId = values.account_id || active[0]?.id || "";

  const set = <K extends keyof PaymentFormValues>(key: K, value: PaymentFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key] || key === "kind") setErrors((e) => ({ ...e, [key]: undefined, amount: undefined }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = validatePaymentForm({ ...values, account_id: accountId }, outstanding);
    setErrors(result.errors);
    if (result.input) onSubmit(values.kind, result.input);
  };

  if (!accounts.isPending && active.length === 0) {
    return <Notice tone="error">Add a bank account first — payments arrive into one of your accounts.</Notice>;
  }

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4 pb-2">
      {serverError && <Notice tone="error">{serverError}</Notice>}

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">What is this?</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: "settlement", title: "Paying back", hint: owes ? `They owe ${formatINR(outstanding)}` : "Nothing owed now" },
              { value: "income", title: "Gift / income", hint: "Doesn't change what they owe" },
            ] as const
          ).map((option) => {
            const selected = values.kind === option.value;
            return (
              <label
                key={option.value}
                className={cn(
                  "cursor-pointer rounded-xl border px-3.5 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary",
                  selected ? "border-primary bg-tint-blue" : "border-line hover:bg-surface-muted",
                )}
              >
                <input
                  type="radio"
                  name="kind"
                  value={option.value}
                  checked={selected}
                  onChange={() => set("kind", option.value)}
                  className="sr-only"
                />
                <span className="block text-sm font-semibold">{option.title}</span>
                <span className="block text-xs text-muted">{option.hint}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <TextField
        label="Amount (₹)"
        placeholder="0.00"
        inputMode="decimal"
        autoComplete="off"
        data-autofocus
        value={values.amount}
        onChange={(e) => set("amount", e.target.value)}
        error={errors.amount}
        trailing={
          values.kind === "settlement" && owes ? (
            <button
              type="button"
              onClick={() => set("amount", outstanding)}
              className="mr-1 rounded-lg bg-tint-blue px-2.5 py-1 text-xs font-semibold text-primary hover:brightness-95"
            >
              All {formatINR(outstanding, { showDecimals: false })}
            </button>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Into account" value={accountId} onChange={(e) => set("account_id", e.target.value)} error={errors.account_id}>
          {active.map((a) => (
            <option key={a.id} value={a.id}>
              {a.bank_name} · {a.nickname}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Date"
          type="date"
          max={todayIST()}
          value={values.occurred_on}
          onChange={(e) => set("occurred_on", e.target.value)}
          error={errors.occurred_on}
        />
      </div>

      <TextField
        label="Note"
        placeholder="Optional — e.g. UPI for dinner"
        value={values.description}
        onChange={(e) => set("description", e.target.value)}
        error={errors.description}
      />
    </form>
  );
}
