import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Card } from "./Card";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-line/70", className)} />;
}

export function StatCardSkeleton() {
  return (
    <Card flush className="flex items-center gap-4 p-4 sm:p-5">
      <Skeleton className="size-11 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-36" />
      </div>
    </Card>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-3.5">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Wrap skeletons in this so screen readers announce loading once. */
export function Loading({ label = "Loading", children }: { label?: string; children: ReactNode }) {
  return (
    <div role="status" aria-label={label}>
      {children}
    </div>
  );
}
