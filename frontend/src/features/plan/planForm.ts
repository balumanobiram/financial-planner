/** Plan page logic without React: labels, colours, validation and the pie slices. */

import type { CategorySlice } from "../../api/dashboard";
import type { Plan, PlanGroup, PlanItemInput } from "../../api/plan";
import { fromPaise, normalizeMoneyInput, toPaise } from "../../lib/money";

export const GROUPS: Array<{ value: PlanGroup; label: string; hint: string; color: string }> = [
  { value: "needs", label: "Needs", hint: "Rent, groceries, EMI, bills", color: "#1f4fd1" },
  { value: "wants", label: "Wants", hint: "Eating out, shopping, fun", color: "#e0700f" },
  { value: "savings", label: "Savings", hint: "Emergency fund, goals", color: "#0e9fb8" },
  { value: "investments", label: "Investments", hint: "SIPs, stocks, PPF", color: "#7c3aed" },
];
export const LEFT_OVER_COLOR = "#cbd5e1";
export const groupInfo = (g: PlanGroup) => GROUPS.find((x) => x.value === g)!;

export type ItemValues = { name: string; amount: string; group: PlanGroup };
export type ItemErrors = Partial<Record<keyof ItemValues, string>>;

export function validateItem(values: ItemValues): { errors: ItemErrors; input: PlanItemInput | null } {
  const errors: ItemErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = "Give it a name, e.g. Rent.";
  else if (name.length > 100) errors.name = "Keep it under 100 characters.";
  const amount = normalizeMoneyInput(values.amount);
  if (amount === null || toPaise(amount) <= 0n) errors.amount = "Enter an amount like 18000.";
  return Object.keys(errors).length ? { errors, input: null } : { errors, input: { name, amount: amount!, group: values.group } };
}

/** Salary input: empty means 0. */
export function salaryInput(raw: string): string | null {
  if (!raw.trim()) return "0.00";
  const amount = normalizeMoneyInput(raw);
  return amount !== null && toPaise(amount) >= 0n ? amount : null;
}

const pct = (part: bigint, whole: bigint) => (whole > 0n ? ((Number(part) * 100) / Number(whole)).toFixed(1) : "0.0");

/**
 * Where the salary goes, by group, plus what's left (only when positive). Shares are of the salary;
 * if you've planned more than you earn, they're of what's planned instead (a pie can't go past 100%).
 */
export function groupSlices(plan: Plan): { slices: CategorySlice[]; total: string } {
  const amounts = plan.groups.map((g) => ({ ...groupInfo(g.group), paise: toPaise(g.amount) })).filter((g) => g.paise > 0n);
  const left = toPaise(plan.left_over);
  const parts = left > 0n ? [...amounts, { value: "left", label: "Left over", color: LEFT_OVER_COLOR, paise: left }] : amounts;
  const whole = parts.reduce((sum, p) => sum + p.paise, 0n);
  return {
    total: fromPaise(whole),
    slices: parts.map((p) => ({ category_id: p.value, name: p.label, icon: "", color: p.color, amount: fromPaise(p.paise), percent: pct(p.paise, whole) })),
  };
}

/** Each line as its own slice, in its group's colour (lighter shades for later lines in the same group). */
export function itemSlices(plan: Plan): { slices: CategorySlice[]; total: string } {
  const whole = toPaise(plan.planned);
  const order = (g: PlanGroup) => GROUPS.findIndex((x) => x.value === g);
  const seen: Partial<Record<PlanGroup, number>> = {};
  const sorted = [...plan.items].sort((a, b) => order(a.group) - order(b.group));
  return {
    total: plan.planned,
    slices: sorted.map((item) => {
      const n = (seen[item.group] ?? -1) + 1;
      seen[item.group] = n;
      return {
        category_id: item.id,
        name: item.name,
        icon: "",
        color: shade(groupInfo(item.group).color, n),
        amount: item.amount,
        percent: pct(toPaise(item.amount), whole),
      };
    }),
  };
}

/** Same hue, mixed towards white for the 2nd, 3rd… line in a group (at most 60% lighter). */
export function shade(hex: string, step: number): string {
  const mix = Math.min(step * 0.18, 0.6);
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    return Math.round(c + (255 - c) * mix)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}
