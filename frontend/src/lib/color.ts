/** Colour helpers for user-chosen card colours (#rrggbb). */

const HEX_RE = /^#([0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value);
}

function toRgb(hex: string): [number, number, number] {
  const match = HEX_RE.exec(hex);
  if (!match) throw new Error(`Invalid colour: "${hex}"`);
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** Mix towards black (amount < 0) or white (amount > 0); amount in -1…1. */
export function shade(hex: string, amount: number): string {
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  return toHex(toRgb(hex).map((c) => c + (target - c) * t) as [number, number, number]);
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const CARD_TEXT_LIGHT = "#ffffff";
export const CARD_TEXT_DARK = "#111111";

/** White or near-black — whichever reads better on this background. */
export function readableTextOn(background: string): string {
  return contrastRatio(CARD_TEXT_LIGHT, background) >= contrastRatio(CARD_TEXT_DARK, background)
    ? CARD_TEXT_LIGHT
    : CARD_TEXT_DARK;
}
