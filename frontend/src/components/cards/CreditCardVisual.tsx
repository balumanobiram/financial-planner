import { Nfc } from "lucide-react";
import { useId, type CSSProperties } from "react";

import type { CardNetwork } from "../../api/cards";
import { cn } from "../../lib/cn";
import { isHexColor, readableTextOn, shade } from "../../lib/color";
import { BankLogo } from "../ui/BankLogo";
import { NetworkMark } from "./NetworkMark";

export type CardVisualData = {
  bank_name: string;
  card_name: string;
  network: CardNetwork;
  last4: string | null;
  color: string;
  logo_data_url: string | null;
};

/** A physical-card look-alike: real card proportions (85.6 × 54 mm ≈ 1.586:1), your colour, bank logo, network. */
export function CreditCardVisual({ card, className }: { card: CardVisualData; className?: string }) {
  const color = isHexColor(card.color) ? card.color.toLowerCase() : "#1a1a2e";
  const text = readableTextOn(color);
  const style: CSSProperties = {
    color: text,
    backgroundImage: [
      // soft sheen from the top-left, like light on a real card
      "radial-gradient(120% 90% at 0% 0%, rgb(255 255 255 / 0.22), transparent 55%)",
      `linear-gradient(135deg, ${shade(color, 0.08)} 0%, ${color} 45%, ${shade(color, -0.35)} 100%)`,
    ].join(", "),
  };

  return (
    <div
      role="img"
      aria-label={`${card.bank_name} ${card.card_name}${card.last4 ? ` ending ${card.last4}` : ""}`}
      className={cn("relative isolate aspect-[1.586] w-full overflow-hidden rounded-2xl p-4 shadow-lg shadow-ink/15 select-none sm:p-5", className)}
      style={style}
    >
      {/* subtle decorative arcs */}
      <svg aria-hidden viewBox="0 0 200 126" className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-[0.12]" preserveAspectRatio="none">
        <circle cx="185" cy="-10" r="80" fill="none" stroke="currentColor" strokeWidth="1" />
        <circle cx="185" cy="-10" r="100" fill="none" stroke="currentColor" strokeWidth="1" />
      </svg>

      <div className="flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <BankLogo name={card.bank_name} logo={card.logo_data_url} size="size-9" className="rounded-lg p-1 text-xs" />
            <span className="truncate text-sm font-semibold">{card.bank_name || "Bank"}</span>
          </div>
          <Nfc className="size-5 shrink-0 rotate-90 opacity-70" aria-hidden />
        </div>

        <Chip />

        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium opacity-80">{card.card_name || "Card name"}</p>
            <p className="mt-0.5 text-lg font-semibold tracking-[0.18em] tabular-nums">•••• {card.last4 ?? "••••"}</p>
          </div>
          <NetworkMark network={card.network} className="shrink-0" />
        </div>
      </div>
    </div>
  );
}


function Chip() {
  const gradientId = useId();
  return (
    <svg aria-hidden viewBox="0 0 40 30" className="h-7 w-9 sm:h-8 sm:w-10">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3dc9a" />
          <stop offset="1" stopColor="#c9a24a" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="39" height="29" rx="5" fill={`url(#${gradientId})`} stroke="#a8842f" strokeOpacity="0.5" />
      <path d="M0 10h13M0 20h13M27 10h13M27 20h13M13 0v30M27 0v30" stroke="#a8842f" strokeOpacity="0.55" strokeWidth="1" fill="none" />
    </svg>
  );
}
