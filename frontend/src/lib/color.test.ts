import { describe, expect, it } from "vitest";

import { CARD_TEXT_DARK, CARD_TEXT_LIGHT, contrastRatio, isHexColor, readableTextOn, shade } from "./color";
import { CARD_COLOR_PRESETS } from "../features/cards/cardForm";

describe("shade", () => {
  it("darkens and lightens", () => {
    expect(shade("#808080", -0.5)).toBe("#404040");
    expect(shade("#808080", 0.5)).toBe("#c0c0c0");
    expect(shade("#1f4fd1", 0)).toBe("#1f4fd1");
  });
});

describe("contrastRatio", () => {
  it("matches the WCAG extremes", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });
});

describe("readableTextOn", () => {
  it.each([
    ["#1a1a2e", CARD_TEXT_LIGHT], // black card
    ["#0c2547", CARD_TEXT_LIGHT], // navy
    ["#d4af37", CARD_TEXT_DARK], // gold
    ["#c0c6d0", CARD_TEXT_DARK], // silver
    ["#ffffff", CARD_TEXT_DARK],
  ])("on %s uses %s", (bg, expected) => {
    expect(readableTextOn(bg)).toBe(expected);
  });

  it("every preset colour gets text with at least 4.5:1 contrast", () => {
    for (const { value } of CARD_COLOR_PRESETS) {
      expect(contrastRatio(readableTextOn(value), value), value).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("isHexColor", () => {
  it("accepts only #rrggbb", () => {
    expect(isHexColor("#1A1a2e")).toBe(true);
    expect(isHexColor("#123")).toBe(false);
    expect(isHexColor("red")).toBe(false);
  });
});
