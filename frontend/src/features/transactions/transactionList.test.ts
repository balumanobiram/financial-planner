import { describe, expect, it } from "vitest";

import { txn } from "./testFixtures";
import {
  activeFilterCount,
  apiFilters,
  dayLabel,
  filtersFromParams,
  groupByDay,
  paramsFromFilters,
  presetRange,
  rowText,
  visibleRows,
} from "./transactionList";

const TODAY = "2026-10-25";

describe("presetRange", () => {
  it.each([
    ["this_month", { from: "2026-10-01", to: "2026-10-25" }],
    ["last_month", { from: "2026-09-01", to: "2026-09-30" }],
    ["last_30", { from: "2026-09-26", to: "2026-10-25" }],
    ["all", {}],
  ] as const)("%s", (preset, expected) => {
    expect(presetRange(preset, TODAY)).toEqual(expected);
  });

  it("last month across a year boundary", () => {
    expect(presetRange("last_month", "2027-01-10")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("filters ↔ URL", () => {
  it("round-trips", () => {
    const params = new URLSearchParams("range=custom&from=2026-10-01&to=2026-10-10&card_id=c1&category_id=food&type=expense&q=swiggy");
    const f = filtersFromParams(params);
    expect(f).toEqual({
      range: "custom", from: "2026-10-01", to: "2026-10-10", source: "card:c1",
      categoryId: "food", personId: "", type: "expense", q: "swiggy",
    });
    expect(paramsFromFilters(f).toString()).toBe(params.toString());
  });

  it("ignores junk and keeps a clean URL for defaults", () => {
    const f = filtersFromParams(new URLSearchParams("range=forever&type=bogus"));
    expect(f.range).toBe("all");
    expect(f.type).toBe("");
    expect(paramsFromFilters(f).toString()).toBe("");
  });

  it("maps to API filters, resolving presets", () => {
    const f = filtersFromParams(new URLSearchParams("range=this_month&account_id=a1&q=%20rent%20"));
    expect(apiFilters(f, TODAY)).toEqual({
      from: "2026-10-01", to: "2026-10-25", account_id: "a1",
      category_id: undefined, person_id: undefined, type: undefined, q: "rent",
    });
    expect(activeFilterCount(f)).toBe(1);
  });
});

describe("rows", () => {
  const out = txn({ id: "o", type: "transfer", direction: "debit", amount: "-5000.00", category: null, description: null,
    source: { kind: "account", id: "a1", name: "SBI" }, counterpart: { kind: "account", id: "a2", name: "HDFC" }, link_id: "L" });
  const inHalf = { ...out, id: "i", direction: "credit" as const, amount: "5000.00", source: out.counterpart!, counterpart: out.source };

  it("shows a transfer once unless filtered to one account", () => {
    expect(visibleRows([out, inHalf], false).map((t) => t.id)).toEqual(["o"]);
    expect(visibleRows([out, inHalf], true).map((t) => t.id)).toEqual(["o", "i"]);
  });

  it("transfer text is neutral overall, signed for one account", () => {
    expect(rowText(out, false)).toEqual({ title: "Transfer", subtitle: "SBI → HDFC", amount: "₹5,000.00", tone: "neutral" });
    expect(rowText(inHalf, true)).toMatchObject({ subtitle: "SBI → HDFC", amount: "+₹5,000.00", tone: "in" });
  });

  it("expense, refund and split text", () => {
    expect(rowText(txn(), false)).toEqual({ title: "Swiggy", subtitle: "Food · HDFC Regalia", amount: "−₹450.00", tone: "out" });
    expect(rowText(txn({ direction: "credit", amount: "450.00" }), false)).toMatchObject({ subtitle: "Refund · Food · HDFC Regalia", tone: "in" });
    const split = txn({ shares: [{ person_id: "p", person_name: "Ravi", amount: "225.00" }] });
    expect(rowText(split, false).subtitle).toBe("Food · HDFC Regalia · split with Ravi");
  });

  it("groups consecutive rows by IST day", () => {
    const a = txn({ id: "a", occurred_at: "2026-10-24T20:00:00Z" }); // 25 Oct IST
    const b = txn({ id: "b", occurred_at: "2026-10-24T18:30:00Z" }); // 25 Oct IST
    const c = txn({ id: "c", occurred_at: "2026-10-24T10:00:00Z" }); // 24 Oct IST
    expect(groupByDay([a, b, c]).map((g) => [g.date, g.items.map((i) => i.id)])).toEqual([
      ["2026-10-25", ["a", "b"]],
      ["2026-10-24", ["c"]],
    ]);
  });

  it.each([
    ["2026-10-25", "Today"],
    ["2026-10-24", "Yesterday"],
    ["2026-10-20", "Tue, 20 Oct"],
    ["2025-12-31", "Wed, 31 Dec, 2025"],
  ])("dayLabel %s → %s", (date, label) => {
    expect(dayLabel(date, TODAY)).toBe(label);
  });
});
