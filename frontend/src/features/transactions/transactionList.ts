/** Pure logic for the Transactions page: filters ↔ URL, date presets, grouping by day, row text. */

import type { Transaction, TransactionFilters, TransactionType } from "../../api/transactions";
import { shiftDate } from "../../lib/dates";
import { formatINR } from "../../lib/money";
import { istDate, TYPE_LABELS } from "./transactionForm";

// ---- Date presets ----------------------------------------------------------------------

export type DatePreset = "all" | "this_month" | "last_month" | "last_30" | "custom";

export const DATE_PRESETS: ReadonlyArray<{ value: DatePreset; label: string }> = [
  { value: "all", label: "All time" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "last_30", label: "Last 30 days" },
  { value: "custom", label: "Custom dates" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => new Date(`${s}T00:00:00Z`); // calendar maths in UTC: no DST/zone surprises

/** Inclusive from/to (YYYY-MM-DD) for a preset, relative to today (IST). */
export function presetRange(preset: DatePreset, today: string): { from?: string; to?: string } {
  const t = parse(today);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  switch (preset) {
    case "this_month":
      return { from: iso(new Date(Date.UTC(y, m, 1))), to: today };
    case "last_month":
      return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) }; // day 0 = last day of previous month
    case "last_30":
      return { from: shiftDate(today, -29), to: today };
    default:
      return {};
  }
}

// ---- Filters ↔ URL (?range=this_month&card_id=…) -------------------------------------------

export type ListFilters = {
  range: DatePreset;
  from: string; // custom range only
  to: string;
  source: string; // "account:<id>" | "card:<id>" | ""
  categoryId: string;
  personId: string;
  type: TransactionType | "";
  q: string;
};

const TYPES = Object.keys(TYPE_LABELS) as TransactionType[];

export function filtersFromParams(params: URLSearchParams): ListFilters {
  const range = params.get("range") as DatePreset | null;
  const type = params.get("type") as TransactionType | null;
  const account = params.get("account_id");
  const card = params.get("card_id");
  return {
    range: range && DATE_PRESETS.some((p) => p.value === range) ? range : "all",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    source: account ? `account:${account}` : card ? `card:${card}` : "",
    categoryId: params.get("category_id") ?? "",
    personId: params.get("person_id") ?? "",
    type: type && TYPES.includes(type) ? type : "",
    q: params.get("q") ?? "",
  };
}

/** Only non-default values go in the URL, so a clean list has a clean URL. */
export function paramsFromFilters(f: ListFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.range !== "all") params.set("range", f.range);
  if (f.range === "custom") {
    if (f.from) params.set("from", f.from);
    if (f.to) params.set("to", f.to);
  }
  const [kind, id] = f.source.split(":");
  if (id) params.set(kind === "card" ? "card_id" : "account_id", id);
  if (f.categoryId) params.set("category_id", f.categoryId);
  if (f.personId) params.set("person_id", f.personId);
  if (f.type) params.set("type", f.type);
  if (f.q.trim()) params.set("q", f.q.trim());
  return params;
}

/** What the API gets. */
export function apiFilters(f: ListFilters, today: string): TransactionFilters {
  const range = f.range === "custom" ? { from: f.from || undefined, to: f.to || undefined } : presetRange(f.range, today);
  const [kind, id] = f.source.split(":");
  return {
    ...range,
    ...(id ? (kind === "card" ? { card_id: id } : { account_id: id }) : {}),
    category_id: f.categoryId || undefined,
    person_id: f.personId || undefined,
    type: f.type || undefined,
    q: f.q.trim() || undefined,
  };
}

/** How many of the panel filters (not search / date) are set — for the "Filters (2)" badge. */
export function activeFilterCount(f: ListFilters): number {
  return [f.source, f.categoryId, f.personId, f.type].filter(Boolean).length;
}

// ---- Rows ------------------------------------------------------------------------------

const isPaired = (t: Transaction) => t.type === "transfer" || t.type === "card_payment";

/**
 * A transfer is stored as two rows (out of one account, into another). Unless you're looking
 * at one account or card, show only the "money out" half so each transfer appears once.
 */
export function visibleRows(items: Transaction[], filteredBySource: boolean): Transaction[] {
  return filteredBySource ? items : items.filter((t) => !(isPaired(t) && t.direction === "credit"));
}

export type DayGroup = { date: string; items: Transaction[] };

/** Consecutive rows on the same IST day → one group (the list is already newest first). */
export function groupByDay(items: Transaction[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const date = istDate(item.occurred_at);
    const last = groups.at(-1);
    if (last?.date === date) last.items.push(item);
    else groups.push({ date, items: [item] });
  }
  return groups;
}

const weekdayFormat = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const weekdayYearFormat = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "Today", "Yesterday", "Sat, 24 Oct", or with the year if it isn't this year. */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === shiftDate(today, -1)) return "Yesterday";
  return (date.slice(0, 4) === today.slice(0, 4) ? weekdayFormat : weekdayYearFormat).format(parse(date));
}

export type RowText = { title: string; subtitle: string; amount: string; tone: "in" | "out" | "neutral" };

/** Title, sub-line and signed amount text for a list row. */
export function rowText(t: Transaction, filteredBySource: boolean): RowText {
  const abs = t.amount.startsWith("-") ? t.amount.slice(1) : t.amount;
  const out = t.direction === "debit";

  if (isPaired(t)) {
    const other = t.counterpart?.name ?? "?";
    const route = out ? `${t.source.name} → ${other}` : `${other} → ${t.source.name}`;
    const fallback = t.type === "transfer" ? "Transfer" : "Card bill paid";
    return {
      title: t.description || fallback,
      subtitle: t.description ? `${TYPE_LABELS[t.type]} · ${route}` : route,
      // One account's view: it really is money in or out. The whole picture: just a move.
      amount: filteredBySource ? `${out ? "−" : "+"}${formatINR(abs)}` : formatINR(abs),
      tone: filteredBySource ? (out ? "out" : "in") : "neutral",
    };
  }

  const parts = [t.category?.name, t.source.name];
  if (t.type === "settlement") parts[0] = "Paid back";
  if (t.type === "adjustment") parts[0] = "Adjustment";
  if (t.person && t.type !== "settlement") parts.push(`from ${t.person.name}`);
  if (t.shares.length) parts.push(`split with ${t.shares.map((s) => s.person_name).join(", ")}`);
  if (t.type === "expense" && !out) parts.unshift("Refund");

  return {
    title: t.description || t.category?.name || (t.person && t.type === "settlement" ? `${t.person.name} paid back` : TYPE_LABELS[t.type]),
    subtitle: parts.filter(Boolean).join(" · "),
    amount: `${out ? "−" : "+"}${formatINR(abs)}`,
    tone: out ? "out" : "in",
  };
}
