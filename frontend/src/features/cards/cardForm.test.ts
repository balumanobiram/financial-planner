import { describe, expect, it } from "vitest";

import { dueStatus, initialCardValues, ordinal, validateCardForm, type CardFormValues } from "./cardForm";

const valid: CardFormValues = {
  bank_name: " HDFC Bank ",
  card_name: "Regalia Gold",
  network: "mastercard",
  last4: "4321",
  credit_limit: "3,00,000",
  statement_day: "12",
  payment_due_days: "20",
  color: "#1A1A2E",
  bank_domain: "",
  notes: "",
};

describe("validateCardForm", () => {
  it("builds a clean API payload", () => {
    expect(validateCardForm(valid).input).toEqual({
      bank_name: "HDFC Bank",
      card_name: "Regalia Gold",
      network: "mastercard",
      last4: "4321",
      credit_limit: "300000.00",
      statement_day: 12,
      payment_due_days: 20,
      color: "#1a1a2e",
      bank_domain: null,
      notes: null,
    });
  });

  it("keeps optional fields empty as null", () => {
    const input = validateCardForm({ ...valid, last4: "", credit_limit: "" }).input;
    expect(input?.last4).toBeNull();
    expect(input?.credit_limit).toBeNull();
  });

  it("accepts a pasted website for the logo", () => {
    expect(validateCardForm({ ...valid, bank_domain: "https://www.hdfcbank.com/personal" }).input).not.toBeNull();
  });

  it.each<[Partial<CardFormValues>, keyof CardFormValues]>([
    [{ bank_name: "" }, "bank_name"],
    [{ card_name: "  " }, "card_name"],
    [{ last4: "12a4" }, "last4"],
    [{ statement_day: "0" }, "statement_day"],
    [{ statement_day: "32" }, "statement_day"],
    [{ payment_due_days: "0" }, "payment_due_days"],
    [{ payment_due_days: "61" }, "payment_due_days"],
    [{ payment_due_days: "1.5" }, "payment_due_days"],
    [{ credit_limit: "0" }, "credit_limit"],
    [{ credit_limit: "-500" }, "credit_limit"],
    [{ credit_limit: "abc" }, "credit_limit"],
    [{ color: "red" }, "color"],
    [{ bank_domain: "not a site" }, "bank_domain"],
  ])("rejects %o", (override, field) => {
    const result = validateCardForm({ ...valid, ...override });
    expect(result.input).toBeNull();
    expect(result.errors[field]).toBeTruthy();
  });
});

describe("dueStatus", () => {
  it.each([
    [0, "Due today", "overdue"],
    [1, "Due tomorrow", "duesoon"],
    [3, "Due in 3 days", "duesoon"],
    [5, "Due in 5 days", "duesoon"],
    [6, "in 6 days", null],
    [20, "in 20 days", null],
  ])("%i days → %s", (days, label, pill) => {
    expect(dueStatus(days)).toEqual({ label, pill });
  });
});

describe("ordinal", () => {
  it.each([
    [1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"], [11, "11th"], [12, "12th"], [13, "13th"], [21, "21st"], [22, "22nd"], [31, "31st"],
  ])("%i → %s", (n, expected) => {
    expect(ordinal(n)).toBe(expected);
  });
});

describe("initialCardValues", () => {
  it("defaults to a black Visa card with 20 days to pay", () => {
    const v = initialCardValues();
    expect([v.network, v.color, v.payment_due_days]).toEqual(["visa", "#1a1a2e", "20"]);
  });
});
