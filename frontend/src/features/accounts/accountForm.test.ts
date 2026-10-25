import { describe, expect, it } from "vitest";

import { initialValues, validateAccountForm, type AccountFormValues } from "./accountForm";

const TODAY = "2026-10-25";

const valid: AccountFormValues = {
  bank_name: "  HDFC Bank ",
  nickname: "Salary",
  account_type: "salary",
  last4: "4321",
  opening_balance: "₹25,000.5",
  opening_date: "2026-04-01",
  notes: "  ",
  bank_domain: "",
};

describe("validateAccountForm", () => {
  it("builds a clean API payload", () => {
    const result = validateAccountForm(valid, TODAY);
    expect(result.input).toEqual({
      bank_name: "HDFC Bank",
      nickname: "Salary",
      account_type: "salary",
      last4: "4321",
      opening_balance: "25000.50",
      opening_date: "2026-04-01",
      notes: null,
      bank_domain: null,
    });
  });

  it("treats empty opening balance as zero and empty last4 as null", () => {
    const result = validateAccountForm({ ...valid, opening_balance: "", last4: "" }, TODAY);
    expect(result.input?.opening_balance).toBe("0.00");
    expect(result.input?.last4).toBeNull();
  });

  it("allows a negative opening balance (overdraft)", () => {
    expect(validateAccountForm({ ...valid, opening_balance: "-1500" }, TODAY).input?.opening_balance).toBe("-1500.00");
  });

  it.each<[Partial<AccountFormValues>, keyof AccountFormValues]>([
    [{ bank_name: "  " }, "bank_name"],
    [{ nickname: "" }, "nickname"],
    [{ last4: "12a4" }, "last4"],
    [{ last4: "12345" }, "last4"],
    [{ opening_balance: "1.005" }, "opening_balance"],
    [{ opening_balance: "abc" }, "opening_balance"],
    [{ opening_date: "2026-10-26" }, "opening_date"],
    [{ opening_date: "" }, "opening_date"],
    [{ bank_domain: "not a site" }, "bank_domain"],
  ])("rejects %o", (override, field) => {
    const result = validateAccountForm({ ...valid, ...override }, TODAY);
    expect(result.input).toBeNull();
    expect(result.errors[field]).toBeTruthy();
  });

  it("passes a pasted website through for the backend to clean", () => {
    const input = validateAccountForm({ ...valid, bank_domain: " https://www.hdfcbank.com/ " }, TODAY).input;
    expect(input?.bank_domain).toBe("https://www.hdfcbank.com/");
  });

  it("accepts today as the opening date", () => {
    expect(validateAccountForm({ ...valid, opening_date: TODAY }, TODAY).input).not.toBeNull();
  });
});

describe("initialValues", () => {
  it("defaults new accounts to savings, opened today", () => {
    const values = initialValues();
    expect(values.account_type).toBe("savings");
    expect(values.opening_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
