import { Trash2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { useAccounts } from "../../api/accounts";
import { useCards } from "../../api/cards";
import { useCategories } from "../../api/categories";
import { useDeleteTransaction, useUpdateTransaction, type Transaction } from "../../api/transactions";
import { Button } from "../../components/ui/Button";
import { SelectField, TextField } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { formatDateTime, todayIST } from "../../lib/dates";
import { formatINR } from "../../lib/money";
import { buildUpdate, editableFields, initialEditValues, TYPE_LABELS, type EditErrors, type EditValues } from "./transactionForm";

type Props = { txn: Transaction | null; onClose: () => void; onDone: (message: string) => void };

/** View / edit / delete one transaction. Fields the kind doesn't allow to change are read-only. */
export function EditTransactionModal({ txn, onClose, onDone }: Props) {
  const formId = useId();
  const update = useUpdateTransaction();
  const remove = useDeleteTransaction();
  const [confirming, setConfirming] = useState(false);

  const close = () => {
    update.reset();
    remove.reset();
    setConfirming(false);
    onClose();
  };
  const paired = txn?.type === "transfer" || txn?.type === "card_payment";
  const error = update.isError ? update.error.message : remove.isError ? remove.error.message : undefined;

  return (
    <Modal
      open={txn !== null}
      onClose={close}
      title={txn ? `Edit ${TYPE_LABELS[txn.type].toLowerCase()}` : "Edit"}
      description={txn ? `Added ${formatDateTime(txn.created_at)}` : undefined}
      footer={
        confirming ? (
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                txn &&
                remove.mutate(txn.id, {
                  onSuccess: () => {
                    onDone("Deleted. Balances have been updated.");
                    close();
                  },
                })
              }
            >
              Yes, delete {paired ? "both sides" : ""}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" className="sm:mr-auto" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setConfirming(true)}>
              Delete
            </Button>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={update.isPending}>
              Save
            </Button>
          </>
        )
      }
    >
      {txn &&
        (confirming ? (
          <div className="space-y-3 pb-2 text-sm">
            {error && <Notice tone="error">{error}</Notice>}
            <p>
              Delete this {formatINR(txn.amount.replace("-", ""))} {TYPE_LABELS[txn.type].toLowerCase()}?
              {paired && " Both sides of it (out of one account, into the other) are removed."}
              {txn.shares.length > 0 && " The split goes with it — people will no longer owe you their share."}
              {txn.type === "settlement" && " The person will owe you this amount again."}
            </p>
            <p className="text-muted">This can't be undone.</p>
          </div>
        ) : (
          <EditForm
            key={txn.id}
            formId={formId}
            txn={txn}
            serverError={error}
            onSubmit={(input) => {
              if (Object.keys(input).length === 0) return close(); // nothing changed
              update.mutate(
                { id: txn.id, input },
                {
                  onSuccess: () => {
                    onDone("Saved.");
                    close();
                  },
                },
              );
            }}
          />
        ))}
    </Modal>
  );
}

