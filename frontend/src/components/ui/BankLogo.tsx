import { useState } from "react";

import { cn } from "../../lib/cn";
import { BankAvatar } from "./BankAvatar";

type BankLogoProps = {
  name: string;
  /** data: URL from the API, or null → monogram */
  logo: string | null;
  /** Tailwind size class, e.g. "size-9" or "size-11" */
  size?: string;
  className?: string;
};

/** The bank's stored logo on a white tile (keeps dark icons visible anywhere), or a monogram fallback. */
export function BankLogo({ name, logo, size = "size-11", className }: BankLogoProps) {
  const [broken, setBroken] = useState(false);
  if (!logo || broken) return <BankAvatar name={name || "?"} className={cn(size, className)} />;
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-xl bg-white p-1.5 shadow-sm ring-1 ring-ink/5", size, className)}>
      <img src={logo} alt="" className="size-full object-contain" onError={() => setBroken(true)} />
    </span>
  );
}
