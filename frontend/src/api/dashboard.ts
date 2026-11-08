/** Dashboard API: types mirror backend/app/schemas/dashboard.py. Money is a string; dates are YYYY-MM-DD. */

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "../lib/api";
import type { Transaction } from "./transactions";

export type Stat = { value: string; previous: string; change_pct: string | null };

export type DueStatus = "overdue" | "duesoon" | "partpaid" | "paid" | "open";

export type CardDue = {
  card_id: string;
  card_name: string;
  bank_name: string;
  last4: string | null;
  color: string;
  status: DueStatus;
  amount: string; // left to pay on the statement (or spent since, if it's paid)
  statement_balance: string;
  paid_since_statement: string;
  outstanding: string;
  due_date: string;
  days_left: number; // negative = overdue
};

export type CategorySlice = { category_id: string | null; name: string; icon: string; color: string; amount: string; percent: string };

export type DashboardSummary = {
  today: string;
  hero: CardDue | null;
  stats: { bank_total: Stat; card_outstanding: Stat; owed_to_me: Stat; net_position: Stat };
  money_insights: Array<{ month: string; inflow: string; outflow: string }>;
  week: { days: Array<{ day: string; amount: string }>; total: string; last_week_total: string; change_pct: string | null };
  card_dues: CardDue[];
  expenses: { week: CategorySlice[]; month: CategorySlice[]; week_total: string; month_total: string };
  recent: Transaction[];
};

/**
 * Lives under the "transactions" key, so every money change (Quick add, edits, imports…)
 * already refreshes it through useInvalidateMoney — no extra wiring.
 */
export function useDashboard() {
  return useQuery({
    queryKey: ["transactions", "dashboard"],
    queryFn: ({ signal }) => apiFetch<DashboardSummary>("/dashboard/summary", { signal }),
  });
}
