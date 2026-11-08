import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Card } from "./Card";

type ChartCardProps = {
  title: string;
  subtitle?: string;
  /** Right-side control: a <PillSelect> or a <Button>. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function ChartCard({ title, subtitle, action, children, className }: ChartCardProps) {
  return (
    <Card className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </Card>
  );
}

type PillSelectProps<T extends string> = {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
};

/** Small "Monthly ▾" style dropdown (native <select>, so it's accessible and mobile-friendly). */
export function PillSelect<T extends string>({ label, value, options, onChange }: PillSelectProps<T>) {
  return (
    <label className="relative inline-flex">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-9 cursor-pointer appearance-none rounded-xl border border-line bg-surface pr-8 pl-3 text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-primary"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
    </label>
  );
}
