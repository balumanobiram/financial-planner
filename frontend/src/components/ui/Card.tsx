import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  /**
   * No built-in padding — set your own in className. (cn() only joins classes, so a
   * className "p-2" can't reliably override the default "p-5 sm:p-6": CSS order decides.)
   */
  flush?: boolean;
};

/** The base white surface: 18px radius, soft shadow, no border. */
export function Card({ className, flush = false, ...rest }: CardProps) {
  return <div className={cn("rounded-card bg-surface shadow-card", !flush && "p-5 sm:p-6", className)} {...rest} />;
}