function EditForm({
  formId,
  txn,
  serverError,
  onSubmit,
}: {
  formId: string;
  txn: Transaction;
  serverError?: string;
  onSubmit: (input: NonNullable<ReturnType<typeof buildUpdate>["input"]>) => void;
}) {
  const accounts = useAccounts();
  const cards = useCards();
  const categories = useCategories();
  const can = editableFields(txn.type);
  const [values, setValues] = useState<EditValues>(() => initialEditValues(txn));
  const [errors, setErrors] = useState<EditErrors>({});
  const set = (key: keyof EditValues, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = buildUpdate(txn, values, todayIST());
    setErrors(result.errors);
    if (result.input) onSubmit(result.input);
  };

  // Archived sources stay selectable only if this entry already uses them.
  const accountOptions = (accounts.data?.items ?? []).filter((a) => !a.is_archived || values.source === `account:${a.id}`);
  const cardOptions = (cards.data?.items ?? []).filter((c) => !c.is_archived || values.source === `card:${c.id}`);
  const categoryOptions = (categories.data?.items ?? []).filter((c) => !c.is_archived || c.id === values.categoryId);
  const locked = !can.amount;

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4 pb-2">
      {serverError && <Notice tone="error">{serverError}</Notice>}
      {locked && (
        <p className="rounded-xl bg-surface-muted px-3.5 py-2.5 text-sm text-muted">
          The amount and date of {txn.type === "settlement" ? "a repayment" : "an adjustment"} are fixed — delete it and record it again to change them.
        </p>
      )}
      {(txn.type === "transfer" || txn.type === "card_payment") && (
        <p className="rounded-xl bg-surface-muted px-3.5 py-2.5 text-sm text-muted">
          {txn.direction === "debit" ? `${txn.source.name} → ${txn.counterpart?.name}` : `${txn.counterpart?.name} → ${txn.source.name}`}. Changes apply to both sides.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Amount (₹)"
          inputMode="decimal"
          autoComplete="off"
          disabled={!can.amount}
          value={values.amount}
          onChange={(e) => set("amount", e.target.value)}
          error={errors.amount}
        />
        {can.direction ? (
          <SelectField label="Money" value={values.direction} onChange={(e) => set("direction", e.target.value)}>
            <option value="debit">{txn.type === "expense" ? "Spent (out)" : "Out (reversal)"}</option>
            <option value="credit">{txn.type === "expense" ? "Refunded (in)" : "Received (in)"}</option>
          </SelectField>
        ) : (
          <TextField label="Date" type="date" max={todayIST()} disabled={!can.date} value={values.occurredOn} onChange={(e) => set("occurredOn", e.target.value)} error={errors.occurredOn} />
        )}
      </div>

      {can.source && (
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Account / card" value={values.source} onChange={(e) => set("source", e.target.value)} error={errors.source}>
            {cardOptions.length > 0 && (
              <optgroup label="Cards">
                {cardOptions.map((c) => (
                  <option key={c.id} value={`card:${c.id}`}>
                    {c.card_name}
                    {c.last4 ? ` ••${c.last4}` : ""}
                  </option>
                ))}
              </optgroup>
            )}
            {accountOptions.length > 0 && (
              <optgroup label="Bank accounts">
                {accountOptions.map((a) => (
                  <option key={a.id} value={`account:${a.id}`}>
                    {a.bank_name} · {a.nickname}
                  </option>
                ))}
              </optgroup>
            )}
          </SelectField>
          <TextField label="Date" type="date" max={todayIST()} value={values.occurredOn} onChange={(e) => set("occurredOn", e.target.value)} error={errors.occurredOn} />
        </div>
      )}

      {can.category && (
        <SelectField label="Category" value={values.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
          <option value="">No category</option>
          {categoryOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Note" maxLength={255} value={values.description} onChange={(e) => set("description", e.target.value)} error={errors.description} />
        <TextField label="Tags" placeholder="work, trip" autoCapitalize="none" value={values.tags} onChange={(e) => set("tags", e.target.value)} error={errors.tags} />
      </div>

      {txn.shares.length > 0 && (
        <div className="rounded-xl border border-line px-3.5 py-3 text-sm">
          <p className="font-medium">Split</p>
          <ul className="mt-1 space-y-0.5 text-muted">
            {txn.shares.map((s) => (
              <li key={s.person_id} className="flex justify-between gap-3">
                <span>{s.person_name}</span>
                <span className="tabular-nums">{formatINR(s.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">The amount can't go below the shares. To change who owes what, delete and re-add it.</p>
        </div>
      )}
      {txn.person && txn.type !== "expense" && (
        <p className="text-sm text-muted">
          {txn.type === "settlement" ? "Paid back by" : "From"} <span className="font-medium text-ink">{txn.person.name}</span>
        </p>
      )}
    </form>
  );
}
