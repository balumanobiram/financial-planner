/** Reports API: types mirror backend/app/schemas/reports.py. Money is a string; dates are YYYY-MM-DD. */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiDownload, apiFetch } from "../lib/api";

export type ReportQuery =
  | { view: "month"; month: string } // YYYY-MM
  | { view: "months"; from: string; to: string } // YYYY-MM … YYYY-MM, whole months
  | { view: "fy"; fy: string } // starting year: "2025" = FY 2025–26 (Apr–Mar)
  | { view: "year"; year: string }
  | { view: "range"; from: string; to: string }; // YYYY-MM-DD, any days

export type StatementStatus = "paid" | "paid_late" | "partpaid" | "overdue" | "open" | "nothing_due";

export type ReportData = {
  period: {
    kind: "monthly" | "months" | "financial_year" | "yearly" | "range";
    start: string;
    end: string;
    label: string;
    title: string; // "Financial year report"
    compare_label: string; // "last financial year", "the previous 6 months"
    span_label: string; // "this financial year"
    previous_start: string;
    previous_end: string;
    is_complete: boolean;
  };
  generated_at: string;
  from_snapshot: boolean;
  summary: {
    accounts: Array<{ account_id: string; name: string; bank_name: string; opening: string; closing: string; change: string; is_archived: boolean }>;
    banks_opening: string;
    banks_closing: string;
    income: string;
    expenses: string;
    net_savings: string;
    savings_rate: string | null;
  };
  income_sources: Array<{ source: "salary" | "people" | "other"; label: string; amount: string; percent: string }>;
  expense_categories: Array<{
    category_id: string | null;
    name: string;
    color: string;
    icon: string;
    amount: string;
    percent: string;
    previous: string;
    change_pct: string | null;
  }>;
  top_expenses: Array<{ transaction_id: string; occurred_on: string; description: string | null; category: string | null; source: string; amount: string }>;
  cards: Array<{
    card_id: string;
    card_name: string;
    bank_name: string;
    last4: string | null;
    color: string;
    statement_date: string;
    due_date: string;
    amount: string;
    paid: string;
    paid_by_due: string;
    status: StatementStatus;
    utilization_pct: string | null;
    fees: string;
  }>;
  people: Array<{ person_id: string; name: string; owed_at_start: string; new_shares: string; settled: string; pending: string }>;
  net_position: { banks: string; owed_to_me: string; card_outstanding: string; value: string; previous_value: string; change: string };
  trend: Array<{ month: string; income: string; expenses: string }>;
  insights: Array<{ tone: "good" | "info" | "warn" | "bad"; text: string }>;
};

/** "/reports/monthly?month=2026-10" etc. — the PDF lives at the same path + "/pdf". */
export function reportPath(q: ReportQuery, pdf = false): string {
  const suffix = pdf ? "/pdf" : "";
  switch (q.view) {
    case "month":
      return `/reports/monthly${suffix}?month=${q.month}`;
    case "months":
      return `/reports/months${suffix}?from=${q.from}&to=${q.to}`;
    case "fy":
      return `/reports/financial-year${suffix}?fy=${q.fy}`;
    case "range":
      return `/reports/range${suffix}?from=${q.from}&to=${q.to}`;
    case "year":
      return `/reports/yearly${suffix}?year=${q.year}`;
  }
}

/** Under "transactions" so any money change refetches the (live) report. */
const reportKey = (q: ReportQuery) => ["transactions", "report", q] as const;

export function useReport(q: ReportQuery | null) {
  return useQuery({
    queryKey: reportKey(q ?? { view: "month", month: "" }),
    queryFn: ({ signal }) => apiFetch<ReportData>(reportPath(q!), { signal }),
    enabled: q !== null,
    placeholderData: keepPreviousData, // keep the old report visible while switching months
  });
}

export function useRegenerateReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (month: string) => apiFetch<ReportData>(`/reports/monthly/regenerate?month=${month}`, { method: "POST" }),
    onSuccess: (data, month) => queryClient.setQueryData(reportKey({ view: "month", month }), { ...data, from_snapshot: true }),
  });
}

export function useDownloadReport() {
  return useMutation({
    mutationFn: (q: ReportQuery) => apiDownload(reportPath(q, true)),
  });
}
