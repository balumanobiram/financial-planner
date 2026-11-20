import { Plus, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { useAccounts } from "../../api/accounts";
import { useCards } from "../../api/cards";
import { useCategories } from "../../api/categories";
import { useApproveSms, type SmsItem } from "../../api/inbox";
import { usePeople } from "../../api/people";
import { Button, IconButton } from "../../components/ui/Button";
import { SelectField, TextField } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { cn } from "../../lib/cn";
import { todayIST } from "../../lib/dates";
import { formatINR, toPaise } from "../../lib/money";
import { AccountChips, CardChips, CategoryGrid, Chip, ChipRow, PickerGroup, SourceChips } from "../transactions/pickers";
import { categorySplit, peopleSplit } from "../transactions/split";
import { SplitEditor } from "../transactions/SplitEditor";
import { APPROVE_LABELS, buildApprove, initialApproveValues, type ApproveAs, type ApproveErrors, type ApproveValues, type SplitMode } from "./inboxForm";

type Props = { sms: SmsItem | null; onClose: () => void; onDone: (message: string) => void };

/** Check / correct what the SMS says, choose how to split it, then approve. Nothing counts until then. */
export function ApproveModal({ sms, onClose, onDone }: Props) {
  const formId = useId();
  const approve = useApproveSms();
  const close = () => {
    approve.reset();
    onClose();
  };

  return (
    <Modal
      open={sms !== null}
      onClose={close}
      title="Approve SMS"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={approve.isPending}>
            Approve
          </Button>
        </>
      }
    >
      {sms && (
        <ApproveForm
          key={sms.id}
          formId={formId}
          sms={sms}
          serverError={approve.isError ? approve.error.message : undefined}
          onSubmit={(input) =>
            approve.mutate(
              { id: sms.id, input },
              {
                onSuccess: (res) => {
                  onDone(`Approved ${formatINR(input.amount)}${res.items.length > 1 && input.as === "expense" ? ` as ${res.items.length} entries` : ""}.`);
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

const SPLIT_LABELS: Record<SplitMode, string> = { mine: "100% mine", people: "With people", categories: "Across categories" };

function ApproveForm({
  formId,
  sms,
  serverError,
  onSubmit,
}: {
  formId: string;
  sms: SmsItem;
  serverError?: string;
  onSubmit: (input: NonNullable<ReturnType<typeof buildApprove>["input"]>) => void;
}) {
  const accounts = useAccounts();
  const cards = useCards();
  const categories = useCategories();
  const people = usePeople();
  const activeAccounts = (accounts.data?.items ?? []).filter((a) => !a.is_archived);
  const activeCards = (cards.data?.items ?? []).filter((c) => !c.is_archived);
  const activePeople = (people.data?.items ?? []).filter((p) => !p.is_archived);
  const allCategories = categories.data?.items ?? [];

  const [values, setValues] = useState<ApproveValues>(() => initialApproveValues(sms));
  const [errors, setErrors] = useState<ApproveErrors>({});
  const [tried, setTried] = useState(false);
  const set = <K extends keyof ApproveValues>(key: K, value: ApproveValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined, split: undefined }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    const result = buildApprove(values, todayIST());
    setErrors(result.errors);
    if (result.input) onSubmit(result.input);
  };

  const simple = values.as === "expense" || values.as === "income";
  const spending = values.as === "expense" && values.direction === "debit";
  const peopleResult = peopleSplit(values.amount, values.people, values.splitUnit);
  const partsResult = categorySplit(values.amount, values.parts);
  const owedBy = (id: string) => activePeople.find((p) => p.id === id)?.totals.outstanding;

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-5 pb-2">
      <p className="rounded-xl bg-surface-muted px-3.5 py-3 font-mono text-xs leading-relaxed break-words text-muted">{sms.text}</p>
      {sms.note && <Notice tone="error">{sms.note}</Notice>}
      {serverError && <Notice tone="error">{serverError}</Notice>}

      <PickerGroup label="What is it?">
        <ChipRow>
          {(Object.keys(APPROVE_LABELS) as ApproveAs[]).map((as) => (
            <Chip key={as} selected={values.as === as} onClick={() => set("as", as)}>
              {APPROVE_LABELS[as]}
            </Chip>
          ))}
        </ChipRow>
      </PickerGroup>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Amount (₹)" inputMode="decimal" autoComplete="off" value={values.amount} onChange={(e) => set("amount", e.target.value)} error={errors.amount} />
        <TextField label="Date" type="date" max={todayIST()} value={values.occurredOn} onChange={(e) => set("occurredOn", e.target.value)} error={errors.occurredOn} />
      </div>

      {simple && (
        <>
          <PickerGroup label={values.as === "expense" ? "Paid with" : "Received in"} error={errors.source}>
            <SourceChips accounts={activeAccounts} cards={activeCards} value={values.source} onChange={(v) => set("source", v)} cardsFirst={values.as === "expense"} />
          </PickerGroup>
          {values.as === "expense" && (
            <SelectField label="Money" value={values.direction} onChange={(e) => set("direction", e.target.value as ApproveValues["direction"])}>
              <option value="debit">Spent (out)</option>
              <option value="credit">Refunded (in)</option>
            </SelectField>
          )}
        </>
      )}

      {values.as === "card_payment" && (
        <>
          <PickerGroup label="Paid from" error={errors.fromAccountId}>
            <AccountChips accounts={activeAccounts} value={values.fromAccountId} onChange={(id) => set("fromAccountId", id)} />
          </PickerGroup>
          <PickerGroup label="Card" error={errors.cardId}>
            <CardChips cards={activeCards} value={values.cardId} onChange={(id) => set("cardId", id)} />
          </PickerGroup>
        </>
      )}

      {values.as === "transfer" && (
        <>
          <PickerGroup label="From" error={errors.fromAccountId}>
            <AccountChips accounts={activeAccounts} value={values.fromAccountId} onChange={(id) => set("fromAccountId", id)} />
          </PickerGroup>
          <PickerGroup label="To" error={errors.toAccountId}>
            <AccountChips accounts={activeAccounts} value={values.toAccountId} onChange={(id) => set("toAccountId", id)} exclude={values.fromAccountId} />
          </PickerGroup>
        </>
      )}

      {values.as === "repayment" && (
        <>
          <SelectField label="Who paid you back?" value={values.personId} onChange={(e) => set("personId", e.target.value)} error={errors.personId}>
            <option value="">Choose…</option>
            {activePeople.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {toPaise(p.totals.outstanding) > 0n ? ` — owes ${formatINR(p.totals.outstanding)}` : " — owes nothing"}
              </option>
            ))}
          </SelectField>
          {values.personId && owedBy(values.personId) && toPaise(owedBy(values.personId)!) <= 0n && (
            <p className="text-xs text-muted">They don't owe you anything right now. Record it as Income instead.</p>
          )}
          <PickerGroup label="Arrived in" error={errors.fromAccountId}>
            <AccountChips accounts={activeAccounts} value={values.fromAccountId} onChange={(id) => set("fromAccountId", id)} />
          </PickerGroup>
        </>
      )}

      {values.as === "expense" && (
        <PickerGroup label="Split">
          <ChipRow>
            {(Object.keys(SPLIT_LABELS) as SplitMode[])
              .filter((mode) => mode !== "people" || spending)
              .map((mode) => (
                <Chip key={mode} selected={values.split === mode} onClick={() => set("split", mode)}>
                  {SPLIT_LABELS[mode]}
                </Chip>
              ))}
          </ChipRow>
        </PickerGroup>
      )}

      {simple && !(values.as === "expense" && values.split === "categories") && (
        <PickerGroup label="Category (optional)">
          <CategoryGrid categories={allCategories} kind={values.as === "income" ? "income" : "expense"} value={values.categoryId} onChange={(id) => set("categoryId", id)} />
        </PickerGroup>
      )}

      {spending && values.split === "people" && (
        <SplitEditor
          total={values.amount}
          people={activePeople}
          rows={values.people}
          unit={values.splitUnit}
          result={peopleResult}
          showErrors={tried}
          onChange={(rows, unit) => setValues((v) => ({ ...v, people: rows, splitUnit: unit }))}
        />
      )}

      {values.as === "expense" && values.split === "categories" && (
        <fieldset className="space-y-2">
          <legend className="sr-only">Amounts per category</legend>
          {values.parts.map((part, i) => (
            <div key={i} className="flex items-start gap-2">
              <SelectField
                label={`Category ${i + 1}`}
                className="min-w-0 flex-1 [&_label]:sr-only"
                value={part.category_id}
                onChange={(e) => set("parts", values.parts.map((p, j) => (j === i ? { ...p, category_id: e.target.value } : p)))}
              >
                <option value="">No category</option>
                {allCategories
                  .filter((c) => !c.is_archived)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </SelectField>
              <TextField
                label={`Amount for category ${i + 1}`}
                className="w-28 [&_label]:sr-only"
                placeholder="₹"
                inputMode="decimal"
                autoComplete="off"
                value={part.amount}
                onChange={(e) => set("parts", values.parts.map((p, j) => (j === i ? { ...p, amount: e.target.value } : p)))}
              />
              <IconButton
                label={`Remove category ${i + 1}`}
                icon={<X className="size-4" aria-hidden />}
                className="mt-1"
                disabled={values.parts.length <= 2}
                onClick={() => set("parts", values.parts.filter((_, j) => j !== i))}
              />
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" aria-hidden />} disabled={values.parts.length >= 10} onClick={() => set("parts", [...values.parts, { category_id: "", amount: "" }])}>
            Add category
          </Button>
          {partsResult.remaining !== null && (
            <p className={cn("rounded-xl px-3.5 py-2.5 text-sm", toPaise(partsResult.remaining) === 0n ? "bg-surface-muted text-muted" : "bg-pill-duesoon text-pill-duesoon-fg")} aria-live="polite">
              {toPaise(partsResult.remaining) === 0n ? "Adds up to the total." : partsResult.error}
            </p>
          )}
        </fieldset>
      )}
      {errors.split && <p className="text-xs font-medium text-negative">{errors.split}</p>}

      {simple && (
        <SelectField
          label={values.as === "income" ? "From someone? (optional)" : "Paying someone back? (optional)"}
          value={values.personId}
          onChange={(e) => set("personId", e.target.value)}
        >
          <option value="">No</option>
          {activePeople.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
      )}

      <TextField label="Note" maxLength={255} value={values.description} onChange={(e) => set("description", e.target.value)} error={errors.description} />
    </form>
  );
}
