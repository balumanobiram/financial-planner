import { describe, expect, it } from "vitest";

import {
  formatINR,
  formatINRCompact,
  formatINRSigned,
  fromPaise,
  isNegative,
  normalizeMoneyInput,
  subtractMoney,
  toPaise,
} from "./money";

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

describe("paise arithmetic", () => {
  it.each([
    ["0", 0n],
    ["0.5", 50n],
    ["-123.45", -12345n],
    ["999999999999.99", 99999999999999n],
  ])("toPaise(%s) = %s", (input, expected) => {
    expect(toPaise(input)).toBe(expected);
  });

  it("round-trips through fromPaise", () => {
    for (const value of ["0.00", "0.05", "-0.05", "123456.78", "-999999999999.99"]) {
      expect(fromPaise(toPaise(value))).toBe(value);
    }
  });

  it("subtracts exactly where floats fail", () => {
    // In JS floats, 0.3 - 0.1 = 0.19999999999999998
    expect(subtractMoney("0.30", "0.10")).toBe("0.20");
    expect(subtractMoney("9876.55", "10000.00")).toBe("-123.45");
    expect(subtractMoney("999999999999.99", "999999999999.98")).toBe("0.01");
  });

  it("rejects more than 2 decimals", () => {
    expect(() => toPaise("1.005")).toThrow();
  });
});

describe("normalizeMoneyInput", () => {
  it.each([
    ["25000", "25000.00"],
    ["25,000.5", "25000.50"],
    ["₹ 1,23,456.78", "123456.78"],
    ["-250", "-250.00"],
    ["007.10", "7.10"],
    ["-0", "0.00"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeMoneyInput(input)).toBe(expected);
  });

  it.each(["", "abc", "1.005", "12a", "1000000000000", "--5", "."])("rejects %j", (input) => {
    expect(normalizeMoneyInput(input)).toBeNull();
  });
});

describe("formatINRSigned", () => {
  it("adds + only for positive amounts", () => {
    expect(formatINRSigned("500.00")).toBe("+₹500.00");
    expect(formatINRSigned("-123.45")).toBe("-₹123.45");
    expect(formatINRSigned("0.00")).toBe("₹0.00");
  });
});
