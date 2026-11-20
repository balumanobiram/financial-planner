/**
 * Split maths shared by the inbox (approve) and Edit transaction. Pure functions, exact paise
 * (BigInt) — no floating point anywhere near money.
 *
 *  - With people: each person owes an amount (₹) or a percentage of the total; you keep the rest.
 *  - Across categories: the parts must add up to exactly the total.
 */

import { formatINR, fromPaise, normalizeMoneyInput, toPaise } from "../../lib/money";

export type SplitUnit = "amount" | "percent";
export type PersonRow = { person_id: string; value: string };
export type CategoryRow = { category_id: string; amount: string };
export type Share = { person_id: string; amount: string };

/** "33.33" → 3333 (hundredths of a percent); null if not a number between 0 and 100 with ≤ 2 decimals. */
export function percentBasisPoints(raw: string): bigint | null {
  const text = raw.trim().replace(/%$/, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const bp = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
  return bp > 0n && bp <= 10000n ? bp : null;
}

/** A percentage of `total`, rounded down to the paisa (any leftover paisa stays with you). */
export function percentOf(total: string, bp: bigint): string {
  return fromPaise((toPaise(total) * bp) / 10000n);
}

/** Equal values for `people` others (+ you): ₹ amounts or percentages, as strings for the inputs. */
export function equalValues(total: string, people: number, includeMe: boolean, unit: SplitUnit): string[] {
  if (people < 1) return [];
  const parts = BigInt(people + (includeMe ? 1 : 0));
  if (unit === "percent") {
    const each = 10000n / parts; // basis points, floored
    return Array.from({ length: people }, () => fromPaise(each).replace(/\.00$/, ""));
  }
  return Array.from({ length: people }, () => fromPaise(toPaise(total) / parts));
}

export type PeopleSplitResult = {
  shares: Share[];
  /** What's left for you; null until the total and every row are valid. */
  mine: string | null;
  error?: string;
  rowErrors: Record<number, string>;
};

export function peopleSplit(totalRaw: string, rows: PersonRow[], unit: SplitUnit): PeopleSplitResult {
  const total = normalizeMoneyInput(totalRaw);
  const rowErrors: Record<number, string> = {};
  const shares: Share[] = [];
  const seen = new Set<string>();

  rows.forEach((row, i) => {
    if (!row.person_id) return void (rowErrors[i] = "Pick a person.");
    if (seen.has(row.person_id)) return void (rowErrors[i] = "Already in the split.");
    seen.add(row.person_id);
    if (unit === "percent") {
      const bp = percentBasisPoints(row.value);
      if (bp === null) return void (rowErrors[i] = "Enter a % like 50 or 33.33.");
      if (total !== null) shares.push({ person_id: row.person_id, amount: percentOf(total, bp) });
    } else {
      const amount = normalizeMoneyInput(row.value);
      if (amount === null || toPaise(amount) <= 0n) return void (rowErrors[i] = "Enter their share.");
      shares.push({ person_id: row.person_id, amount });
    }
  });

  if (rows.length === 0) return { shares: [], mine: null, error: "Add at least one person.", rowErrors };
  if (total === null || Object.keys(rowErrors).length) return { shares, mine: null, rowErrors };

  const zeroShare = shares.findIndex((s) => toPaise(s.amount) === 0n);
  if (zeroShare >= 0) rowErrors[zeroShare] = "That's less than a paisa.";
  const sum = shares.reduce((acc, s) => acc + toPaise(s.amount), 0n);
  const mine = fromPaise(toPaise(total) - sum);
  const error = sum > toPaise(total) ? `Shares add up to ${formatINR(fromPaise(sum))} — more than ${formatINR(total)}.` : undefined;
  return { shares, mine, error, rowErrors };
}

export type CategorySplitResult = {
  parts: Array<{ category_id: string | null; amount: string }>;
  /** Total minus the parts so far (0.00 when it adds up); null until everything is a valid amount. */
  remaining: string | null;
  error?: string;
  rowErrors: Record<number, string>;
};

export function categorySplit(totalRaw: string, rows: CategoryRow[]): CategorySplitResult {
  const total = normalizeMoneyInput(totalRaw);
  const rowErrors: Record<number, string> = {};
  const parts: CategorySplitResult["parts"] = [];
  rows.forEach((row, i) => {
    const amount = normalizeMoneyInput(row.amount);
    if (amount === null || toPaise(amount) <= 0n) rowErrors[i] = "Enter an amount.";
    else parts.push({ category_id: row.category_id || null, amount });
  });
  if (total === null || Object.keys(rowErrors).length) return { parts, remaining: null, rowErrors };

  const remaining = fromPaise(toPaise(total) - parts.reduce((acc, p) => acc + toPaise(p.amount), 0n));
  let error: string | undefined;
  if (rows.length < 2) error = "Add at least two categories.";
  else if (toPaise(remaining) !== 0n) {
    error = toPaise(remaining) > 0n ? `${formatINR(remaining)} still to assign.` : `${formatINR(remaining.replace("-", ""))} too much.`;
  }
  return { parts, remaining, error, rowErrors };
}

/** Did the split change? (Order doesn't matter; amounts compared exactly.) */
export function sharesChanged(before: Share[], after: Share[]): boolean {
  const key = (shares: Share[]) =>
    shares
      .map((s) => `${s.person_id}=${toPaise(s.amount)}`)
      .sort()
      .join("|");
  return key(before) !== key(after);
}
