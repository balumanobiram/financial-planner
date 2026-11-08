/** Card form state, validation and due-date status. Pure functions — unit tested. */

import type { CardNetwork, CreditCard, CreditCardInput } from "../../api/cards";
import { isHexColor } from "../../lib/color";
import { looksLikeDomain } from "../../lib/domain";
import { normalizeMoneyInput, toPaise } from "../../lib/money";

/** Common physical-card finishes. Text colour on each is computed (see lib/color). */
export const CARD_COLOR_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "#1a1a2e", label: "Black" },
  { value: "#0c2547", label: "Navy" },
  { value: "#1f4fd1", label: "Royal blue" },
  { value: "#0e7490", label: "Teal" },
  { value: "#14532d", label: "Emerald" },
  { value: "#4b2a7b", label: "Purple" },
  { value: "#6d1a36", label: "Burgundy" },
  { value: "#b76e79", label: "Rose gold" },
  { value: "#d4af37", label: "Gold" },
  { value: "#c0c6d0", label: "Silver" },
];

export const DUE_SOON_DAYS = 5;

export type CardFormValues = {
  bank_name: string;
  card_name: string;
  network: CardNetwork;
  last4: string;
  credit_limit: string;
  statement_day: string;
  payment_due_days: string;
  color: string;
  bank_domain: string;
  notes: string;
};

export type CardFormErrors = Partial<Record<keyof CardFormValues, string>>;

export function initialCardValues(card?: CreditCard): CardFormValues {
  return {
    bank_name: card?.bank_name ?? "",
    card_name: card?.card_name ?? "",
    network: card?.network ?? "visa",
    last4: card?.last4 ?? "",
    credit_limit: card?.credit_limit ?? "",
    statement_day: String(card?.statement_day ?? 1),
    payment_due_days: String(card?.payment_due_days ?? 20),
    color: card?.color ?? CARD_COLOR_PRESETS[0].value,
    bank_domain: card?.bank_domain ?? "",
    notes: card?.notes ?? "",
  };
}


function wholeNumber(raw: string): number | null {
  return /^\d{1,3}$/.test(raw.trim()) ? Number(raw.trim()) : null;
}

export function validateCardForm(
  values: CardFormValues,
): { errors: CardFormErrors; input: null } | { errors: Record<string, never>; input: CreditCardInput } {
  const errors: CardFormErrors = {};
  const bankName = values.bank_name.trim();
  const cardName = values.card_name.trim();
  const last4 = values.last4.trim();
  const statementDay = wholeNumber(values.statement_day);
  const dueDays = wholeNumber(values.payment_due_days);
  const limitRaw = values.credit_limit.trim();
  const limit = limitRaw === "" ? null : normalizeMoneyInput(limitRaw);
  const domain = values.bank_domain.trim();

  if (!bankName) errors.bank_name = "Enter the bank name.";
  else if (bankName.length > 100) errors.bank_name = "Keep it under 100 characters.";

  if (!cardName) errors.card_name = "Enter the card's name, e.g. Regalia Gold.";
  else if (cardName.length > 100) errors.card_name = "Keep it under 100 characters.";

  if (last4 && !/^\d{4}$/.test(last4)) errors.last4 = "Enter exactly 4 digits, or leave empty.";

  if (statementDay === null || statementDay < 1 || statementDay > 31) errors.statement_day = "Pick a day from 1 to 31.";

  if (dueDays === null || dueDays < 1 || dueDays > 60) errors.payment_due_days = "Enter 1–60 days (usually 15–20).";

  if (limitRaw !== "" && (limit === null || toPaise(limit) <= 0n)) errors.credit_limit = "Enter a positive amount, or leave empty.";

  if (!isHexColor(values.color)) errors.color = "Pick a colour.";

  if (domain && !looksLikeDomain(domain)) errors.bank_domain = "Enter a website like hdfcbank.com, or leave empty.";

  if (values.notes.length > 2000) errors.notes = "Keep notes under 2000 characters.";

  if (Object.keys(errors).length > 0 || statementDay === null || dueDays === null) return { errors, input: null };

  return {
    errors: {},
    input: {
      bank_name: bankName,
      card_name: cardName,
      network: values.network,
      last4: last4 || null,
      credit_limit: limit,
      statement_day: statementDay,
      payment_due_days: dueDays,
      color: values.color.toLowerCase(),
      bank_domain: domain || null,
      notes: values.notes.trim() || null,
    },
  };
}

export type DueStatus = { label: string; pill: "overdue" | "duesoon" | null };

/** How urgent the pay-by date is. The backend never returns a past date (it rolls to the next cycle). */
export function dueStatus(daysUntil: number): DueStatus {
  if (daysUntil <= 0) return { label: "Due today", pill: "overdue" };
  if (daysUntil === 1) return { label: "Due tomorrow", pill: "duesoon" };
  if (daysUntil <= DUE_SOON_DAYS) return { label: `Due in ${daysUntil} days`, pill: "duesoon" };
  return { label: `in ${daysUntil} days`, pill: null };
}

/** "12" → "12th", "1" → "1st". */
export function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${{ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th"}`;
}
