import { useInboxSummary } from "../../api/inbox";
import { cn } from "../../lib/cn";

/** Pending-SMS count next to "Inbox" in the sidebar and tab bar. Renders nothing for other items. */
export function NavBadge({ to, className }: { to: string; className?: string }) {
  if (to !== "/inbox") return null;
  return <InboxCount className={className} />;
}

function InboxCount({ className }: { className?: string }) {
  const summary = useInboxSummary();
  const count = summary.data?.pending_count ?? 0;
  if (count === 0) return null;
  return (
    <span
      aria-label={`${count} to review`}
      className={cn("grid h-5 min-w-5 place-items-center rounded-full bg-negative px-1.5 text-[11px] leading-none font-bold text-white tabular-nums", className)}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
