import { describe, expect, it } from "vitest";

import { formatTypedAmount, keyFromKeyboard, pressKey, type KeypadKey } from "./keypad";

const type = (keys: KeypadKey[]) => keys.reduce(pressKey, "");

describe("pressKey", () => {
  it("builds an amount digit by digit", () => {
    expect(type(["4", "5", "0"])).toBe("450");
  });

  it("allows at most two decimals and one point", () => {
    expect(type(["9", ".", "9", "9", "9"])).toBe("9.99");
    expect(type(["1", ".", ".", "5"])).toBe("1.5");
  });

  it("starts a bare point as 0.", () => {
    expect(type([".", "5"])).toBe("0.5");
  });

  it("drops a leading zero", () => {
    expect(type(["0", "0", "7"])).toBe("7");
    expect(type(["0", ".", "5"])).toBe("0.5");
  });

  it("caps rupees at 12 digits", () => {
    expect(type(Array(14).fill("9"))).toBe("9".repeat(12));
  });

  it("backspace removes the last character, and is safe on empty", () => {
    expect(type(["1", "2", ".", "back", "back"])).toBe("1");
    expect(pressKey("", "back")).toBe("");
  });
});

describe("keyFromKeyboard", () => {
  it.each([
    ["7", "7"],
    [".", "."],
    [",", "."],
    ["Backspace", "back"],
    ["a", null],
    ["Enter", null],
  ])("%s → %s", (key, expected) => {
    expect(keyFromKeyboard(key)).toBe(expected);
  });
});

describe("formatTypedAmount", () => {
  it.each([
    ["", "0"],
    ["450", "450"],
    ["1250", "1,250"],
    ["123456", "1,23,456"],
    ["1234567.5", "12,34,567.5"],
    ["0.", "0."],
  ])("%s → %s", (typed, shown) => {
    expect(formatTypedAmount(typed)).toBe(shown);
  });
});
