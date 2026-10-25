import { ArrowLeft, Delete } from "lucide-react";
import { useId, useState, type FormEvent, type KeyboardEvent } from "react";

import { useAccounts } from "../../api/accounts";
import { useCards } from "../../api/cards";
import { useCategories } from "../../api/categories";
import { usePeople } from "../../api/people";
import { useCreateTransaction } from "../../api/transactions";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { cn } from "../../lib/cn";
import { shiftDate, todayIST } from "../../lib/dates";
import { formatINR } from "../../lib/money";
import { CategoryFormModal, type CategoryFormTarget } from "../categories/CategoryFormModal";
import { formatTypedAmount, keyFromKeyboard, pressKey, type KeypadKey } from "./keypad";
import { AccountChips, CardChips, CategoryGrid, Chip, ChipRow, PeopleChips, PickerGroup, SourceChips } from "./pickers";
import {
  emptyQuickAdd,
  quickAmount,
  splitShares,
  TYPE_LABELS,
  validateQuickAdd,
  type EntryType,
  type QuickAddErrors,
  type QuickAddValues,
} from "./transactionForm";

type Props = {
  /** null = closed; {} = open blank; otherwise open pre-filled. */
  prefill: Partial<QuickAddValues> | null;
  onClose: () => void;
  onSaved: (text: string, undoId: string) => void;
};

const ENTRY_TYPES: EntryType[] = ["expense", "income", "transfer", "card_payment"];

// Per-device convenience: start with whatever you paid with last time.
const LAST_SOURCE_KEY = "planner.quickAdd.lastSource";
function readLastSource(type: EntryType): string {
  try {
    return localStorage.getItem(`${LAST_SOURCE_KEY}.${type}`) ?? "";
  } catch {
    return "";
  }
}
function rememberSource(type: EntryType, value: string) {
  try {
    localStorage.setItem(`${LAST_SOURCE_KEY}.${type}`, value);
  } catch {
    // private mode / storage blocked: just don't remember
  }
}

export function QuickAddSheet({ prefill, onClose, onSaved }: Props) {
  const create = useCreateTransaction();
  const close = () => {
    create.reset();
    onClose();
  };

  return (
    <Modal open={prefill !== null} onClose={close} title="Add transaction">
      {prefill && (
        <QuickAddFlow
          prefill={prefill}
          saving={create.isPending}
          serverError={create.isError ? create.error.message : undefined}
          onSubmit={(input, summary, values) =>
            create.mutate(input, {
              onSuccess: (res) => {
                if (values.type === "expense" || values.type === "income") rememberSource(values.type, values.source);
                else rememberSource(values.type, values.fromAccount);
                onSaved(summary, res.items[0].id);
                close();
              },
            })
          }
        />
      )}
    </Modal>
  );
}

type FlowProps = {
  prefill: Partial<QuickAddValues>;
  saving: boolean;
  serverError?: string;
  onSubmit: (
    input: NonNullable<ReturnType<typeof validateQuickAdd>["input"]>,
    summary: string,
    values: QuickAddValues,
  ) => void;
};

