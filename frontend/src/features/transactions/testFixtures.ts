import type { Transaction } from "../../api/transactions";

/** A card expense: ₹450 at Swiggy on 25 Oct (IST). Override any field. */
export function txn(over: Partial<Transaction> = {}): Transaction {
  return {
    id: "t1",
    type: "expense",
    direction: "debit",
    amount: "-450.00",
    occurred_at: "2026-10-24T18:30:00Z", // 25 Oct 00:00 IST
    description: "Swiggy",
    tags: ["work"],
    source: { kind: "card", id: "c1", name: "HDFC Regalia" },
    counterpart: null,
    category: { id: "food", name: "Food", icon: "UtensilsCrossed", color: "#ea580c" },
    person: null,
    shares: [],
    link_id: null,
    created_at: "2026-10-24T18:30:00Z",
    updated_at: "2026-10-24T18:30:00Z",
    ...over,
  };
}
