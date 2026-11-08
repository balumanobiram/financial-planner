import { cn } from "../../lib/cn";
import { balanceChip } from "./peopleForms";

const tones = {
  owes: "bg-tint-blue text-tint-blue-fg",
  settled: "bg-surface-muted text-muted",
  credit: "bg-pill-duesoon text-pill-duesoon-fg",
} as const;

/** "Owes you ₹1,500.00" / "Settled up" / "You owe ₹300.00" */
export function BalanceChip({ outstanding, className }: { outstanding: string; className?: string }) {
  const { label, tone } = balanceChip(outstanding);
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap tabular-nums", tones[tone], className)}>
      {label}
    </span>
  );
}
