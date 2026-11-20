/** SMS inbox API: types mirror backend/app/schemas/inbox.py. Money is a string; dates are YYYY-MM-DD. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../lib/api";
import { useInvalidateMoney } from "./invalidate";
import type { SourceRef, Transaction } from "./transactions";

export type SmsStatus = "pending" | "approved" | "ignored" | "rejected";

export type SmsItem = {
  id: string;
  sender: string;
  text: string;
  received_at: string;
  status: SmsStatus;
  parsed: boolean;
  amount: string | null;
  direction: "debit" | "credit" | null;
  suggested_kind: "expense" | "income" | "card_payment" | "transfer" | "settlement" | null;
  merchant: string | null;
  upi_ref: string | null;
  last4: string | null;
  occurred_at: string | null;
  source: SourceRef | null;
  category: { id: string; name: string; icon: string; color: string } | null;
  needs_review: boolean;
  note: string | null;
  duplicate_of_sms_id: string | null;
  duplicate_of_transaction_id: string | null;
  can_quick_approve: boolean;
};

export type InboxPage = { items: SmsItem[]; pending_count: number; last_received_at: string | null };
export type InboxSummary = { pending_count: number; last_received_at: string | null };

type Common = { amount: string; occurred_on: string; description: string | null };
export type ApproveInput =
  | (Common & {
      as: "expense" | "income";
      source: { account_id: string } | { card_id: string };
      direction?: "debit" | "credit";
      category_id?: string | null;
      parts?: Array<{ category_id: string | null; amount: string }>;
      person_id?: string | null;
      shares?: Array<{ person_id: string; amount: string }>;
    })
  | (Common & { as: "card_payment"; from_account_id: string; card_id: string })
  | (Common & { as: "transfer"; from_account_id: string; to_account_id: string })
  | (Common & { as: "repayment"; person_id: string; account_id: string });

const INBOX_KEY = ["inbox"] as const;

export function useInbox(status: SmsStatus) {
  return useQuery({
    queryKey: [...INBOX_KEY, "list", status],
    queryFn: ({ signal }) => apiFetch<InboxPage>(`/inbox?status=${status}`, { signal }),
  });
}

/** For the nav badge and the "no SMS lately" banner; refreshed every minute while the app is open. */
export function useInboxSummary() {
  return useQuery({
    queryKey: [...INBOX_KEY, "summary"],
    queryFn: ({ signal }) => apiFetch<InboxSummary>("/inbox/summary", { signal }),
    refetchInterval: 60_000,
  });
}

/** Approving moves money, so refetch balances etc. as well as the inbox. */
function useInvalidateInbox() {
  const queryClient = useQueryClient();
  const invalidateMoney = useInvalidateMoney();
  return () => Promise.all([queryClient.invalidateQueries({ queryKey: INBOX_KEY }), invalidateMoney()]);
}

export function useApproveSms() {
  const invalidate = useInvalidateInbox();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ApproveInput }) =>
      apiFetch<{ items: Transaction[] }>(`/inbox/${id}/approve`, { method: "POST", body: input }),
    onSuccess: invalidate,
  });
}

export function useBulkApprove() {
  const invalidate = useInvalidateInbox();
  return useMutation({
    mutationFn: (ids: string[]) => apiFetch<{ approved: number; skipped: number }>("/inbox/bulk-approve", { method: "POST", body: { ids } }),
    onSuccess: invalidate,
  });
}

export function useSetSmsStatus() {
  const invalidate = useInvalidateInbox();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "ignore" | "restore" }) => apiFetch<SmsItem>(`/inbox/${id}/${action}`, { method: "POST" }),
    onSuccess: invalidate,
  });
}
