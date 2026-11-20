import { describe, expect, it } from "vitest";

import { categorySplit, equalValues, peopleSplit, percentBasisPoints, percentOf, sharesChanged } from "./split";

describe("percentages", () => {
  it.each([
    ["50", 5000n],
    ["33.33", 3333n],
    ["12.5%", 1250n],
    ["100", 10000n],
    ["0", null],
    ["100.01", null],
    ["1.234", null],
    ["abc", null],
  ])("percentBasisPoints(%s)", (raw, expected) => {
    expect(percentBasisPoints(raw)).toBe(expected);
  });

  it("rounds down to the paisa", () => {
    expect(percentOf("100.00", 3333n)).toBe("33.33");
    expect(percentOf("10.00", 3333n)).toBe("3.33");
  });
});

it("equal values in ₹ or %, leftovers stay with you", () => {
  expect(equalValues("1000.00", 2, true, "amount")).toEqual(["333.33", "333.33"]);
  expect(equalValues("1000.00", 2, false, "amount")).toEqual(["500.00", "500.00"]);
  expect(equalValues("1000.00", 2, true, "percent")).toEqual(["33.33", "33.33"]);
  expect(equalValues("1000.00", 1, true, "percent")).toEqual(["50"]);
});

describe("peopleSplit", () => {
  const ravi = "r";
  const asha = "a";

  it("amounts: your share is what's left", () => {
    const result = peopleSplit("1800", [{ person_id: ravi, value: "600" }, { person_id: asha, value: "600" }], "amount");
    expect(result).toEqual({
      shares: [{ person_id: ravi, amount: "600.00" }, { person_id: asha, amount: "600.00" }],
      mine: "600.00",
      error: undefined,
      rowErrors: {},
    });
  });

  it("percentages become exact amounts", () => {
    const result = peopleSplit("1000", [{ person_id: ravi, value: "33.33" }, { person_id: asha, value: "33.33" }], "percent");
    expect(result.shares.map((s) => s.amount)).toEqual(["333.30", "333.30"]);
    expect(result.mine).toBe("333.40");
  });

  it("they can pay all of it (nothing left for you)", () => {
    expect(peopleSplit("500", [{ person_id: ravi, value: "500" }], "amount").mine).toBe("0.00");
  });

  it("flags over-splitting, duplicates and blanks", () => {
    expect(peopleSplit("500", [{ person_id: ravi, value: "600" }], "amount").error).toBe("Shares add up to ₹600.00 — more than ₹500.00.");
    expect(peopleSplit("500", [{ person_id: ravi, value: "1" }, { person_id: ravi, value: "1" }], "amount").rowErrors).toEqual({ 1: "Already in the split." });
    expect(peopleSplit("500", [{ person_id: "", value: "1" }], "amount").rowErrors).toEqual({ 0: "Pick a person." });
    expect(peopleSplit("500", [], "amount").error).toBe("Add at least one person.");
  });
});

describe("categorySplit", () => {
  it("must add up exactly", () => {
    const ok = categorySplit("1000", [{ category_id: "g", amount: "700" }, { category_id: "s", amount: "300" }]);
    expect(ok.error).toBeUndefined();
    expect(ok.remaining).toBe("0.00");
    expect(categorySplit("1000", [{ category_id: "g", amount: "700" }, { category_id: "s", amount: "200" }]).error).toBe("₹100.00 still to assign.");
    expect(categorySplit("1000", [{ category_id: "g", amount: "700" }, { category_id: "s", amount: "400" }]).error).toBe("₹100.00 too much.");
    expect(categorySplit("1000", [{ category_id: "g", amount: "1000" }]).error).toBe("Add at least two categories.");
  });
});

it("sharesChanged ignores order and formatting", () => {
  const a = [{ person_id: "r", amount: "600.00" }, { person_id: "a", amount: "600" }];
  expect(sharesChanged(a, [a[1], a[0]])).toBe(false);
  expect(sharesChanged(a, [{ person_id: "r", amount: "600.00" }])).toBe(true);
  expect(sharesChanged([], [])).toBe(false);
});
