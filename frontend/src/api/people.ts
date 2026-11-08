/** People API: types mirror backend/app/schemas/people.py. Money is a string; dates are YYYY-MM-DD. */

import { useMutation, useQuery } from "@tanstack/react-query";

import { apiFetch } from "../lib/api";
import { useInvalidateMoney } from "./invalidate";

export type PersonTotals = {
  shared_total: string;
  settled_total: string;
  outstanding: string; // > 0 → they owe you
  received_total: string;
};

export type Person = {
  id: string;
  name: string;
  relation: string | null;
  notes: string | null;
  is_archived: boolean;
  totals: PersonTotals;
  created_at: string;
  updated_at: string;
};

export type HistoryEntry = {
  type: "shared_expense" | "settlement" | "income";
  transaction_id: string;
  occurred_at: string;
  description: string | null;
  amount: string;
  source: { kind: "account" | "card"; id: string; name: string };
  total_spent: string | null;
  status: "paid" | "partpaid" | "open" | null;
  remaining: string | null;
};

export type PersonDetail = Person & { history: HistoryEntry[] };

export type PersonInput = { name: string; relation: string | null; notes: string | null };

export type PaymentInput = { account_id: string; amount: string; occurred_on: string; description: string | null };

export type SharedExpenseInput = {
  account_id?: string;
  card_id?: string;
  amount: string;
  occurred_on: string;
  description: string | null;
  shares: Array<{ person_id: string; amount: string }>;
};

const PEOPLE_KEY = ["people"] as const;

export function usePeople() {
  return useQuery({
    queryKey: PEOPLE_KEY,
    queryFn: ({ signal }) => apiFetch<{ items: Person[]; total_outstanding: string }>("/people?include_archived=true", { signal }),
  });
}

export function usePerson(id: string) {
  return useQuery({
    queryKey: [...PEOPLE_KEY, id],
    queryFn: ({ signal }) => apiFetch<PersonDetail>(`/people/${id}`, { signal }),
  });
}

export function useSavePerson() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: PersonInput }) =>
      id
        ? apiFetch<Person>(`/people/${id}`, { method: "PATCH", body: input })
        : apiFetch<Person>("/people", { method: "POST", body: input }),
    onSuccess: invalidate,
  });
}

export function useSetPersonArchived() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      apiFetch<Person>(`/people/${id}/${archived ? "archive" : "unarchive"}`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

export function useRecordPayment() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ personId, kind, input }: { personId: string; kind: "settlement" | "income"; input: PaymentInput }) =>
      apiFetch(`/people/${personId}/${kind === "settlement" ? "settlements" : "income"}`, { method: "POST", body: input }),
    onSuccess: invalidate,
  });
}

export function useCreateSharedExpense() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (input: SharedExpenseInput) => apiFetch("/shared-expenses", { method: "POST", body: input }),
    onSuccess: invalidate,
  });
}
