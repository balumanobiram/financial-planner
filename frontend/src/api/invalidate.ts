import { useQueryClient } from "@tanstack/react-query";

/**
 * Any money movement can change transactions, account balances, card outstandings
 * and what people owe — refetch all of them (≈ evicting several Spring caches at once).
 */
export function useInvalidateMoney() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ["transactions", "accounts", "cards", "people"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );
}
