import { describe, expect, it } from "vitest";

import type { SmsItem } from "../../api/inbox";
import { buildApprove, inboxIsQuiet, initialApproveValues, type ApproveValues } from "./inboxForm";

const TODAY = "2026-11-20";

const SMS: SmsItem = {
  id: "s1",
  sender: "AX-TESTBK",
  text: "Rs 1,800 spent on card x9876 at TOIT",
  received_at: "2026-11-20T15:30:00Z",
  status: "pending",
  parsed: true,
  amount: "1800.00",
  direction: "debit",
  suggested_kind: "expense",
  merchant: "TOIT",
  upi_ref: null,
  last4: "9876",
  occurred_at: "2026-11-20T15:30:00Z",
  source: { kind: "card", id: "c1", name: "Axis · Ace" },
  category: { id: "food", name: "Food", icon: "UtensilsCrossed", color: "#000000" },
  needs_review: false,
  note: null,
  duplicate_of_sms_id: null,
  duplicate_of_transaction_id: null,
  can_quick_approve: true,
};

const values = (patch: Partial<ApproveValues> = {}) => ({ ...initialApproveValues(SMS, TODAY), ...patch });

describe("initialApproveValues", () => {
  it("pre-fills from the parsed SMS (IST date, card, category, merchant)", () => {
    const v = initialApproveValues(SMS, TODAY);
    expect(v).toMatchObject({ as: "expense", amount: "1800.00", source: "card:c1", occurredOn: "2026-11-20", description: "TOIT", categoryId: "food", cardId: "c1" });
  });

  it("card bill SMS starts as a card payment", () => {
    expect(initialApproveValues({ ...SMS, suggested_kind: "card_payment" }, TODAY).as).toBe("card_payment");
  });
});

describe("buildApprove", () => {
  it("100% mine", () => {
    expect(buildApprove(values(), TODAY).input).toEqual({
      as: "expense",
      amount: "1800.00",
      occurred_on: "2026-11-20",
      description: "TOIT",
      source: { card_id: "c1" },
      direction: "debit",
      person_id: null,
      category_id: "food",
    });
  });

  it("with people, by percent", () => {
    const { input, errors } = buildApprove(
      values({ split: "people", splitUnit: "percent", people: [{ person_id: "ravi", value: "50" }] }),
      TODAY,
    );
    expect(errors).toEqual({});
    expect(input).toMatchObject({ shares: [{ person_id: "ravi", amount: "900.00" }] });
  });

  it("across categories must add up", () => {
    const parts = [
      { category_id: "food", amount: "1000" },
      { category_id: "drinks", amount: "800" },
    ];
    expect(buildApprove(values({ split: "categories", parts }), TODAY).input).toMatchObject({ parts: [{ amount: "1000.00" }, { amount: "800.00" }] });
    expect(buildApprove(values({ split: "categories", parts: [parts[0], { ...parts[1], amount: "100" }] }), TODAY).errors.split).toBe("₹700.00 still to assign.");
  });

  it("repayment and card bill need their accounts", () => {
    expect(buildApprove(values({ as: "repayment" }), TODAY).errors).toEqual({ personId: "Who paid you back?", fromAccountId: "Pick the account it arrived in." });
    expect(buildApprove(values({ as: "card_payment", fromAccountId: "a1" }), TODAY).input).toMatchObject({ as: "card_payment", from_account_id: "a1", card_id: "c1" });
  });

  it("rejects bad amounts and future dates", () => {
    expect(buildApprove(values({ amount: "abc", occurredOn: "2026-12-01" }), TODAY).errors).toMatchObject({
      amount: "Enter the amount, e.g. 450.",
      occurredOn: "Can't be in the future.",
    });
  });
});

it("inboxIsQuiet after 3 days without SMS", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  expect(inboxIsQuiet(null, now)).toBe(true);
  expect(inboxIsQuiet("2026-11-18T12:00:00Z", now)).toBe(false);
  expect(inboxIsQuiet("2026-11-17T11:00:00Z", now)).toBe(true);
});
