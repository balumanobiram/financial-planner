/** Categories API: types mirror backend/app/schemas/categories.py. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../lib/api";

export type CategoryKind = "expense" | "income" | "any";

export type Category = {
  id: string;
  name: string;
  icon: string; // lucide component name, e.g. "UtensilsCrossed"
  color: string; // #rrggbb
  kind: CategoryKind;
  is_system: boolean;
  is_archived: boolean;
  sort_order: number;
};

export type CategoryInput = { name: string; icon: string; color: string; kind: CategoryKind };

const CATEGORIES_KEY = ["categories"] as const;

/** All categories, archived included (pickers hide archived ones). */
export function useCategories() {
  return useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: ({ signal }) => apiFetch<{ items: Category[] }>("/categories?include_archived=true", { signal }),
    staleTime: 5 * 60_000, // they rarely change
  });
}

/** Renaming or recolouring a category changes how transactions display too. */
function useInvalidateCategories() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY }),
      queryClient.invalidateQueries({ queryKey: ["transactions"] }),
    ]);
}

export function useSaveCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CategoryInput }) =>
      id
        ? apiFetch<Category>(`/categories/${id}`, { method: "PATCH", body: input })
        : apiFetch<Category>("/categories", { method: "POST", body: input }),
    onSuccess: invalidate,
  });
}

export function useSetCategoryArchived() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      apiFetch<Category>(`/categories/${id}/${archived ? "archive" : "unarchive"}`, { method: "POST" }),
    onSuccess: invalidate,
  });
}

export function useDeleteCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/categories/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}
