/** Plan page API: types mirror backend/app/schemas/plan.py. Money is a string. Standalone: touches nothing else. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../lib/api";

export type PlanGroup = "needs" | "wants" | "savings" | "investments";

export type PlanItem = { id: string; name: string; amount: string; group: PlanGroup; percent_of_salary: string | null };

export type Plan = {
  salary: string;
  notes: string | null;
  items: PlanItem[];
  planned: string;
  left_over: string; // negative = planned more than you earn
  left_over_percent: string | null;
  saving_rate: string | null;
  groups: Array<{ group: PlanGroup; amount: string; percent_of_salary: string | null; items: number }>;
  top_items: PlanItem[];
  rule_50_30_20: Array<{ label: string; actual: string | null; target: string; at_most: boolean; ok: boolean | null }>;
};

export type PlanItemInput = { name: string; amount: string; group: PlanGroup };

const PLAN_KEY = ["plan"] as const;

export function usePlan() {
  return useQuery({ queryKey: PLAN_KEY, queryFn: ({ signal }) => apiFetch<Plan>("/plan", { signal }) });
}

/** Every change returns the whole recalculated plan, so we just store it (no refetch). */
function usePlanMutation<V>(request: (vars: V) => Promise<Plan>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: request, onSuccess: (plan) => queryClient.setQueryData(PLAN_KEY, plan) });
}

export const useUpdatePlan = () =>
  usePlanMutation((input: { salary?: string; notes?: string | null }) => apiFetch<Plan>("/plan", { method: "PATCH", body: input }));

export const useSavePlanItem = () =>
  usePlanMutation(({ id, input }: { id?: string; input: PlanItemInput }) =>
    id ? apiFetch<Plan>(`/plan/items/${id}`, { method: "PATCH", body: input }) : apiFetch<Plan>("/plan/items", { method: "POST", body: input }),
  );

export const useDeletePlanItem = () => usePlanMutation((id: string) => apiFetch<Plan>(`/plan/items/${id}`, { method: "DELETE" }));
