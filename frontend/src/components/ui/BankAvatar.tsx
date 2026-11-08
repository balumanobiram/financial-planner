import { cn } from "../../lib/cn";

const TINTS = [
  "bg-tint-indigo text-tint-indigo-fg",
  "bg-tint-sky text-tint-sky-fg",
  "bg-tint-blue text-tint-blue-fg",
  "bg-tint-cyan text-tint-cyan-fg",
];

/** "HDFC Bank" → "HB", "Paytm" → "PA". */
function bankInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Same bank name → same tint, every time. */
function tintFor(name: string): string {
  let hash = 0;
  for (const ch of name.trim().toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length];
}

/** Monogram badge for a bank (no external logo requests). */
export function BankAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("grid size-11 shrink-0 place-items-center rounded-full text-sm font-bold", tintFor(name), className)}
    >
      {bankInitials(name)}
    </span>
  );
}
