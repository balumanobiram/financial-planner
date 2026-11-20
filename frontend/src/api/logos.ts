/** Uploading your own bank logo. It's stored per bank, so every account and card of that bank changes. */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../lib/api";

export function useUploadLogo(kind: "accounts" | "cards") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, contentBase64 }: { id: string; contentBase64: string }) =>
      apiFetch<{ logo_data_url: string | null }>(`/${kind}/${id}/logo`, { method: "PUT", body: { content_base64: contentBase64 } }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["cards"] }),
      ]),
  });
}
