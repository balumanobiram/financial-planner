import { ChevronDown, CircleAlert, Landmark, Wallet } from "lucide-react";
import { useState } from "react";

import {
  useAccounts,
  useRefreshAccountLogo,
  useSetArchived,
  type BankAccount,
  type ReconcileResponse,
} from "../../api/accounts";
import { Page } from "../../components/layout/Page";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Notice } from "../../components/ui/Notice";
import { Loading, Skeleton, StatCardSkeleton } from "../../components/ui/Skeleton";
import { StatCard } from "../../components/ui/StatCard";
import { cn } from "../../lib/cn";
import { formatINRSigned } from "../../lib/money";
import { AccountCard } from "./AccountCard";
import { AccountFormModal, type AccountFormTarget } from "./AccountFormModal";
import { ReconcileModal } from "./ReconcileModal";

type PageNotice = { tone: "success" | "error"; text: string } | null;

function reconcileMessage({ account, adjustment }: ReconcileResponse): string {
  return adjustment
    ? `${account.nickname} reconciled — adjustment of ${formatINRSigned(adjustment.amount)} recorded.`
    : `${account.nickname} already matched your bank. Nothing changed.`;
}

export function AccountsPage() {
  const accounts = useAccounts();
  const setArchived = useSetArchived();
  const refreshLogo = useRefreshAccountLogo();
  const [formTarget, setFormTarget] = useState<AccountFormTarget>(null);
  const [reconciling, setReconciling] = useState<BankAccount | null>(null);
  const [notice, setNotice] = useState<PageNotice>(null);
  const [showArchived, setShowArchived] = useState(false);

  const items = accounts.data?.items ?? [];
  const active = items.filter((a) => !a.is_archived);
  const archived = items.filter((a) => a.is_archived);

  const toggleArchived = (account: BankAccount) =>
    setArchived.mutate(
      { id: account.id, archived: !account.is_archived },
      {
        onSuccess: (updated) =>
          setNotice({
            tone: "success",
            text: updated.is_archived
              ? `${updated.nickname} archived. It no longer counts towards your total.`
              : `${updated.nickname} is active again.`,
          }),
        onError: (error) => setNotice({ tone: "error", text: error.message }),
      },
    );

  const refresh = (account: BankAccount) =>
    refreshLogo.mutate(account.id, {
      onSuccess: (updated) =>
        setNotice(
          updated.logo_data_url
            ? { tone: "success", text: `Logo updated for ${updated.bank_name}.` }
            : { tone: "error", text: `Couldn't find a logo for ${updated.bank_name}. Add the bank's website in Edit and try again.` },
        ),
      onError: (error) => setNotice({ tone: "error", text: error.message }),
    });

  const busyId =
    (setArchived.isPending && setArchived.variables?.id) || (refreshLogo.isPending && refreshLogo.variables) || null;

  const renderCard = (account: BankAccount) => (
    <AccountCard
      key={account.id}
      account={account}
      busy={busyId === account.id}
      onReconcile={() => setReconciling(account)}
      onEdit={() => setFormTarget({ mode: "edit", account })}
      onArchiveToggle={() => toggleArchived(account)}
      onRefreshLogo={() => refresh(account)}
    />
  );

  return (
    <Page title="Accounts" onAdd={() => setFormTarget({ mode: "create" })} addLabel="Add account">
      <div className="space-y-6">
        {notice && (
          <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>
            {notice.text}
          </Notice>
        )}

        {accounts.isPending ? (
          <AccountsSkeleton />
        ) : accounts.isError ? (
          <Card>
            <EmptyState
              icon={CircleAlert}
              title="Couldn't load your accounts"
              description={accounts.error.message}
              action={<Button onClick={() => accounts.refetch()}>Try again</Button>}
            />
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <StatCard icon={Landmark} tint="indigo" label="Total balance" amount={accounts.data.total_balance} showDecimals />
              <StatCard icon={Wallet} tint="sky" label="Active accounts" value={active.length} />
            </div>

            {active.length === 0 ? (
              <Card>
                <EmptyState
                  icon={Landmark}
                  title={archived.length ? "No active accounts" : "No accounts yet"}
                  description="Add a bank account or wallet to start tracking balances."
                  action={<Button onClick={() => setFormTarget({ mode: "create" })}>Add account</Button>}
                />
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{active.map(renderCard)}</div>
            )}

            {archived.length > 0 && (
              <section className="space-y-4">
                <button
                  type="button"
                  onClick={() => setShowArchived(!showArchived)}
                  aria-expanded={showArchived}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
                >
                  <ChevronDown className={cn("size-4 transition-transform", showArchived && "rotate-180")} aria-hidden />
                  {showArchived ? "Hide" : "Show"} archived ({archived.length})
                </button>
                {showArchived && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{archived.map(renderCard)}</div>}
              </section>
            )}
          </>
        )}
      </div>

      <AccountFormModal
        target={formTarget}
        onClose={() => setFormTarget(null)}
        onSaved={(account) =>
          setNotice({ tone: "success", text: formTarget?.mode === "edit" ? `${account.nickname} updated.` : `${account.nickname} added.` })
        }
      />
      <ReconcileModal
        account={reconciling}
        onClose={() => setReconciling(null)}
        onDone={(result) => setNotice({ tone: "success", text: reconcileMessage(result) })}
      />
    </Page>
  );
}

function AccountsSkeleton() {
  return (
    <Loading label="Loading accounts">
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} flush className="space-y-4 p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="size-11 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-36" />
                </div>
              </div>
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-8 w-full" />
            </Card>
          ))}
        </div>
      </div>
    </Loading>
  );
}
