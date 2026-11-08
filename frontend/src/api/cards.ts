/** Credit card API: types mirror backend/app/schemas/credit_card.py. Money is a string; dates are YYYY-MM-DD. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../lib/api";

export type CardNetwork = "visa" | "mastercard" | "rupay" | "amex" | "diners" | "other";

export const CARD_NETWORKS: ReadonlyArray<{ value: CardNetwork; label: string }> = [
  { value: "visa", label: "Visa" },
  { value: "mastercard", label: "Mastercard" },
  { value: "rupay", label: "RuPay" },
  { value: "amex", label: "Amex" },
  { value: "diners", label: "Diners" },
  { value: "other", label: "Other" },
];

export type Billing = {
  last_statement_date: string;
  last_due_date: string;
  next_statement_date: string;
  next_due_date: string;
  pay_by: string;
  days_until_pay_by: number;
};

export type CreditCard = {
  id: string;
  bank_name: string;
  card_name: string;
  network: CardNetwork;
  last4: string | null;
  credit_limit: string | null;
  statement_day: number;
  payment_due_days: number;
  color: string;
  bank_domain: string | null;
  notes: string | null;
  is_archived: boolean;
  logo_data_url: string | null;
  billing: Billing;
  outstanding: string; // what you owe on the card now
  available_credit: string | null; // null when no limit is set
  created_at: string;
  updated_at: string;
};

export type CreditCardInput = {
  bank_name: string;
  card_name: string;
  network: CardNetwork;
  last4: string | null;
  credit_limit: string | null;
  statement_day: number;
  payment_due_days: number;
  color: string;
  bank_domain: string | null;
  notes: string | null;
};

const CARDS_KEY = ["cards"] as const;

/** All cards (archived included); the API sorts active ones by pay-by date. */
export function useCards() {
  return useQuery({
    queryKey: CARDS_KEY,
    queryFn: ({ signal }) => apiFetch<{ items: CreditCard[] }>("/cards?include_archived=true", { signal }),
  });
}

function useInvalidateCards() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: CARDS_KEY });
}

export function useSaveCard() {
  const invalidate = useInvalidateCards();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CreditCardInput }) =>
      id
        ? apiFetch<CreditCard>(`/cards/${id}`, { method: "PATCH", body: input })
        : apiFetch<CreditCard>("/cards", { method: "POST", body: input }),
    onSuccess: invalidate,
  });
}

export function useSetCardArchived() {
  const invalidate = useInvalidateCards();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      apiFetch<CreditCard>(`/cards/${id}/${archived ? "archive" : "unarchive"}`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

export function useRefreshLogo() {
  const invalidate = useInvalidateCards();
  return useMutation({
    mutationFn: (id: string) => apiFetch<CreditCard>(`/cards/${id}/refresh-logo`, { method: "POST" }),
    onSuccess: invalidate,
  });
}
