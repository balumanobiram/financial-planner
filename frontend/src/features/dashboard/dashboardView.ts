/** Pure logic for the dashboard: hero text, chart data, labels. */

import type { CardDue, DashboardSummary } from "../../api/dashboard";
import { formatDateShort } from "../../lib/dates";
import { formatINR, toPaise } from "../../lib/money";

/** "Due today" / "Due tomorrow" / "Due in 4 days" / "3 days overdue". */
export function daysLeftLabel(days: number): string {
  if (days < -1) return `${-days} days overdue`;
  if (days === -1) return "1 day overdue";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

/** Hero: the amount is the title; card and timing go underneath. */
export function heroText(due: CardDue): { title: string; subtitle: string } {
  const name = `${due.card_name}${due.last4 ? ` ••${due.last4}` : ""}`;
  return {
    title: formatINR(due.amount),
    subtitle: `${name} · ${daysLeftLabel(due.days_left)}, ${formatDateShort(due.due_date)}${due.status === "partpaid" ? " · part paid" : ""}`,
  };
}

/** The API's "12.5" → 12.5 for the change chip; null stays undefined (no chip). */
export const changeValue = (pct: string | null): number | undefined => (pct === null ? undefined : Number(pct));

/**
 * Chart libraries take numbers. Converting via paise keeps it exact to the rupee for display;
 * these numbers are never used for arithmetic that is shown as money.
 */
export const rupees = (amount: string): number => Number(toPaise(amount)) / 100;

const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" });

export function insightsChartData(months: DashboardSummary["money_insights"]) {
  return months.map((m) => ({ label: monthLabel.format(new Date(`${m.month}T00:00:00Z`)), inflow: rupees(m.inflow), outflow: rupees(m.outflow) }));
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Seven bars, Monday first; refunds can make a day negative — the bar then sits at 0. */
export function weekChartData(week: DashboardSummary["week"], today: string) {
  return week.days.map((d, i) => ({
    label: WEEKDAYS[i],
    day: d.day,
    amount: d.amount,
    value: Math.max(rupees(d.amount), 0),
    isToday: d.day === today,
    isFuture: d.day > today,
  }));
}

/** Week-over-week chip: spending going UP is bad news, so it gets the "negative" tone. */
export function spendChangeTone(pct: string | null): "up" | "down" | "none" {
  if (pct === null) return "none";
  return Number(pct) > 0 ? "up" : "down";
}
