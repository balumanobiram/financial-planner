import { describe, expect, it } from "vitest";

import { formatINR, formatINRCompact, isNegative } from "./money";

describe("formatINR", () => {
  it.each([
    ["0", "₹0.00"],
    ["5", "₹5.00"],
    ["999.9", "₹999.90"],
    ["1000", "₹1,000.00"],
    ["123456", "₹1,23,456.00"],
    ["1234567.89", "₹12,34,567.89"],
    ["999999999999.99", "₹9,99,99,99,99,999.99"],
  ])("formats %s as %s", (input, expected) => {
    expect(formatINR(input)).toBe(expected);
  });

  it("formats negatives with a leading minus", () => {
    expect(formatINR("-123456.50")).toBe("-₹1,23,456.50");
  });

  it("does not lose precision on large amounts", () => {
    // As a JS float, 999999999999.99 + 0.01 style values can drift; strings must not.
    expect(formatINR("999999999999.98")).toBe("₹9,99,99,99,99,999.98");
  });

  it("can hide decimals", () => {
    expect(formatINR("123456.40", { showDecimals: false })).toBe("₹1,23,456");
  });

  it("rejects non-numeric input", () => {
    expect(() => formatINR("12,000")).toThrow("Invalid money value");
    expect(() => formatINR("abc")).toThrow();
  });
});

describe("isNegative", () => {
  it.each([
    ["-1.00", true],
    ["-0.01", true],
    ["-0.00", false],
    ["0", false],
    ["12.50", false],
  ])("isNegative(%s) is %s", (input, expected) => {
    expect(isNegative(input)).toBe(expected);
  });
});

describe("formatINRCompact", () => {
  it.each([
    [0, "₹0"],
    [950, "₹950"],
    [40000, "₹40K"],
    [120000, "₹1.2L"],
    [10000000, "₹1Cr"],
    [-25000, "-₹25K"],
  ])("formats %d as %s", (input, expected) => {
    expect(formatINRCompact(input)).toBe(expected);
  });
});
