import { ArrowLeftRight, CreditCard, Scale, HandCoins } from "lucide-react";

import type { Transaction } from "../../api/transactions";
import { CategoryIcon } from "../../components/ui/CategoryIcon";
import { cn } from "../../lib/cn";
import { rowText } from "./transactionList";

const KIND_ICON = {
  transfer: ArrowLeftRight,
  card_payment: CreditCard,
  settlement: HandCoins,
  adjustment: Scale,
} as const;

/** One tappable line in the list: icon, what/where, amount. */
export function TransactionRow({ txn, filteredBySource, onOpen }: { txn: Transaction; filteredBySource: boolean; onOpen: () => void }) {
  const text = rowText(txn, filteredBySource);
  const KindIcon = txn.type in KIND_ICON ? KIND_ICON[txn.type as keyof typeof KIND_ICON] : null;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary"
      >
        {txn.category ? (
          <CategoryIcon icon={txn.category.icon} color={txn.category.color} />
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-tint-blue text-tint-blue-fg" aria-hidden>
            {KindIcon ? <KindIcon className="size-4.5" /> : <span className="text-sm font-bold">?</span>}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{text.title}</span>
          <span className="block truncate text-xs text-muted">{text.subtitle}</span>
          {txn.tags.length > 0 && (
            <span className="mt-1 flex gap-1 overflow-hidden">
              {txn.tags.map((tag) => (
                <span key={tag} className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-muted">
                  #{tag}
                </span>
              ))}
            </span>
          )}
        </span>
        <span className={cn("shrink-0 font-semibold tabular-nums", text.tone === "in" && "text-positive")}>{text.amount}</span>
      </button>
    </li>
  );
}
