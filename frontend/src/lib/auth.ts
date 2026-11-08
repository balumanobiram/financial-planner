/**
 * Login token storage. localStorage keeps you logged in across tabs and restarts;
 * the expiry is stored too so a stale token is dropped before it is ever sent.
 * Every access is wrapped in try/catch: storage can be blocked (private mode, settings).
 */

const STORAGE_KEY = "planner.auth";

type StoredAuth = { token: string; expiresAt: string };

export function saveAuth(token: string, expiresAt: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, expiresAt } satisfies StoredAuth));
  } catch {
    // Storage unavailable: you'll simply be asked to log in again next time.
  }
}

export function clearAuth(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** The token if present and not expired, otherwise null. */
export function getToken(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { token, expiresAt } = JSON.parse(raw) as StoredAuth;
    if (!token || !(Date.parse(expiresAt) > Date.now())) {
      clearAuth();
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

/** Only allow same-site relative paths after login (prevents open redirects like ?next=//evil.com). */
export function safeNextPath(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}
