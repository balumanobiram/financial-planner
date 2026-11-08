import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router";

import { clearAuth } from "../lib/auth";

export function useLogout(): () => void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useCallback(() => {
    clearAuth();
    queryClient.clear(); // drop cached financial data from memory
    navigate("/login", { replace: true });
  }, [queryClient, navigate]);
}
