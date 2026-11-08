import { Archive, ArchiveRestore, CalendarClock, ImageDown, List, Pencil, Upload, Wallet } from "lucide-react";
import { Link } from "react-router";

import type { CreditCard } from "../../api/cards";
import { CreditCardVisual } from "../../components/cards/CreditCardVisual";
import { Button, IconButton } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Money } from "../../components/ui/Money";
import { StatusPill } from "../../components/ui/StatusPill";
import { cn } from "../../lib/cn";
import { formatDateShort } from "../../lib/dates";
import { dueStatus, ordinal } from "./cardForm";

type Props = {
  card: CreditCard;
  busy?: boolean;
  onEdit: () => void;
  onArchiveToggle: () => void;
  onRefreshLogo: () => void;
  onPay: () => void;
};

export function CardTile({ card, busy = false, onEdit, onArchiveToggle, onRefreshLogo, onPay }: Props) {
  const { billing } = card;
  const status = dueStatus(billing.days_until_pay_by);
  const archived = card.is_archived;

  return (
    <Card flush className={cn("flex flex-col gap-4 p-4", archived && "opacity-75")}>
      <CreditCardVisual card={card} />

      {archived ? (
        <p className="px-1 text-sm text-muted">Archived — not shown in due dates.</p>
      ) : (
        <div className="space-y-3 px-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted">Pay by</p>
              <p className="text-xl leading-tight font-bold">{formatDateShort(billing.pay_by)}</p>
              <p className="mt-0.5 text-xs text-muted">{status.label}</p>
            </div>
            {status.pill && <StatusPill status={status.pill} className="mt-1" />}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 text-sm">
            <div>
              <dt className="text-xs text-muted">Outstanding</dt>
              <dd className="font-semibold">
                <Money value={card.outstanding} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Available</dt>
              <dd className="font-medium">
                {card.available_credit ? <Money value={card.available_credit} showDecimals={false} /> : <span className="text-muted">Set a limit</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Next statement</dt>
              <dd className="font-medium">{formatDateShort(billing.next_statement_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Cycle</dt>
              <dd className="font-medium">
                {ordinal(card.statement_day)} + {card.payment_due_days} days
              </dd>
            </div>
            {card.credit_limit && (
              <div className="col-span-2">
                <dt className="text-xs text-muted">Credit limit</dt>
                <dd className="font-medium">
                  <Money value={card.credit_limit} showDecimals={false} />
                </dd>
              </div>
            )}
          </dl>

          <div className="flex gap-2">
            <Button size="sm" onClick={onPay} icon={<Wallet className="size-3.5" aria-hidden />}>
              Pay bill
            </Button>
            <Link
              to={`/transactions?card_id=${card.id}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-surface-muted px-3 text-xs font-semibold hover:bg-line"
            >
              <List className="size-3.5" aria-hidden />
              Transactions
            </Link>
            <Link
              to={`/import?card_id=${card.id}`}
              aria-label={`Import statement for ${card.card_name}`}
              title="Import statement"
              className="inline-flex h-8 items-center rounded-xl bg-surface-muted px-2.5 hover:bg-line"
            >
              <Upload className="size-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center gap-1 border-t border-line px-1 pt-3">
        {archived ? (
          <Button variant="secondary" size="sm" loading={busy} onClick={onArchiveToggle} icon={<ArchiveRestore className="size-3.5" aria-hidden />}>
            Unarchive
          </Button>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <CalendarClock className="size-3.5" aria-hidden />
              Last statement {formatDateShort(billing.last_statement_date)}
            </span>
            <div className="ml-auto flex">
              <IconButton
                label={card.logo_data_url ? "Refresh bank logo" : "Try fetching bank logo again"}
                icon={<ImageDown className="size-4" aria-hidden />}
                onClick={onRefreshLogo}
                disabled={busy}
              />
              <IconButton label={`Edit ${card.card_name}`} icon={<Pencil className="size-4" aria-hidden />} onClick={onEdit} />
              <IconButton
                label={`Archive ${card.card_name}`}
                icon={<Archive className="size-4" aria-hidden />}
                onClick={onArchiveToggle}
                disabled={busy}
              />
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
