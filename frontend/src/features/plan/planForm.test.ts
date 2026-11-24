import { describe, expect, it } from "vitest";

import type { Plan } from "../../api/plan";
import { groupSlices, itemSlices, salaryInput, shade, validateItem } from "./planForm";

const PLAN: Plan = {
  salary: "80000.00",
  notes: null,
  items: [
    { id: "1", name: "Rent", amount: "18000.00", group: "needs", percent_of_salary: "22.5" },
    { id: "2", name: "SIP", amount: "10000.00", group: "investments", percent_of_salary: "12.5" },
    { id: "3", name: "Groceries", amount: "7000.00", group: "needs", percent_of_salary: "8.8" },
  ],
  planned: "35000.00",
  left_over: "45000.00",
  left_over_percent: "56.3",
  saving_rate: "12.5",
  groups: [
    { group: "needs", amount: "25000.00", percent_of_salary: "31.3", items: 2 },
    { group: "wants", amount: "0.00", percent_of_salary: "0.0", items: 0 },
    { group: "savings", amount: "0.00", percent_of_salary: "0.0", items: 0 },
    { group: "investments", amount: "10000.00", percent_of_salary: "12.5", items: 1 },
  ],
  top_items: [],
  rule_50_30_20: [],
};

describe("validateItem", () => {
  it("cleans up a good line", () => {
    expect(validateItem({ name: "  Rent ", amount: "18,000", group: "needs" }).input).toEqual({ name: "Rent", amount: "18000.00", group: "needs" });
  });
  it("needs a name and a positive amount", () => {
    expect(validateItem({ name: " ", amount: "0", group: "needs" }).errors).toEqual({
      name: "Give it a name, e.g. Rent.",
      amount: "Enter an amount like 18000.",
    });
  });
});

it("salaryInput: blank is zero, negatives and junk are rejected", () => {
  expect(salaryInput("")).toBe("0.00");
  expect(salaryInput("80,000")).toBe("80000.00");
  expect(salaryInput("-5")).toBeNull();
  expect(salaryInput("abc")).toBeNull();
});

describe("pie slices", () => {
  it("groups + left over make up the salary; empty groups are left out", () => {
    const { slices, total } = groupSlices(PLAN);
    expect(total).toBe("80000.00");
    expect(slices.map((s) => [s.name, s.amount, s.percent])).toEqual([
      ["Needs", "25000.00", "31.3"],
      ["Investments", "10000.00", "12.5"],
      ["Left over", "45000.00", "56.3"],
    ]);
  });

  it("over-planned: no left-over slice, shares are of what's planned", () => {
    const { slices } = groupSlices({ ...PLAN, salary: "30000.00", left_over: "-5000.00" });
    expect(slices.map((s) => s.percent)).toEqual(["71.4", "28.6"]);
  });

  it("items are ordered by group and shaded within a group", () => {
    const { slices } = itemSlices(PLAN);
    expect(slices.map((s) => s.name)).toEqual(["Rent", "Groceries", "SIP"]);
    expect(slices[0].color).toBe("#1f4fd1");
    expect(slices[1].color).toBe(shade("#1f4fd1", 1));
    expect(slices[1].color).not.toBe(slices[0].color);
  });
});
