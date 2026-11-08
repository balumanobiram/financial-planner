/**
 * Thin fetch wrapper (≈ a RestTemplate with an auth interceptor).
 * - attaches the Bearer token
 * - turns non-2xx responses into ApiError with the backend's `detail` message
 * - on 401: clears the token and sends you to /login (then back where you were)
 */

import { API_URL } from "../config";
import { clearAuth, getToken } from "./auth";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** false for endpoints that must not send/require a token (login). */
  auth?: boolean;
};

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(path, options);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** A file download (e.g. a PDF): the body as a Blob plus the server's suggested filename. */
export async function apiDownload(path: string, options: RequestOptions = {}): Promise<{ blob: Blob; filename: string | null }> {
  const response = await request(path, options);
  return { blob: await response.blob(), filename: filenameFrom(response.headers.get("Content-Disposition")) };
}

/** 'attachment; filename="finance-report-2026-10.pdf"' → "finance-report-2026-10.pdf". */
export function filenameFrom(disposition: string | null): string | null {
  const match = disposition && /filename="?([^";]+)"?/i.exec(disposition);
  return match ? match[1] : null;
}

/** Shared by JSON and file requests: auth header, network errors, 401 → login, non-2xx → ApiError. */
async function request(path: string, { method = "GET", body, signal, auth = true }: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json, application/pdf" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  if (auth) {
    const token = getToken();
    if (!token) {
      redirectToLogin();
      throw new ApiError(401, "Not authenticated");
    }
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "Can't reach the server. Check your connection or that the backend is running.");
  }

  if (response.status === 401 && auth) {
    clearAuth();
    redirectToLogin();
  }
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response));
  }
  return response;
}

function redirectToLogin(): void {
  if (window.location.pathname === "/login") return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/login?next=${next}`);
}

/** FastAPI errors look like {"detail": "..."} or, for validation, {"detail": [{msg, loc}, ...]}. */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === "object" && "detail" in data) {
      const { detail } = data as { detail: unknown };
      if (typeof detail === "string") return detail;
      if (Array.isArray(detail)) {
        return detail
          .map((d: { msg?: string; loc?: unknown[] }) => {
            const field = d.loc?.filter((part) => part !== "body").join(".");
            return field ? `${field}: ${d.msg}` : (d.msg ?? "Invalid value");
          })
          .join("; ");
      }
    }
  } catch {
    // not JSON
  }
  return `Request failed (${response.status})`;
}
