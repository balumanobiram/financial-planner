import { describe, expect, it } from "vitest";

import type { CardDue } from "../../api/dashboard";
import { changeValue, daysLeftLabel, heroText, insightsChartData, rupees, spendChangeTone, weekChartData } from "./dashboardView";

const due: CardDue = {
  card_id: "c1", card_name: "Regalia", bank_name: "HDFC Bank", last4: "4321", color: "#111", status: "partpaid",
  amount: "3000.00", statement_balance: "5000.00", paid_since_statement: "2000.00", outstanding: "4200.00",
  due_date: "2026-11-01", days_left: 4,
};

describe("labels", () => {
  it.each([
    [-3, "3 days overdue"],
    [-1, "1 day overdue"],
    [0, "Due today"],
    [1, "Due tomorrow"],
    [4, "Due in 4 days"],
  ])("%d → %s", (days, label) => {
    expect(daysLeftLabel(days)).toBe(label);
  });

  it("hero text", () => {
    expect(heroText(due)).toEqual({ title: "₹3,000.00", subtitle: "Regalia ••4321 · Due in 4 days, 1 Nov · part paid" });
    expect(heroText({ ...due, last4: null, status: "duesoon" }).subtitle).toBe("Regalia · Due in 4 days, 1 Nov");
  });
});

it("changeValue / rupees", () => {
  expect(changeValue("-12.5")).toBe(-12.5);
  expect(changeValue(null)).toBeUndefined();
  expect(rupees("1234.56")).toBe(1234.56);
  expect(rupees("-0.10")).toBe(-0.1);
});

it("insights chart data", () => {
  expect(insightsChartData([{ month: "2026-10-01", inflow: "500.00", outflow: "6399.00" }])).toEqual([{ label: "Oct", inflow: 500, outflow: 6399 }]);
});

it("week chart data marks today and the future, and floors refund days at 0", () => {
  const days = ["26", "27", "28", "29", "30", "31"].map((d) => `2026-10-${d}`).concat("2026-11-01");
  const week = { days: days.map((day, i) => ({ day, amount: ["500.00", "-100.00", "1200.00"][i] ?? "0.00" })), total: "1600.00", last_week_total: "700.00", change_pct: "128.6" };
  const bars = weekChartData(week, "2026-10-28");
  expect(bars.map((b) => b.label)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  expect(bars.slice(0, 4).map((b) => [b.value, b.isToday, b.isFuture])).toEqual([
    [500, false, false],
    [0, false, false],
    [1200, true, false],
    [0, false, true],
  ]);
});

it("spending up is the bad direction", () => {
  expect(spendChangeTone("128.6")).toBe("up");
  expect(spendChangeTone("-5.0")).toBe("down");
  expect(spendChangeTone(null)).toBe("none");
});
