/**
 * Money helpers. Amounts arrive from the API as decimal strings ("123456.78"),
 * never JS numbers — a JS number is a binary float (like Java's double).
 */

const inrFormatters = {
  withDecimals: new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
  noDecimals: new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }),
};

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

export type FormatINROptions = {
  showDecimals?: boolean;
};

/** "-123456.5" → "-₹1,23,456.50" (Indian lakh/crore grouping). */
export function formatINR(value: string, { showDecimals = true }: FormatINROptions = {}): string {
  const trimmed = value.trim();
  if (!DECIMAL_RE.test(trimmed)) {
    throw new Error(`Invalid money value: "${value}"`);
  }
  const formatter = showDecimals ? inrFormatters.withDecimals : inrFormatters.noDecimals;
  // Intl formats a numeric *string* exactly (no float conversion) in modern engines.
  return formatter.format(trimmed as unknown as number);
}

export function isNegative(value: string): boolean {
  return /^-\d*\.?\d*[1-9]/.test(value.trim());
}

const inrCompact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/**
 * 120000 → "₹1.2L", 10000000 → "₹1Cr". For chart axes/labels only, where
 * approximate display is the point — takes a number because chart libraries do.
 */
export function formatINRCompact(value: number): string {
  return inrCompact.format(value);
}
