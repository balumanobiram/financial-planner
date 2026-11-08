import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Card } from "./Card";
import { Money } from "./Money";

export type Tint = "indigo" | "sky" | "blue" | "cyan";

const tints: Record<Tint, string> = {
  indigo: "bg-tint-indigo text-tint-indigo-fg",
  sky: "bg-tint-sky text-tint-sky-fg",
  blue: "bg-tint-blue text-tint-blue-fg",
  cyan: "bg-tint-cyan text-tint-cyan-fg",
};

type StatCardProps = {
  icon: LucideIcon;
  tint?: Tint;
  label: string;
  /** Money as a decimal string — rendered with ₹ and Indian grouping. */
  amount?: string;
  /** Anything else (counts etc.) when it isn't money. */
  value?: ReactNode;
  showDecimals?: boolean;
  /** Percentage change, e.g. 3.6 or -2.05. */
  change?: number;
  /** Which direction is good news (colours the chip). Card dues going up is bad: "down". */
  goodWhen?: "up" | "down";
  /** Below lg: a compact tile (icon + chip on top, label and amount under) for 2×2 grids on phones. */
  tileOnMobile?: boolean;
  className?: string;
};

export function StatCard({
  icon: Icon,
  tint = "blue",
  label,
  amount,
  value,
  showDecimals = false,
  change,
  goodWhen = "up",
  tileOnMobile = false,
  className,
}: StatCardProps) {
  const chip = change !== undefined && <ChangeChip value={change} goodWhen={goodWhen} />;
  return (
    <Card flush className={cn("flex items-center gap-4 p-4 sm:p-5", tileOnMobile && "max-lg:flex-col max-lg:items-stretch max-lg:gap-2", className)}>
      <div className={cn("flex items-center justify-between gap-2", !tileOnMobile && "contents")}>
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-full", tints[tint])}>
          <Icon className="size-5" aria-hidden />
        </span>
        {tileOnMobile && <span className="lg:hidden">{chip}</span>}
      </div>
      <div className="min-w-0 flex-1">
        {/* Chip shares the label row so the amount gets the card's full width. */}
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[13px] font-medium text-muted">{label}</p>
          {chip && <span className={cn(tileOnMobile && "max-lg:hidden")}>{chip}</span>}
        </div>
        <p className="mt-0.5 truncate text-2xl leading-tight font-bold tabular-nums">
          {amount !== undefined ? <Money value={amount} showDecimals={showDecimals} /> : value}
        </p>
      </div>
    </Card>
  );
}

export function ChangeChip({ value, goodWhen = "up" }: { value: number; goodWhen?: "up" | "down" }) {
  const up = value >= 0;
  const good = value === 0 || up === (goodWhen === "up");
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
        good ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative",
      )}
    >
      {up ? "+" : "−"}
      {Math.abs(value).toFixed(1)}%
      <Icon className="size-3" aria-hidden />
    </span>
  );
}
