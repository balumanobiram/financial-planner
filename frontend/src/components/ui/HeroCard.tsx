import { useId, type SVGProps } from "react";

import { cn } from "../../lib/cn";
import { Button } from "./Button";

type HeroCardProps = {
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onCta?: () => void;
  className?: string;
};

/** Dark gradient call-to-action card with a decorative ribbon shape. */
export function HeroCard({ title, subtitle, ctaLabel, onCta, className }: HeroCardProps) {
  return (
    <div
      className={cn(
        "relative isolate flex min-h-60 flex-col justify-end gap-5 overflow-hidden rounded-card p-6 text-white shadow-card",
        "bg-linear-to-br from-sidebar via-sidebar to-primary",
        className,
      )}
    >
      <RibbonShape className="pointer-events-none absolute -top-8 -left-10 -z-10 w-64" />
      <div>
        <h3 className="text-xl leading-snug font-bold text-balance">{title}</h3>
        {subtitle && <p className="mt-2 text-sm text-white/70">{subtitle}</p>}
      </div>
      {ctaLabel && (
        <Button variant="accent" size="lg" className="w-full" onClick={onCta}>
          {ctaLabel}
        </Button>
      )}
    </div>
  );
}

function RibbonShape(props: SVGProps<SVGSVGElement>) {
  const gradientId = useId();
  return (
    <svg viewBox="0 0 220 170" fill="none" aria-hidden {...props}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--secondary)" />
        </linearGradient>
      </defs>
      {Array.from({ length: 9 }, (_, i) => (
        <path
          key={i}
          d={`M${-10 + i * 6} ${125 - i * 4} C ${40 + i * 4} ${10 + i * 6}, ${115 + i * 3} ${150 - i * 5}, 225 ${30 + i * 7}`}
          stroke={`url(#${gradientId})`}
          strokeWidth={10 - i * 0.6}
          strokeLinecap="round"
          opacity={0.3 + i * 0.07}
        />
      ))}
    </svg>
  );
}
