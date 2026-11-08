import { CircleAlert, CircleCheck, X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

type NoticeProps = {
  tone?: "success" | "error";
  onDismiss?: () => void;
  children: ReactNode;
  className?: string;
};

/** Inline banner for the result of an action ("Reconciled…", "Couldn't archive…"). */
export function Notice({ tone = "success", onDismiss, children, className }: NoticeProps) {
  const Icon = tone === "success" ? CircleCheck : CircleAlert;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-xl px-4 py-3 text-sm font-medium",
        tone === "success" ? "bg-tint-blue text-tint-blue-fg" : "bg-pill-overdue text-pill-overdue-fg",
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-m-1 rounded-md p-1 opacity-70 hover:opacity-100">
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
