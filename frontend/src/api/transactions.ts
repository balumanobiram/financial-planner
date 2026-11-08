/** Transactions API: types mirror backend/app/schemas/transactions.py. Money is a string; dates are YYYY-MM-DD. */

import { keepPreviousData, useInfiniteQuery, useMutation } from "@tanstack/react-query";

import { apiFetch } from "../lib/api";
import { useInvalidateMoney } from "./invalidate";

export type TransactionType = "expense" | "income" | "transfer" | "card_payment" | "settlement" | "adjustment";
export type Direction = "debit" | "credit";

export type SourceRef = { kind: "account" | "card"; id: string; name: string };

export type Transaction = {
  id: string;
  type: TransactionType;
  direction: Direction;
  amount: string; // signed: negative = money out
  occurred_at: string; // UTC timestamp
  description: string | null;
  tags: string[];
  source: SourceRef;
  counterpart: SourceRef | null; // other side of a transfer / card payment
  category: { id: string; name: string; icon: string; color: string } | null;
  person: { id: string; name: string } | null;
  shares: Array<{ person_id: string; person_name: string; amount: string }>;
  link_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TransactionSummary = { count: number; money_in: string; money_out: string };

export type TransactionPage = {
  items: Transaction[];
  next_cursor: string | null;
  summary: TransactionSummary | null; // first page only
};

export type TransactionFilters = {
  from?: string;
  to?: string;
  account_id?: string;
  card_id?: string;
  category_id?: string;
  person_id?: string;
  type?: TransactionType;
  q?: string;
};

type Common = { amount: string; occurred_on: string; description: string | null; tags: string[] };

export type TransactionCreate =
  | (Common & {
      type: "expense" | "income";
      source: { account_id: string } | { card_id: string };
      direction?: Direction;
      category_id: string | null;
      person_id?: string | null;
      shares?: Array<{ person_id: string; amount: string }>;
    })
  | (Common & { type: "transfer"; from_account_id: string; to_account_id: string })
  | (Common & { type: "card_payment"; from_account_id: string; card_id: string });

/** PATCH body: only the fields sent change. */
export type TransactionUpdate = Partial<{
  amount: string;
  direction: Direction;
  occurred_on: string;
  description: string | null;
  tags: string[];
  category_id: string | null;
  source: { account_id: string } | { card_id: string };
}>;

const PAGE_SIZE = 30;

function toQuery(filters: TransactionFilters, cursor: string | null): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(PAGE_SIZE));
  return params.toString();
}

/**
 * Infinite list (≈ Spring Data's Slice, but cursor-based): each page brings the cursor for the next.
 * The filters are part of the cache key, so changing a filter starts a fresh list.
 */
export function useTransactions(filters: TransactionFilters) {
  return useInfiniteQuery({
    queryKey: ["transactions", "list", filters],
    queryFn: ({ pageParam, signal }) => apiFetch<TransactionPage>(`/transactions?${toQuery(filters, pageParam)}`, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    placeholderData: keepPreviousData, // keep showing the old list while a new filter loads
  });
}

export function useCreateTransaction() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (input: TransactionCreate) => apiFetch<{ items: Transaction[] }>("/transactions", { method: "POST", body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateTransaction() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TransactionUpdate }) =>
      apiFetch<{ items: Transaction[] }>(`/transactions/${id}`, { method: "PATCH", body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteTransaction() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/transactions/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}
