/** Pure logic for creating (Quick add) and editing transactions. */

import type { Direction, Transaction, TransactionCreate, TransactionType, TransactionUpdate } from "../../api/transactions";
import { todayIST } from "../../lib/dates";
import { fromPaise, normalizeMoneyInput, toPaise } from "../../lib/money";
import { splitEqually } from "../people/peopleForms";

export const TYPE_LABELS: Record<TransactionType, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
  card_payment: "Card bill",
  settlement: "Paid back",
  adjustment: "Adjustment",
};

// ---- Tags ------------------------------------------------------------------------------

/** "Work, #trip goa" → ["work", "trip", "goa"]: single words, lower-case, no duplicates. */
export function parseTags(text: string): string[] {
  const words = text
    .split(/[\s,#]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(words)];
}

function tagError(tags: string[]): string | undefined {
  if (tags.length > 10) return "Up to 10 tags.";
  if (tags.some((t) => t.length > 30)) return "Each tag must be under 30 characters.";
  return undefined;
}

function dateError(value: string, today: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Pick a date.";
  if (value > today) return "Can't be in the future.";
  return undefined;
}

/** "account:<id>" / "card:<id>" (one <select> value for two kinds of source) → API shape. */
export function parseSource(value: string): { account_id: string } | { card_id: string } | null {
  const [kind, id] = value.split(":");
  if (!id) return null;
  if (kind === "account") return { account_id: id };
  if (kind === "card") return { card_id: id };
  return null;
}

export const sourceValue = (ref: { kind: "account" | "card"; id: string }) => `${ref.kind}:${ref.id}`;

// ---- Quick add -------------------------------------------------------------------------

export type EntryType = "expense" | "income" | "transfer" | "card_payment";

/** "equal": everyone incl. you pays the same; "all": they cover the whole thing. */
export type SplitMode = "equal" | "all";

export type QuickAddValues = {
  type: EntryType;
  amount: string; // as typed on the keypad
  source: string; // expense / income: "account:<id>" | "card:<id>"
  fromAccount: string; // transfer / card bill
  toAccount: string; // transfer
  card: string; // card bill
  categoryId: string;
  personId: string; // income: who it came from
  refund: boolean; // expense credited back (refund / reversal)
  splitWith: string[]; // expense: people who owe you part of it
  splitMode: SplitMode;
  occurredOn: string;
  description: string;
  tags: string;
};

export type QuickAddErrors = Partial<
  Record<"amount" | "source" | "fromAccount" | "toAccount" | "card" | "occurredOn" | "description" | "tags" | "split", string>
>;

export function emptyQuickAdd(today: string = todayIST()): QuickAddValues {
  return {
    type: "expense",
    amount: "",
    source: "",
    fromAccount: "",
    toAccount: "",
    card: "",
    categoryId: "",
    personId: "",
    refund: false,
    splitWith: [],
    splitMode: "equal",
    occurredOn: today,
    description: "",
    tags: "",
  };
}

/** The keypad amount as a valid positive API amount, or null. */
export function quickAmount(typed: string): string | null {
  const amount = normalizeMoneyInput(typed);
  return amount !== null && toPaise(amount) > 0n ? amount : null;
}

/** Each split person's share, in the order of `splitWith`. */
export function splitShares(amount: string, people: string[], mode: SplitMode): Array<{ person_id: string; amount: string }> {
  if (people.length === 0) return [];
  const each = mode === "all" ? allOf(amount, people.length) : splitEqually(amount, people.length, true);
  return people.map((person_id, i) => ({ person_id, amount: each[i] }));
}

/** Divide all of `amount` among n people; leftover paise go to the first ones so it adds up exactly. */
function allOf(amount: string, n: number): string[] {
  const total = toPaise(amount);
  const base = total / BigInt(n);
  const extra = Number(total % BigInt(n));
  return Array.from({ length: n }, (_, i) => fromPaise(base + (i < extra ? 1n : 0n)));
}

export function validateQuickAdd(
  values: QuickAddValues,
  today: string = todayIST(),
): { errors: QuickAddErrors; input: TransactionCreate | null } {
  const errors: QuickAddErrors = {};
  const amount = quickAmount(values.amount);
  const tags = parseTags(values.tags);

  if (amount === null) errors.amount = "Enter an amount.";
  errors.occurredOn = dateError(values.occurredOn, today);
  if (values.description.length > 255) errors.description = "Keep it under 255 characters.";
  errors.tags = tagError(tags);

  const common = { occurred_on: values.occurredOn, description: values.description.trim() || null, tags };
  let input: TransactionCreate | null = null;

  if (values.type === "expense" || values.type === "income") {
    const source = parseSource(values.source);
    if (!source) errors.source = values.type === "expense" ? "Pick what you paid with." : "Pick where the money arrived.";
    const splitting = values.type === "expense" && !values.refund && values.splitWith.length > 0;
    if (amount && source) {
      input = {
        ...common,
        type: values.type,
        amount,
        source,
        category_id: values.categoryId || null,
        ...(values.type === "expense" && values.refund ? { direction: "credit" as const } : {}),
        ...(values.type === "income" && values.personId ? { person_id: values.personId } : {}),
        ...(splitting ? { shares: splitShares(amount, values.splitWith, values.splitMode) } : {}),
      };
    }
  } else if (values.type === "transfer") {
    if (!values.fromAccount) errors.fromAccount = "Pick the account it left.";
    if (!values.toAccount) errors.toAccount = "Pick the account it went to.";
    else if (values.toAccount === values.fromAccount) errors.toAccount = "Pick two different accounts.";
    if (amount) input = { ...common, type: "transfer", amount, from_account_id: values.fromAccount, to_account_id: values.toAccount };
  } else {
    if (!values.fromAccount) errors.fromAccount = "Pick the account you paid from.";
    if (!values.card) errors.card = "Pick the card you paid.";
    if (amount) input = { ...common, type: "card_payment", amount, from_account_id: values.fromAccount, card_id: values.card };
  }

  const clean = Object.fromEntries(Object.entries(errors).filter(([, v]) => v)) as QuickAddErrors;
  return { errors: clean, input: Object.keys(clean).length ? null : input };
}

// ---- Edit ------------------------------------------------------------------------------

/** What the backend lets you change for each kind (see services/transactions.update_transaction). */
export function editableFields(type: TransactionType) {
  const simple = type === "expense" || type === "income";
  const paired = type === "transfer" || type === "card_payment";
  return {
    amount: simple || paired,
    date: simple || paired,
    direction: simple,
    source: simple,
    category: simple,
    description: true,
    tags: true,
  };
}

export type EditValues = {
  amount: string;
  direction: Direction;
  source: string;
  categoryId: string;
  occurredOn: string;
  description: string;
  tags: string;
};

export type EditErrors = Partial<Record<keyof EditValues, string>>;

/** The IST calendar date of a UTC timestamp, as YYYY-MM-DD. */
export const istDate = (isoTimestamp: string) => todayIST(new Date(isoTimestamp));

export function initialEditValues(txn: Transaction): EditValues {
  const abs = txn.amount.startsWith("-") ? txn.amount.slice(1) : txn.amount;
  return {
    amount: abs,
    direction: txn.direction,
    source: sourceValue(txn.source),
    categoryId: txn.category?.id ?? "",
    occurredOn: istDate(txn.occurred_at),
    description: txn.description ?? "",
    tags: txn.tags.join(", "),
  };
}

/** Build a PATCH with only what changed (and only what this kind allows). */
export function buildUpdate(
  txn: Transaction,
  values: EditValues,
  today: string = todayIST(),
): { errors: EditErrors; input: TransactionUpdate | null } {
  const can = editableFields(txn.type);
  const before = initialEditValues(txn);
  const errors: EditErrors = {};
  const input: TransactionUpdate = {};

  if (can.amount) {
    const amount = quickAmount(values.amount);
    if (amount === null) errors.amount = "Enter an amount like 450 or 450.50.";
    else if (amount !== normalizeMoneyInput(before.amount)) input.amount = amount;
  }
  if (can.direction && values.direction !== before.direction) input.direction = values.direction;
  if (can.source && values.source !== before.source) {
    const source = parseSource(values.source);
    if (!source) errors.source = "Pick an account or card.";
    else input.source = source;
  }
  if (can.category && values.categoryId !== before.categoryId) input.category_id = values.categoryId || null;
  if (can.date && values.occurredOn !== before.occurredOn) {
    errors.occurredOn = dateError(values.occurredOn, today);
    input.occurred_on = values.occurredOn;
  }
  const description = values.description.trim();
  if (description.length > 255) errors.description = "Keep it under 255 characters.";
  else if (description !== before.description) input.description = description || null;
  const tags = parseTags(values.tags);
  errors.tags = tagError(tags);
  if (tags.join(",") !== txn.tags.join(",")) input.tags = tags;

  const clean = Object.fromEntries(Object.entries(errors).filter(([, v]) => v)) as EditErrors;
  return { errors: clean, input: Object.keys(clean).length ? null : input };
}
