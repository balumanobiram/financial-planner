/** Pure logic for the Quick add number pad: what each key press does to the typed amount. */

export type KeypadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back";

const MAX_RUPEE_DIGITS = 12; // NUMERIC(14,2) on the backend

/**
 * Apply one key to the amount typed so far (a plain string like "1250.5").
 * Invalid presses are ignored, so the string is always a valid partial amount.
 */
export function pressKey(current: string, key: KeypadKey): string {
  if (key === "back") return current.slice(0, -1);

  const [rupees, paise] = current.split(".");
  if (key === ".") {
    if (paise !== undefined) return current; // already has a point
    return current === "" ? "0." : `${current}.`;
  }
  if (paise !== undefined) return paise.length >= 2 ? current : current + key;
  if (rupees === "0") return key; // "0" then "5" → "5", not "05"
  if (rupees.length >= MAX_RUPEE_DIGITS) return current;
  return current + key;
}

/** Map a physical keyboard key to a keypad key (null = not ours). */
export function keyFromKeyboard(key: string): KeypadKey | null {
  if (/^[0-9]$/.test(key)) return key as KeypadKey;
  if (key === "." || key === ",") return ".";
  if (key === "Backspace") return "back";
  return null;
}

/** "1234567.5" → "12,34,567.5" — Indian grouping, keeping exactly what was typed after the point. */
export function formatTypedAmount(typed: string): string {
  if (typed === "") return "0";
  const [rupees, paise] = typed.split(".");
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return paise === undefined ? grouped : `${grouped}.${paise}`;
}
