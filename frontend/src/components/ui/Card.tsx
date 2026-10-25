import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

/** The base white surface: 18px radius, soft shadow, no border. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card bg-surface p-5 shadow-card sm:p-6", className)} {...rest} />;
}
