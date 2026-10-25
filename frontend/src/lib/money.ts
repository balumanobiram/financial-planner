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

// ---- Exact arithmetic in integer paise (BigInt) — never JS floats -----------

const API_MONEY_RE = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/** "-123.4" → -12340n. Accepts API/normalized strings with up to 2 decimals. */
export function toPaise(value: string): bigint {
  const match = API_MONEY_RE.exec(value.trim());
  if (!match) throw new Error(`Invalid money value: "${value}"`);
  const [, sign, rupees, fraction = ""] = match;
  const paise = BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, "0"));
  return sign ? -paise : paise;
}

/** -12340n → "-123.40" */
export function fromPaise(paise: bigint): string {
  const sign = paise < 0n ? "-" : "";
  const abs = paise < 0n ? -paise : paise;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** a − b, exactly. */
export function subtractMoney(a: string, b: string): string {
  return fromPaise(toPaise(a) - toPaise(b));
}

// ≤ 12 rupee digits + ≤ 2 decimals = fits NUMERIC(14,2), same rule as the backend.
const MONEY_INPUT_RE = /^-?\d{1,12}(\.\d{1,2})?$/;

/**
 * Clean up what a person typed: "₹ 25,000.5" → "25000.50".
 * Returns null if it isn't a valid amount (letters, 3+ decimals, too large).
 */
export function normalizeMoneyInput(raw: string): string | null {
  const cleaned = raw.replace(/[₹,\s]/g, "");
  if (!MONEY_INPUT_RE.test(cleaned)) return null;
  return fromPaise(toPaise(cleaned));
}

/** "500.00" → "+₹500.00", "-123.45" → "-₹123.45", "0.00" → "₹0.00" */
export function formatINRSigned(value: string): string {
  const paise = toPaise(value);
  return paise > 0n ? `+${formatINR(value)}` : formatINR(value);
}