/** Step 1: amount on the keypad. Step 2: where / what / who. Same sheet, no navigation. */
function QuickAddFlow({ prefill, saving, serverError, onSubmit }: FlowProps) {
  const formId = useId();
  const accounts = useAccounts();
  const cards = useCards();
  const categories = useCategories();
  const people = usePeople();
  const activeAccounts = (accounts.data?.items ?? []).filter((a) => !a.is_archived);
  const activeCards = (cards.data?.items ?? []).filter((c) => !c.is_archived);
  const activePeople = (people.data?.items ?? []).filter((p) => !p.is_archived);
  const allCategories = categories.data?.items ?? [];

  const [values, setValues] = useState<QuickAddValues>(() => ({ ...emptyQuickAdd(), ...prefill }));
  const [step, setStep] = useState<"amount" | "details">(prefill.amount ? "details" : "amount");
  const [errors, setErrors] = useState<QuickAddErrors>({});
  const [newCategory, setNewCategory] = useState<CategoryFormTarget>(null);

  const set = <K extends keyof QuickAddValues>(key: K, value: QuickAddValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key === "splitWith" || key === "splitMode" ? "split" : key]: undefined }));
  };

  // Defaults that depend on loaded data: last-used source, else the first card / account.
  const isAccountId = (id: string) => activeAccounts.some((a) => a.id === id);
  const isSource = (v: string) => {
    const [kind, id] = v.split(":");
    return kind === "card" ? activeCards.some((c) => c.id === id) : kind === "account" && isAccountId(id);
  };
  const remembered = readLastSource(values.type);
  const defaultSource =
    values.type === "expense" || values.type === "income"
      ? [remembered, values.type === "expense" && activeCards[0] ? `card:${activeCards[0].id}` : "", activeAccounts[0] ? `account:${activeAccounts[0].id}` : ""].find(
          (v) => v && isSource(v),
        ) ?? ""
      : "";
  const source = values.source || defaultSource;
  const fromAccount = values.fromAccount || [remembered, activeAccounts[0]?.id ?? ""].find((v) => v && isAccountId(v)) || "";
  const effective: QuickAddValues = { ...values, source, fromAccount };

  const amount = quickAmount(values.amount);
  const press = (key: KeypadKey) => set("amount", pressKey(values.amount, key));
  const next = () => {
    if (amount) setStep("details");
    else setErrors((e) => ({ ...e, amount: "Enter an amount." }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = validateQuickAdd(effective, todayIST());
    setErrors(result.errors);
    if (result.errors.amount) setStep("amount");
    if (!result.input) return;
    const category = allCategories.find((c) => c.id === values.categoryId);
    const what = category?.name ?? (values.description.trim() || TYPE_LABELS[values.type]);
    onSubmit(result.input, `Saved ${formatINR(result.input.amount)} · ${what}`, effective);
  };

  // ---- Step 1: amount ------------------------------------------------------------------
  if (step === "amount") {
    return (
      <div
        // Focused on open so a physical keyboard types straight into the amount (desktop).
        tabIndex={-1}
        data-autofocus
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === "Enter") {
            e.preventDefault();
            next();
            return;
          }
          const key = keyFromKeyboard(e.key);
          if (key && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            press(key);
          }
        }}
        className="space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))] outline-none"
      >
        <TypeSwitch value={values.type} onChange={(t) => set("type", t)} />

        <div className="py-2 text-center">
          <p className="sr-only" aria-live="polite">
            Amount {amount ? formatINR(amount) : "empty"}
          </p>
          <p
            aria-hidden
            className={cn(
              "truncate text-5xl font-bold tracking-tight tabular-nums",
              values.amount ? "text-ink" : "text-muted/60",
              values.amount.length > 9 && "text-4xl",
            )}
          >
            <span className="mr-1 text-3xl align-[0.35em] text-muted">₹</span>
            {formatTypedAmount(values.amount)}
          </p>
          {errors.amount && <p className="mt-1 text-xs font-medium text-negative">{errors.amount}</p>}
        </div>

        <Keypad onPress={press} />

        <Button size="lg" className="w-full" disabled={!amount} onClick={next}>
          Next
        </Button>
      </div>
    );
  }

  // ---- Step 2: details -----------------------------------------------------------------
  const loading = accounts.isPending || cards.isPending;
  const noSources = !loading && activeAccounts.length + activeCards.length === 0;
  const isSimple = values.type === "expense" || values.type === "income";
  const splitting = values.type === "expense" && !values.refund && values.splitWith.length > 0;
  const shares = splitting && amount ? splitShares(amount, values.splitWith, values.splitMode) : [];

  return (
    <>
      <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-5">
        <button
          type="button"
          onClick={() => setStep("amount")}
          className="flex w-full items-center gap-3 rounded-2xl bg-surface-muted px-4 py-3 text-left hover:bg-line"
        >
          <ArrowLeft className="size-4 text-muted" aria-hidden />
          <span className="flex-1">
            <span className="block text-xs font-medium text-muted">{values.refund ? "Refund" : TYPE_LABELS[values.type]}</span>
            <span className="text-2xl font-bold tabular-nums">{amount ? formatINR(amount) : "₹0"}</span>
          </span>
          <span className="text-xs font-semibold text-primary">Change</span>
        </button>

        {serverError && <Notice tone="error">{serverError}</Notice>}
        {noSources && <Notice tone="error">Add a bank account or card first — every entry needs one.</Notice>}

        {isSimple && (
          <>
            <PickerGroup label={values.type === "expense" ? (values.refund ? "Refunded to" : "Paid with") : "Received in"} error={errors.source}>
              <SourceChips
                accounts={activeAccounts}
                cards={activeCards}
                value={source}
                onChange={(v) => set("source", v)}
                cardsFirst={values.type === "expense"}
              />
            </PickerGroup>

            <PickerGroup label="Category">
              <CategoryGrid
                categories={allCategories}
                kind={values.type === "income" ? "income" : "expense"}
                value={values.categoryId}
                onChange={(id) => set("categoryId", id)}
                onNew={() => setNewCategory({ mode: "create", kind: values.type === "income" ? "income" : "expense" })}
              />
            </PickerGroup>
          </>
        )}

        {values.type === "expense" && (
          <>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-4.5 accent-primary"
                checked={values.refund}
                onChange={(e) => set("refund", e.target.checked)}
              />
              It's a refund or reversal (money came back)
            </label>

            {!values.refund && activePeople.length > 0 && (
              <PickerGroup label="Split with (optional)" error={errors.split}>
                <PeopleChips
                  people={activePeople}
                  selected={values.splitWith}
                  onToggle={(id) =>
                    set("splitWith", values.splitWith.includes(id) ? values.splitWith.filter((p) => p !== id) : [...values.splitWith, id])
                  }
                />
                {shares.length > 0 && (
                  <div role="radiogroup" aria-label="How to split" className="mt-2 inline-flex rounded-lg bg-surface-muted p-0.5 text-xs font-semibold">
                    {(["equal", "all"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={values.splitMode === mode}
                        onClick={() => set("splitMode", mode)}
                        className={cn("h-8 rounded-md px-3", values.splitMode === mode ? "bg-surface shadow-sm" : "text-muted")}
                      >
                        {mode === "equal" ? "Equally with me" : "They pay all"}
                      </button>
                    ))}
                  </div>
                )}
                {shares.length > 0 && (
                  <p className="mt-2 text-xs text-muted" aria-live="polite">
                    {shares.map((s) => `${activePeople.find((p) => p.id === s.person_id)?.name} owes ${formatINR(s.amount)}`).join(" · ")}
                  </p>
                )}
              </PickerGroup>
            )}
          </>
        )}

        {values.type === "income" && activePeople.length > 0 && (
          <PickerGroup label="From someone? (optional)">
            <PeopleChips
              people={activePeople}
              selected={values.personId ? [values.personId] : []}
              onToggle={(id) => set("personId", values.personId === id ? "" : id)}
            />
          </PickerGroup>
        )}

        {(values.type === "transfer" || values.type === "card_payment") && (
          <PickerGroup label="From account" error={errors.fromAccount}>
            <AccountChips accounts={activeAccounts} value={fromAccount} onChange={(id) => set("fromAccount", id)} />
          </PickerGroup>
        )}
        {values.type === "transfer" && (
          <PickerGroup label="To account" error={errors.toAccount}>
            <AccountChips accounts={activeAccounts} value={values.toAccount} onChange={(id) => set("toAccount", id)} exclude={fromAccount} />
          </PickerGroup>
        )}
        {values.type === "card_payment" && (
          <PickerGroup label="Card" error={errors.card}>
            {activeCards.length ? (
              <CardChips cards={activeCards} value={values.card} onChange={(id) => set("card", id)} />
            ) : (
              <p className="text-sm text-muted">No cards yet.</p>
            )}
          </PickerGroup>
        )}

        <DatePicker value={values.occurredOn} onChange={(d) => set("occurredOn", d)} error={errors.occurredOn} />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Note (optional)"
            placeholder={values.type === "expense" ? "Swiggy, petrol…" : ""}
            maxLength={255}
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
            error={errors.description}
          />
          <TextField
            label="Tags (optional)"
            placeholder="work, trip"
            autoCapitalize="none"
            value={values.tags}
            onChange={(e) => set("tags", e.target.value)}
            error={errors.tags}
          />
        </div>

        {/* Sticky so Save is always one tap away; -bottom-3/-mb-3 cancel the scroll area's bottom padding. */}
        <div className="sticky -bottom-3 -mx-5 -mb-3 border-t border-line bg-surface px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6">
          <Button type="submit" size="lg" className="w-full" loading={saving} disabled={noSources}>
            Save {amount ? formatINR(amount) : ""}
          </Button>
        </div>
      </form>

      <CategoryFormModal target={newCategory} onClose={() => setNewCategory(null)} onSaved={(c) => set("categoryId", c.id)} />
    </>
  );
}

