/**
 * Date display helpers. The backend stores timestamps in UTC; we always show IST.
 * Date-only values ("2026-10-30", e.g. opening_date) have no time zone and are shown as-is.
 */

export const APP_TIME_ZONE = "Asia/Kolkata";

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const dateOnlyFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC", // the Date below is built at UTC midnight, so no day shift
});

const dateTimeFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: APP_TIME_ZONE,
});

/** "2026-10-30" → "30 Oct 2026" */
export function formatDate(isoDate: string): string {
  const match = DATE_ONLY_RE.exec(isoDate);
  if (!match) throw new Error(`Invalid date: "${isoDate}"`);
  const [, y, m, d] = match;
  return dateOnlyFormat.format(new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))));
}

/** UTC timestamp from the API → IST, e.g. "2026-10-25T18:30:00Z" → "26 Oct 2026, 12:00 am" */
export function formatDateTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp: "${isoTimestamp}"`);
  return dateTimeFormat.format(date);
}

/** Today's date in IST as "YYYY-MM-DD" (for date inputs). */
export function todayIST(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE }).format(now);
}
