import { describe, expect, it } from "vitest";

import {
  balanceChip,
  splitEqually,
  validatePaymentForm,
  validatePersonForm,
  validateSplitForm,
  yourShare,
  type PaymentFormValues,
  type SplitFormValues,
} from "./peopleForms";
import { toPaise } from "../../lib/money";

const TODAY = "2026-10-25";

describe("balanceChip", () => {
  it.each([
    ["1500.00", "Owes you ₹1,500.00", "owes"],
    ["0.00", "Settled up", "settled"],
    ["-300.50", "You owe ₹300.50", "credit"],
  ])("%s → %s", (outstanding, label, tone) => {
    expect(balanceChip(outstanding)).toEqual({ label, tone });
  });
});

describe("validatePersonForm", () => {
  it("trims and nulls empty optionals", () => {
    expect(validatePersonForm({ name: "  Dad ", relation: " ", notes: "" }).input).toEqual({ name: "Dad", relation: null, notes: null });
  });
  it("requires a name", () => {
    expect(validatePersonForm({ name: "", relation: "", notes: "" }).errors.name).toBeTruthy();
  });
});

describe("validatePaymentForm", () => {
  const base: PaymentFormValues = { kind: "settlement", account_id: "acc-1", amount: "400", occurred_on: TODAY, description: "" };

  it("accepts a partial settlement", () => {
    expect(validatePaymentForm(base, "900.00", TODAY).input).toEqual({
      account_id: "acc-1", amount: "400.00", occurred_on: TODAY, description: null,
    });
  });

  it("accepts paying back exactly what's owed", () => {
    expect(validatePaymentForm({ ...base, amount: "900" }, "900.00", TODAY).input).not.toBeNull();
  });

  it("refuses overpaying a settlement", () => {
    const { errors } = validatePaymentForm({ ...base, amount: "900.01" }, "900.00", TODAY);
    expect(errors.amount).toContain("only owe ₹900.00");
  });

  it("refuses a settlement when nothing is owed", () => {
    expect(validatePaymentForm(base, "0.00", TODAY).errors.amount).toContain("gift");
  });

  it("allows any positive gift, even when nothing is owed", () => {
    expect(validatePaymentForm({ ...base, kind: "income", amount: "5,000" }, "0.00", TODAY).input?.amount).toBe("5000.00");
  });

  it.each<[Partial<PaymentFormValues>, keyof PaymentFormValues]>([
    [{ account_id: "" }, "account_id"],
    [{ amount: "0" }, "amount"],
    [{ amount: "abc" }, "amount"],
    [{ occurred_on: "2026-10-26" }, "occurred_on"],
  ])("rejects %o", (override, field) => {
    expect(validatePaymentForm({ ...base, ...override }, "900.00", TODAY).errors[field]).toBeTruthy();
  });
});

describe("splitEqually", () => {
  it("splits with you, keeping leftover paise", () => {
    // ₹1,000 between you + 2 friends: 333.33 each for them, 333.34 stays with you.
    expect(splitEqually("1000.00", 2, true)).toEqual(["333.33", "333.33"]);
  });

  it("splits only between others", () => {
    expect(splitEqually("1000.00", 2, false)).toEqual(["500.00", "500.00"]);
  });

  it("never sums above the total", () => {
    for (const [total, n] of [["0.05", 2], ["100.00", 3], ["999.99", 7]] as const) {
      const sum = splitEqually(total, n, false).reduce((acc, s) => acc + toPaise(s), 0n);
      expect(sum <= toPaise(total)).toBe(true);
    }
  });

  it("handles no people", () => {
    expect(splitEqually("100.00", 0, true)).toEqual([]);
  });
});

describe("yourShare", () => {
  it("is what's left after everyone else", () => {
    expect(yourShare("1800", [{ person_id: "a", amount: "600" }, { person_id: "b", amount: "600" }])).toBe("600.00");
  });
  it("is null while inputs are incomplete", () => {
    expect(yourShare("1800", [{ person_id: "a", amount: "" }])).toBeNull();
    expect(yourShare("", [])).toBeNull();
  });
});

describe("validateSplitForm", () => {
  const base: SplitFormValues = {
    source: "card:card-1",
    amount: "1800",
    occurred_on: TODAY,
    description: " Dinner ",
    rows: [{ person_id: "p1", amount: "600" }, { person_id: "p2", amount: "600" }],
  };

  it("builds a card-based payload", () => {
    expect(validateSplitForm(base, TODAY).input).toEqual({
      card_id: "card-1", amount: "1800.00", occurred_on: TODAY, description: "Dinner",
      shares: [{ person_id: "p1", amount: "600.00" }, { person_id: "p2", amount: "600.00" }],
    });
  });

  it("builds an account-based payload", () => {
    expect(validateSplitForm({ ...base, source: "account:acc-1" }, TODAY).input?.account_id).toBe("acc-1");
  });

  it("refuses shares above the total", () => {
    const { errors } = validateSplitForm({ ...base, rows: [{ person_id: "p1", amount: "1800.01" }] }, TODAY);
    expect(errors.rows).toContain("more than");
  });

  it("flags the bad row", () => {
    const { errors } = validateSplitForm({ ...base, rows: [{ person_id: "p1", amount: "600" }, { person_id: "p1", amount: "100" }] }, TODAY);
    expect(errors.rowErrors).toEqual({ 1: "This person is already in the split." });
  });

  it.each<[Partial<SplitFormValues>, "source" | "amount" | "occurred_on" | "rows"]>([
    [{ source: "" }, "source"],
    [{ amount: "0" }, "amount"],
    [{ occurred_on: "2026-10-26" }, "occurred_on"],
    [{ rows: [] }, "rows"],
  ])("rejects %o", (override, field) => {
    expect(validateSplitForm({ ...base, ...override }, TODAY).errors[field]).toBeTruthy();
  });
});