function TypeSwitch({ value, onChange }: { value: EntryType; onChange: (t: EntryType) => void }) {
  return (
    <div role="radiogroup" aria-label="Type" className="grid grid-cols-4 gap-1 rounded-xl bg-surface-muted p-1">
      {ENTRY_TYPES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          onClick={() => onChange(t)}
          className={cn("h-9 rounded-lg text-xs font-semibold sm:text-sm", value === t ? "bg-surface text-ink shadow-sm" : "text-muted")}
        >
          {TYPE_LABELS[t]}
        </button>
      ))}
    </div>
  );
}

const KEYS: KeypadKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];

function Keypad({ onPress }: { onPress: (key: KeypadKey) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          // Keep focus on the wrapper so the physical keyboard keeps working after a tap.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPress(key)}
          aria-label={key === "back" ? "Delete last digit" : key === "." ? "Decimal point" : key}
          className="grid h-14 place-items-center rounded-2xl bg-surface-muted text-2xl font-semibold tabular-nums transition-colors select-none hover:bg-line active:scale-[0.97] active:bg-line"
        >
          {key === "back" ? <Delete className="size-6" aria-hidden /> : key}
        </button>
      ))}
    </div>
  );
}

function DatePicker({ value, onChange, error }: { value: string; onChange: (d: string) => void; error?: string }) {
  const today = todayIST();
  const yesterday = shiftDate(today, -1);
  return (
    <PickerGroup label="Date" error={error}>
      <ChipRow>
        <Chip selected={value === today} onClick={() => onChange(today)}>
          Today
        </Chip>
        <Chip selected={value === yesterday} onClick={() => onChange(yesterday)}>
          Yesterday
        </Chip>
        <label className="relative">
          <span className="sr-only">Pick a date</span>
          <input
            type="date"
            max={today}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
              "h-10 rounded-xl border bg-surface px-3 text-sm font-medium",
              value !== today && value !== yesterday ? "border-primary text-primary" : "border-line text-muted",
            )}
          />
        </label>
      </ChipRow>
    </PickerGroup>
  );
}
