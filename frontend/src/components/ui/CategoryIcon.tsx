import { Tag } from "lucide-react";

import { cn } from "../../lib/cn";
import { CATEGORY_ICONS } from "../../lib/categoryIcons";

type Props = { icon: string; color: string; className?: string; size?: "sm" | "md" };

/** Coloured circle with the category's icon; the colour is a soft tint behind a full-strength glyph. */
export function CategoryIcon({ icon, color, className, size = "md" }: Props) {
  const Icon = CATEGORY_ICONS[icon] ?? Tag;
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full", size === "md" ? "size-10" : "size-8", className)}
      // 8-digit hex: the same colour at ~14% opacity for the background.
      style={{ backgroundColor: `${color}24`, color }}
    >
      <Icon className={size === "md" ? "size-4.5" : "size-4"} />
    </span>
  );
}
