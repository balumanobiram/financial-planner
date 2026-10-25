import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "../lib/api";

export type TokenResponse = {
  access_token: string;
  token_type: "bearer";
  expires_at: string;
};

export type Me = { username: string };

export function login(username: string, password: string): Promise<TokenResponse> {
  return apiFetch<TokenResponse>("/auth/login", {
    method: "POST",
    body: { username, password },
    auth: false,
  });
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => apiFetch<Me>("/auth/me", { signal }),
    staleTime: Infinity,
  });
}
