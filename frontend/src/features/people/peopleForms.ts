/** Pure logic for the People screens: balance chips, payment and split validation, equal splits. */

import type { PaymentInput, PersonInput, SharedExpenseInput } from "../../api/people";
import { todayIST } from "../../lib/dates";
import { formatINR, fromPaise, normalizeMoneyInput, toPaise } from "../../lib/money";

// ---- Balance chip ------------------------------------------------------------------

export type BalanceChip = { label: string; tone: "owes" | "settled" | "credit" };

export function balanceChip(outstanding: string): BalanceChip {
  const paise = toPaise(outstanding);
  if (paise > 0n) return { label: `Owes you ${formatINR(outstanding)}`, tone: "owes" };
  if (paise < 0n) return { label: `You owe ${formatINR(fromPaise(-paise))}`, tone: "credit" };
  return { label: "Settled up", tone: "settled" };
}

// ---- Person form ---------------------------------------------------------------------

export const RELATION_SUGGESTIONS = ["Dad", "Mom", "Brother", "Sister", "Spouse", "Friend", "Roommate", "Colleague"];

export type PersonFormValues = { name: string; relation: string; notes: string };
type Errors<T> = Partial<Record<keyof T, string>>;

export function validatePersonForm(values: PersonFormValues): { errors: Errors<PersonFormValues>; input: PersonInput | null } {
  const errors: Errors<PersonFormValues> = {};
  const name = values.name.trim();
  const relation = values.relation.trim();
  if (!name) errors.name = "Enter their name.";
  else if (name.length > 100) errors.name = "Keep it under 100 characters.";
  if (relation.length > 50) errors.relation = "Keep it under 50 characters.";
  if (values.notes.length > 2000) errors.notes = "Keep notes under 2000 characters.";
  if (Object.keys(errors).length) return { errors, input: null };
  return { errors, input: { name, relation: relation || null, notes: values.notes.trim() || null } };
}

// ---- Record payment -----------------------------------------------------------------

export type PaymentKind = "settlement" | "income";

export type PaymentFormValues = {
  kind: PaymentKind;
  account_id: string;
  amount: string;
  occurred_on: string;
  description: string;
};

export function validatePaymentForm(
  values: PaymentFormValues,
  outstanding: string,
  today: string = todayIST(),
): { errors: Errors<PaymentFormValues>; input: PaymentInput | null } {
  const errors: Errors<PaymentFormValues> = {};
  const amount = normalizeMoneyInput(values.amount);

  if (!values.account_id) errors.account_id = "Pick the account the money arrived in.";
  if (amount === null || toPaise(amount) <= 0n) errors.amount = "Enter an amount like 500 or 500.50.";
  else if (values.kind === "settlement") {
    const owed = toPaise(outstanding);
    if (owed <= 0n) errors.amount = "They don't owe you anything — record it as a gift instead.";
    else if (toPaise(amount) > owed) errors.amount = `They only owe ${formatINR(outstanding)}. Record anything extra as a gift.`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.occurred_on)) errors.occurred_on = "Pick a date.";
  else if (values.occurred_on > today) errors.occurred_on = "Can't be in the future.";
  if (values.description.length > 255) errors.description = "Keep it under 255 characters.";

  if (Object.keys(errors).length || amount === null) return { errors, input: null };
  return {
    errors,
    input: { account_id: values.account_id, amount, occurred_on: values.occurred_on, description: values.description.trim() || null },
  };
}

// ---- Split a bill -------------------------------------------------------------------

export type SplitRow = { person_id: string; amount: string };

export type SplitFormValues = {
  /** "account:<id>" or "card:<id>" */
  source: string;
  amount: string;
  occurred_on: string;
  description: string;
  rows: SplitRow[];
};

export type SplitFormErrors = Partial<Record<"source" | "amount" | "occurred_on" | "description" | "rows", string>> & {
  rowErrors?: Record<number, string>;
};

/**
 * Divide `total` equally between `people` others and (optionally) you, in exact paise.
 * Any leftover paisa stays with you, so the shares never add up to more than you spent.
 */
export function splitEqually(total: string, people: number, includeMe: boolean): string[] {
  if (people < 1) return [];
  const parts = BigInt(people + (includeMe ? 1 : 0));
  const each = toPaise(total) / parts; // BigInt division floors
  return Array.from({ length: people }, () => fromPaise(each));
}

/** What's left for you after everyone else's shares, or null if the inputs aren't valid amounts yet. */
export function yourShare(total: string, rows: SplitRow[]): string | null {
  const t = normalizeMoneyInput(total);
  if (t === null) return null;
  let sum = 0n;
  for (const row of rows) {
    const a = normalizeMoneyInput(row.amount);
    if (a === null) return null;
    sum += toPaise(a);
  }
  return fromPaise(toPaise(t) - sum);
}

export function validateSplitForm(
  values: SplitFormValues,
  today: string = todayIST(),
): { errors: SplitFormErrors; input: SharedExpenseInput | null } {
  const errors: SplitFormErrors = {};
  const rowErrors: Record<number, string> = {};
  const total = normalizeMoneyInput(values.amount);
  const [sourceKind, sourceId] = values.source.split(":");

  if (!sourceId || (sourceKind !== "account" && sourceKind !== "card")) errors.source = "Pick the card or account you paid with.";
  if (total === null || toPaise(total) <= 0n) errors.amount = "Enter what you spent, e.g. 1800.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.occurred_on)) errors.occurred_on = "Pick a date.";
  else if (values.occurred_on > today) errors.occurred_on = "Can't be in the future.";
  if (values.description.length > 255) errors.description = "Keep it under 255 characters.";

  const shares: Array<{ person_id: string; amount: string }> = [];
  const seen = new Set<string>();
  values.rows.forEach((row, i) => {
    const amount = normalizeMoneyInput(row.amount);
    if (!row.person_id) rowErrors[i] = "Pick a person.";
    else if (seen.has(row.person_id)) rowErrors[i] = "This person is already in the split.";
    else if (amount === null || toPaise(amount) <= 0n) rowErrors[i] = "Enter their share.";
    else shares.push({ person_id: row.person_id, amount });
    if (row.person_id) seen.add(row.person_id);
  });
  if (values.rows.length === 0) errors.rows = "Add at least one person.";
  if (Object.keys(rowErrors).length) errors.rowErrors = rowErrors;

  if (total !== null && !errors.rowErrors && shares.length) {
    const sum = shares.reduce((acc, s) => acc + toPaise(s.amount), 0n);
    if (sum > toPaise(total)) errors.rows = `Shares add up to ${formatINR(fromPaise(sum))} — more than the ${formatINR(total)} spent.`;
  }

  if (Object.keys(errors).length || total === null) return { errors, input: null };
  return {
    errors,
    input: {
      ...(sourceKind === "account" ? { account_id: sourceId } : { card_id: sourceId }),
      amount: total,
      occurred_on: values.occurred_on,
      description: values.description.trim() || null,
      shares,
    },
  };
}
