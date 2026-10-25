import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { getToken } from "../../lib/auth";

/** Route guard (≈ the backend's protected_router): no valid token → /login?next=<here>. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (!getToken()) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return children;
}
