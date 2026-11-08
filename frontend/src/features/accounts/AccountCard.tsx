import { Archive, ArchiveRestore, ImageDown, List, Pencil, RefreshCcw, Upload } from "lucide-react";
import { Link } from "react-router";

import { accountTypeLabel, type BankAccount } from "../../api/accounts";
import { BankLogo } from "../../components/ui/BankLogo";
import { Button, IconButton } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Money } from "../../components/ui/Money";
import { cn } from "../../lib/cn";

type Props = {
  account: BankAccount;
  busy?: boolean;
  onReconcile: () => void;
  onEdit: () => void;
  onArchiveToggle: () => void;
  onRefreshLogo: () => void;
};

export function AccountCard({ account, busy = false, onReconcile, onEdit, onArchiveToggle, onRefreshLogo }: Props) {
  const archived = account.is_archived;

  return (
    <Card flush className={cn("flex flex-col gap-4 p-5", archived && "opacity-75")}>
      <div className="flex items-start gap-3">
        <BankLogo name={account.bank_name} logo={account.logo_data_url} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{account.nickname}</p>
          <p className="truncate text-sm text-muted">
            {account.bank_name}
            {account.last4 && <span className="tabular-nums"> · •••• {account.last4}</span>}
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-muted">
          {archived ? "Archived" : accountTypeLabel(account.account_type)}
        </span>
      </div>

      <div>
        <p className="text-xs font-medium text-muted">Current balance</p>
        <p className="mt-0.5 text-2xl leading-tight font-bold">
          <Money value={account.current_balance} />
        </p>
      </div>

      <div className="mt-auto flex items-center gap-1 border-t border-line pt-3">
        {archived ? (
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={onArchiveToggle}
            icon={<ArchiveRestore className="size-3.5" aria-hidden />}
          >
            Unarchive
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={onReconcile} icon={<RefreshCcw className="size-3.5" aria-hidden />}>
              Reconcile
            </Button>
            <div className="ml-auto flex">
              <Link
                to={`/transactions?account_id=${account.id}`}
                aria-label={`${account.nickname} transactions`}
                title="Transactions"
                className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-muted hover:text-ink"
              >
                <List className="size-4" aria-hidden />
              </Link>
              <Link
                to={`/import?account_id=${account.id}`}
                aria-label={`Import statement for ${account.nickname}`}
                title="Import statement"
                className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-muted hover:text-ink"
              >
                <Upload className="size-4" aria-hidden />
              </Link>
              <IconButton
                label={account.logo_data_url ? "Refresh bank logo" : "Fetch bank logo"}
                icon={<ImageDown className="size-4" aria-hidden />}
                onClick={onRefreshLogo}
                disabled={busy}
              />
              <IconButton label={`Edit ${account.nickname}`} icon={<Pencil className="size-4" aria-hidden />} onClick={onEdit} />
              <IconButton
                label={`Archive ${account.nickname}`}
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
