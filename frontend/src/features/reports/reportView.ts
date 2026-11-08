/** Pure logic for the Reports page: URL ↔ query, defaults, pickers, labels. */

import type { ReportQuery, StatementStatus } from "../../api/reports";
import type { Status } from "../../components/ui/StatusPill";
import { shiftDate } from "../../lib/dates";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The month before today's, as YYYY-MM (the most useful default: a finished month). */
export function lastMonth(today: string): string {
  return shiftDate(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
}

// ---- Month ranges and financial years ------------------------------------------------------------

const MAX_MONTHS = 24; // same limit as the server

/** Months from a to b inclusive ("2026-04", "2026-09" → 6); 0 or less if b is before a. */
export function monthsBetween(a: string, b: string): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)) + 1;
}

/** "2026-10" moved by n months. */
export function shiftMonth(month: string, n: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Default month range: the last 6 finished months. */
export function defaultMonthRange(today: string): { from: string; to: string } {
  const to = lastMonth(today);
  return { from: shiftMonth(to, -5), to };
}

/**
 * After changing one end of a month range, nudge the other so it stays valid (start ≤ end, ≤ 24 months)
 * instead of showing an error — two dropdowns can't otherwise be changed "at once".
 */
export function adjustMonthRange(from: string, to: string, changed: "from" | "to"): { from: string; to: string } {
  if (changed === "from") {
    if (to < from) return { from, to: from };
    if (monthsBetween(from, to) > MAX_MONTHS) return { from, to: shiftMonth(from, MAX_MONTHS - 1) };
  } else {
    if (from > to) return { from: to, to };
    if (monthsBetween(from, to) > MAX_MONTHS) return { from: shiftMonth(to, -(MAX_MONTHS - 1)), to };
  }
  return { from, to };
}

/** Indian financial year (April–March) containing `today`, by its starting year. */
export function currentFinancialYear(today: string): string {
  const year = Number(today.slice(0, 4));
  return String(Number(today.slice(5, 7)) >= 4 ? year : year - 1);
}

/** "2025" → "FY 2025–26". */
export const fyLabel = (startYear: string) => `FY ${startYear}–${String((Number(startYear) + 1) % 100).padStart(2, "0")}`;

export function fyOptions(today: string, count = 6): Array<{ value: string; label: string }> {
  const current = Number(currentFinancialYear(today));
  return Array.from({ length: count }, (_, i) => {
    const value = String(current - i);
    return { value, label: `${fyLabel(value)}${i === 0 ? " (so far)" : ""}` };
  });
}

/** ?view=month&month=… / months / fy / year / range — anything invalid falls back to sensible defaults. */
export function queryFromParams(params: URLSearchParams, today: string): ReportQuery {
  const view = params.get("view");
  if (view === "months") {
    const from = params.get("from") ?? "";
    const to = params.get("to") ?? "";
    const thisMonth = today.slice(0, 7);
    if (MONTH_RE.test(from) && MONTH_RE.test(to) && from <= to && to <= thisMonth && monthsBetween(from, to) <= MAX_MONTHS) {
      return { view: "months", from, to };
    }
    return { view: "months", ...defaultMonthRange(today) };
  }
  if (view === "fy") {
    const fy = params.get("fy") ?? "";
    return { view: "fy", fy: /^\d{4}$/.test(fy) && fy <= currentFinancialYear(today) ? fy : currentFinancialYear(today) };
  }
  if (view === "range") {
    const from = params.get("from") ?? "";
    const to = params.get("to") ?? "";
    if (DATE_RE.test(from) && DATE_RE.test(to)) return { view: "range", from, to };
    return { view: "range", from: `${today.slice(0, 7)}-01`, to: today };
  }
  if (view === "year") {
    const year = params.get("year") ?? "";
    return { view: "year", year: /^\d{4}$/.test(year) && year <= today.slice(0, 4) ? year : today.slice(0, 4) };
  }
  const month = params.get("month") ?? "";
  return { view: "month", month: MONTH_RE.test(month) && month <= today.slice(0, 7) ? month : lastMonth(today) };
}

export function paramsFromQuery(q: ReportQuery): URLSearchParams {
  switch (q.view) {
    case "month":
      return new URLSearchParams({ view: "month", month: q.month });
    case "months":
      return new URLSearchParams({ view: "months", from: q.from, to: q.to });
    case "fy":
      return new URLSearchParams({ view: "fy", fy: q.fy });
    case "range":
      return new URLSearchParams({ view: "range", from: q.from, to: q.to });
    case "year":
      return new URLSearchParams({ view: "year", year: q.year });
  }
}

/** Range inputs: same rules as the server, so mistakes show before a request. */
export function rangeError(from: string, to: string, today: string): string | null {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return "Pick both dates.";
  if (from > to) return "The start must be on or before the end.";
  if (from > today) return "The range can't start in the future.";
  if (to > shiftDate(from, 730)) return "Pick a range of up to two years.";
  return null;
}

const monthName = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** Newest first, up to and including the current month. */
export function monthOptions(today: string, count = 36): Array<{ value: string; label: string }> {
  const options = [];
  let first = `${today.slice(0, 7)}-01`;
  for (let i = 0; i < count; i++) {
    const value = first.slice(0, 7);
    options.push({ value, label: `${monthName.format(new Date(`${first}T00:00:00Z`))}${i === 0 ? " (so far)" : ""}` });
    first = `${shiftDate(first, -1).slice(0, 7)}-01`;
  }
  return options;
}

export function yearOptions(today: string, count = 6): Array<{ value: string; label: string }> {
  const year = Number(today.slice(0, 4));
  return Array.from({ length: count }, (_, i) => ({ value: String(year - i), label: `${year - i}${i === 0 ? " (so far)" : ""}` }));
}

/** Statement status → pill style + label. */
export const STATEMENT_PILL: Record<StatementStatus, { status: Status; label: string }> = {
  paid: { status: "paid", label: "Paid" },
  paid_late: { status: "duesoon", label: "Paid late" },
  partpaid: { status: "partpaid", label: "Part paid" },
  overdue: { status: "overdue", label: "Overdue" },
  open: { status: "open", label: "Not due yet" },
  nothing_due: { status: "open", label: "Nothing due" },
};

/** Spending categories: going up is the bad direction (shown red). */
export function categoryChange(changePct: string | null, amount: string): { text: string; tone: "up" | "down" | "flat" | "new" } {
  if (changePct === null) return Number(amount) > 0 ? { text: "New", tone: "new" } : { text: "—", tone: "flat" };
  const n = Number(changePct);
  if (n === 0) return { text: "0%", tone: "flat" };
  return { text: `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(Math.abs(n) >= 10 ? 0 : 1)}%`, tone: n > 0 ? "up" : "down" };
}

/** What to call the file if the server's name isn't readable. */
export function fallbackFilename(q: ReportQuery): string {
  if (q.view === "month") return `finance-report-${q.month}.pdf`;
  if (q.view === "year") return `finance-report-${q.year}.pdf`;
  if (q.view === "fy") return `finance-report-FY${q.fy}-${fyLabel(q.fy).slice(-2)}.pdf`;
  if (q.view === "months") return `finance-report-${q.from}_to_${q.to}.pdf`;
  return `finance-report-${q.from}_to_${q.to}.pdf`;
}
