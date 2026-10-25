import { cn } from "../../lib/cn";

export type Status = "overdue" | "paid" | "partpaid" | "duesoon" | "open";

const styles: Record<Status, { className: string; label: string }> = {
  overdue: { className: "bg-pill-overdue text-pill-overdue-fg", label: "Overdue" },
  paid: { className: "bg-pill-paid text-pill-paid-fg", label: "Paid" },
  partpaid: { className: "bg-pill-partpaid text-pill-partpaid-fg", label: "Part paid" },
  duesoon: { className: "bg-pill-duesoon text-pill-duesoon-fg", label: "Due soon" },
  open: { className: "bg-surface-muted text-muted ring-1 ring-line", label: "Open" },
};

export function StatusPill({ status, className }: { status: Status; className?: string }) {
  const { className: colors, label } = styles[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10.5px] leading-4 font-bold whitespace-nowrap",
        colors,
        className,
      )}
    >
      {label}
    </span>
  );
}
