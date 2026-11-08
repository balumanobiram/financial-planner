/** Bank account API: types mirror backend/app/schemas/bank_account.py. Money is always a string. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../lib/api";

export type AccountType = "savings" | "current" | "salary" | "wallet";

export const ACCOUNT_TYPES: ReadonlyArray<{ value: AccountType; label: string }> = [
  { value: "savings", label: "Savings" },
  { value: "salary", label: "Salary" },
  { value: "current", label: "Current" },
  { value: "wallet", label: "Wallet" },
];

export const accountTypeLabel = (type: AccountType) => ACCOUNT_TYPES.find((t) => t.value === type)?.label ?? type;

export type BankAccount = {
  id: string;
  bank_name: string;
  nickname: string;
  account_type: AccountType;
  last4: string | null;
  opening_balance: string;
  opening_date: string; // YYYY-MM-DD
  notes: string | null;
  bank_domain: string | null;
  is_archived: boolean;
  logo_data_url: string | null;
  current_balance: string;
  created_at: string;
  updated_at: string;
};

export type BankAccountList = { items: BankAccount[]; total_balance: string };

export type BankAccountInput = {
  bank_name: string;
  nickname: string;
  account_type: AccountType;
  last4: string | null;
  opening_balance: string;
  opening_date: string;
  notes: string | null;
  bank_domain: string | null;
};

export type ReconcileResponse = {
  account: BankAccount;
  adjustment: { id: string; amount: string; occurred_at: string; description: string | null } | null;
};

const ACCOUNTS_KEY = ["accounts"] as const;

/** All accounts, archived included (the page splits them). total_balance counts active ones only. */
export function useAccounts() {
  return useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: ({ signal }) => apiFetch<BankAccountList>("/accounts?include_archived=true", { signal }),
  });
}

/** After any change, refetch the list so balances and totals come from the server. */
function useInvalidateAccounts() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
}

export function useSaveAccount() {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: BankAccountInput }) =>
      id
        ? apiFetch<BankAccount>(`/accounts/${id}`, { method: "PATCH", body: input })
        : apiFetch<BankAccount>("/accounts", { method: "POST", body: input }),
    onSuccess: invalidate,
  });
}

export function useSetArchived() {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      apiFetch<BankAccount>(`/accounts/${id}/${archived ? "archive" : "unarchive"}`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

export function useReconcile() {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: ({ id, actualBalance }: { id: string; actualBalance: string }) =>
      apiFetch<ReconcileResponse>(`/accounts/${id}/reconcile`, {
        method: "POST",
        body: { actual_balance: actualBalance },
      }),
    onSuccess: invalidate,
  });
}

export function useRefreshAccountLogo() {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: (id: string) => apiFetch<BankAccount>(`/accounts/${id}/refresh-logo`, { method: "POST" }),
    onSuccess: invalidate,
  });
}
