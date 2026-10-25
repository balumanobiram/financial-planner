/** App-wide constants. Change the name here and it updates everywhere. */
export const APP_NAME = "Planner";

/** Backend base URL, from frontend/.env.local (dev) or Vercel env vars (prod). */
export const API_URL = (import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
