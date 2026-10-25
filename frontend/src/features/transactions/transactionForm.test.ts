import { describe, expect, it } from "vitest";

import {
  buildUpdate,
  editableFields,
  emptyQuickAdd,
  initialEditValues,
  istDate,
  parseSource,
  parseTags,
  splitShares,
  validateQuickAdd,
  type QuickAddValues,
} from "./transactionForm";
import { txn } from "./testFixtures";

const TODAY = "2026-10-25";
const qa = (over: Partial<QuickAddValues>): QuickAddValues => ({ ...emptyQuickAdd(TODAY), ...over });


describe("parseTags", () => {
  it("splits on commas, spaces and #, lower-cases and dedupes", () => {
    expect(parseTags("Work, #trip  goa,work")).toEqual(["work", "trip", "goa"]);
    expect(parseTags("  ")).toEqual([]);
  });
});

describe("parseSource", () => {
  it.each([
    ["account:a1", { account_id: "a1" }],
    ["card:c1", { card_id: "c1" }],
    ["", null],
    ["wallet:x", null],
  ])("%s", (value, expected) => {
    expect(parseSource(value)).toEqual(expected);
  });
});

describe("splitShares", () => {
  it("equal split includes you; leftover paise stay with you", () => {
    expect(splitShares("100.00", ["p1", "p2"], "equal")).toEqual([
      { person_id: "p1", amount: "33.33" },
      { person_id: "p2", amount: "33.33" },
    ]);
  });

  it("'they pay all' divides the whole amount exactly", () => {
    const shares = splitShares("100.00", ["p1", "p2", "p3"], "all");
    expect(shares.map((s) => s.amount)).toEqual(["33.34", "33.33", "33.33"]);
  });
});

describe("validateQuickAdd", () => {
  it("builds an expense from keypad input", () => {
    const { errors, input } = validateQuickAdd(
      qa({ amount: "450", source: "card:c1", categoryId: "food", description: " Swiggy ", tags: "work" }),
      TODAY,
    );
    expect(errors).toEqual({});
    expect(input).toEqual({
      type: "expense",
      amount: "450.00",
      source: { card_id: "c1" },
      category_id: "food",
      occurred_on: TODAY,
      description: "Swiggy",
      tags: ["work"],
    });
  });

  it("a refund is an expense credited back, and can't be split", () => {
    const { input } = validateQuickAdd(qa({ amount: "99", source: "card:c1", refund: true, splitWith: ["p1"] }), TODAY);
    expect(input).toMatchObject({ type: "expense", direction: "credit" });
    expect(input).not.toHaveProperty("shares");
  });

  it("adds an equal split", () => {
    const { input } = validateQuickAdd(qa({ amount: "900", source: "account:a1", splitWith: ["p1", "p2"] }), TODAY);
    expect(input).toMatchObject({ shares: [{ person_id: "p1", amount: "300.00" }, { person_id: "p2", amount: "300.00" }] });
  });

  it("income can name who it came from", () => {
    const { input } = validateQuickAdd(qa({ type: "income", amount: "5000", source: "account:a1", personId: "dad" }), TODAY);
    expect(input).toMatchObject({ type: "income", person_id: "dad", category_id: null });
  });

  it("transfer needs two different accounts", () => {
    expect(validateQuickAdd(qa({ type: "transfer", amount: "10", fromAccount: "a1", toAccount: "a1" }), TODAY).errors).toEqual({
      toAccount: "Pick two different accounts.",
    });
    expect(validateQuickAdd(qa({ type: "transfer", amount: "10", fromAccount: "a1", toAccount: "a2" }), TODAY).input).toEqual({
      type: "transfer",
      amount: "10.00",
      from_account_id: "a1",
      to_account_id: "a2",
      occurred_on: TODAY,
      description: null,
      tags: [],
    });
  });

  it("card bill needs an account and a card", () => {
    const { errors, input } = validateQuickAdd(qa({ type: "card_payment", amount: "10" }), TODAY);
    expect(input).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(["card", "fromAccount"]);
  });

  it("rejects zero, missing source, future dates and too many tags", () => {
    const { errors } = validateQuickAdd(qa({ amount: "0.", occurredOn: "2026-10-26", tags: "a b c d e f g h i j k" }), TODAY);
    expect(Object.keys(errors).sort()).toEqual(["amount", "occurredOn", "source", "tags"]);
  });
});

describe("editing", () => {
  it("istDate converts UTC to the IST calendar day", () => {
    expect(istDate("2026-10-24T18:30:00Z")).toBe("2026-10-25");
    expect(istDate("2026-10-24T18:29:59Z")).toBe("2026-10-24");
  });

  it("settlements and adjustments allow only note and tags", () => {
    expect(editableFields("settlement")).toEqual({
      amount: false, date: false, direction: false, source: false, category: false, description: true, tags: true,
    });
    expect(editableFields("transfer")).toMatchObject({ amount: true, date: true, source: false, category: false });
  });

  it("an unchanged form sends an empty PATCH", () => {
    const t = txn();
    expect(buildUpdate(t, initialEditValues(t), TODAY)).toEqual({ errors: {}, input: {} });
  });

  it("sends only what changed", () => {
    const t = txn();
    const values = { ...initialEditValues(t), amount: "500", categoryId: "", description: "", tags: "work, team" };
    expect(buildUpdate(t, values, TODAY).input).toEqual({
      amount: "500.00",
      category_id: null,
      description: null,
      tags: ["work", "team"],
    });
  });

  it("ignores fields the kind can't change", () => {
    const t = txn({ type: "settlement", direction: "credit", amount: "200.00", category: null });
    const values = { ...initialEditValues(t), amount: "999", source: "account:zzz", description: "Cash" };
    expect(buildUpdate(t, values, TODAY).input).toEqual({ description: "Cash" });
  });

  it("validates amount and date", () => {
    const t = txn();
    const { errors, input } = buildUpdate(t, { ...initialEditValues(t), amount: "abc", occurredOn: "2026-11-01" }, TODAY);
    expect(input).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(["amount", "occurredOn"]);
  });
});
