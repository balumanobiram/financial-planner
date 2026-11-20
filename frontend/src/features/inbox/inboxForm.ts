/** Inbox logic without React: pre-filling "approve" from a parsed SMS, validating it, and the banner rule. */

import type { ApproveInput, SmsItem } from "../../api/inbox";
import { todayIST } from "../../lib/dates";
import { normalizeMoneyInput, toPaise } from "../../lib/money";
import { parseSource, sourceValue } from "../transactions/transactionForm";
import { categorySplit, peopleSplit, type CategoryRow, type PersonRow, type SplitUnit } from "../transactions/split";

export type ApproveAs = ApproveInput["as"];
export type SplitMode = "mine" | "people" | "categories";

export const APPROVE_LABELS: Record<ApproveAs, string> = {
  expense: "Expense",
  income: "Income",
  card_payment: "Card bill",
  transfer: "Transfer",
  repayment: "Friend paid me back",
};

export type ApproveValues = {
  as: ApproveAs;
  amount: string;
  direction: "debit" | "credit";
  source: string; // "account:<id>" | "card:<id>"
  occurredOn: string;
  description: string;
  categoryId: string;
  split: SplitMode;
  splitUnit: SplitUnit;
  people: PersonRow[];
  parts: CategoryRow[];
  personId: string; // income from / expense paid back to / repayment by
  fromAccountId: string;
  toAccountId: string;
  cardId: string;
};

export type ApproveErrors = Partial<Record<"amount" | "source" | "occurredOn" | "description" | "personId" | "fromAccountId" | "toAccountId" | "cardId" | "split", string>>;

export const istDay = (iso: string) => todayIST(new Date(iso));

export function initialApproveValues(sms: SmsItem, today: string = todayIST()): ApproveValues {
  const as: ApproveAs =
    sms.suggested_kind === "card_payment" ? "card_payment" : sms.suggested_kind === "income" ? "income" : "expense";
  const onCard = sms.source?.kind === "card";
  return {
    as,
    amount: sms.amount ?? "",
    direction: sms.direction ?? (as === "income" ? "credit" : "debit"),
    source: sms.source ? sourceValue(sms.source) : "",
    occurredOn: sms.occurred_at ? istDay(sms.occurred_at) : today,
    description: sms.merchant ?? "",
    categoryId: sms.category?.id ?? "",
    split: "mine",
    splitUnit: "amount",
    people: [{ person_id: "", value: "" }],
    parts: [
      { category_id: sms.category?.id ?? "", amount: "" },
      { category_id: "", amount: "" },
    ],
    personId: "",
    // A card-bill SMS usually comes from either the bank side or the card side: pre-fill whichever we matched.
    fromAccountId: sms.source?.kind === "account" ? sms.source.id : "",
    toAccountId: "",
    cardId: onCard ? sms.source!.id : "",
  };
}

export function buildApprove(values: ApproveValues, today: string = todayIST()): { errors: ApproveErrors; input: ApproveInput | null } {
  const errors: ApproveErrors = {};
  const amount = normalizeMoneyInput(values.amount);
  if (amount === null || toPaise(amount) <= 0n) errors.amount = "Enter the amount, e.g. 450.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.occurredOn)) errors.occurredOn = "Pick a date.";
  else if (values.occurredOn > today) errors.occurredOn = "Can't be in the future.";
  const description = values.description.trim();
  if (description.length > 255) errors.description = "Keep it under 255 characters.";
  const common = { amount: amount ?? "", occurred_on: values.occurredOn, description: description || null };

  let input: ApproveInput | null = null;
  switch (values.as) {
    case "expense":
    case "income": {
      const source = parseSource(values.source);
      if (!source) errors.source = "Pick the account or card.";
      const base = { ...common, as: values.as, source: source!, direction: values.direction, person_id: values.personId || null };
      if (values.as === "expense" && values.direction === "debit" && values.split === "people") {
        const result = peopleSplit(values.amount, values.people, values.splitUnit);
        if (result.error || Object.keys(result.rowErrors).length) errors.split = result.error ?? "Fix the split above.";
        input = { ...base, category_id: values.categoryId || null, shares: result.shares };
      } else if (values.as === "expense" && values.split === "categories") {
        const result = categorySplit(values.amount, values.parts);
        if (result.error || Object.keys(result.rowErrors).length) errors.split = result.error ?? "Fix the amounts above.";
        input = { ...base, parts: result.parts };
      } else {
        input = { ...base, category_id: values.categoryId || null };
      }
      break;
    }
    case "card_payment":
      if (!values.fromAccountId) errors.fromAccountId = "Pick the bank account it was paid from.";
      if (!values.cardId) errors.cardId = "Pick the card.";
      input = { ...common, as: "card_payment", from_account_id: values.fromAccountId, card_id: values.cardId };
      break;
    case "transfer":
      if (!values.fromAccountId) errors.fromAccountId = "Pick where it came from.";
      if (!values.toAccountId) errors.toAccountId = "Pick where it went.";
      else if (values.toAccountId === values.fromAccountId) errors.toAccountId = "Pick a different account.";
      input = { ...common, as: "transfer", from_account_id: values.fromAccountId, to_account_id: values.toAccountId };
      break;
    case "repayment":
      if (!values.personId) errors.personId = "Who paid you back?";
      if (!values.fromAccountId) errors.fromAccountId = "Pick the account it arrived in.";
      input = { ...common, as: "repayment", person_id: values.personId, account_id: values.fromAccountId };
      break;
  }
  return { errors, input: Object.keys(errors).length ? null : input };
}

export const QUIET_DAYS = 3;

/** True when the Shortcut seems to have stopped: no SMS at all for 3 days (or never). */
export function inboxIsQuiet(lastReceivedAt: string | null, now: Date = new Date()): boolean {
  if (lastReceivedAt === null) return true;
  return now.getTime() - new Date(lastReceivedAt).getTime() > QUIET_DAYS * 24 * 60 * 60 * 1000;
}
