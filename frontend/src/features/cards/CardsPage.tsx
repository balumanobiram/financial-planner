import { CalendarClock, ChevronDown, CircleAlert, CreditCard as CardIcon } from "lucide-react";
import { useState } from "react";

import { useCards, useRefreshLogo, useSetCardArchived, type CreditCard } from "../../api/cards";
import { Page } from "../../components/layout/Page";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Notice } from "../../components/ui/Notice";
import { Loading, Skeleton, StatCardSkeleton } from "../../components/ui/Skeleton";
import { StatCard } from "../../components/ui/StatCard";
import { cn } from "../../lib/cn";
import { formatDateShort } from "../../lib/dates";
import { CardFormModal, type CardFormTarget } from "./CardFormModal";
import { CardTile } from "./CardTile";
import { DUE_SOON_DAYS } from "./cardForm";
import { useQuickAdd } from "../transactions/quickAddContext";
import { toPaise } from "../../lib/money";

type PageNotice = { tone: "success" | "error"; text: string } | null;

export function CardsPage() {
  const cards = useCards();
  const setArchived = useSetCardArchived();
  const refreshLogo = useRefreshLogo();
  const quickAdd = useQuickAdd();
  const [formTarget, setFormTarget] = useState<CardFormTarget>(null);
  const [notice, setNotice] = useState<PageNotice>(null);
  const [showArchived, setShowArchived] = useState(false);

  const items = cards.data?.items ?? [];
  const active = items.filter((c) => !c.is_archived); // already sorted by pay-by date
  const archived = items.filter((c) => c.is_archived);
  const next = active[0];
  const dueSoon = active.filter((c) => c.billing.days_until_pay_by <= DUE_SOON_DAYS).length;

  const onError = (error: Error) => setNotice({ tone: "error", text: error.message });

  const toggleArchived = (card: CreditCard) =>
    setArchived.mutate(
      { id: card.id, archived: !card.is_archived },
      {
        onSuccess: (updated) =>
          setNotice({ tone: "success", text: `${updated.card_name} ${updated.is_archived ? "archived" : "is active again"}.` }),
        onError,
      },
    );

  const refresh = (card: CreditCard) =>
    refreshLogo.mutate(card.id, {
      onSuccess: (updated) =>
        setNotice(
          updated.logo_data_url
            ? { tone: "success", text: `Logo updated for ${updated.bank_name}.` }
            : {
                tone: "error",
                text: `Couldn't find a logo for ${updated.bank_name}. Add the bank's website in Edit and try again.`,
              },
        ),
      onError,
    });

  const busyId =
    (setArchived.isPending && setArchived.variables?.id) || (refreshLogo.isPending && refreshLogo.variables) || null;

  const renderTile = (card: CreditCard) => (
    <CardTile
      key={card.id}
      card={card}
      busy={busyId === card.id}
      onEdit={() => setFormTarget({ mode: "edit", card })}
      onArchiveToggle={() => toggleArchived(card)}
      onRefreshLogo={() => refresh(card)}
      onPay={() => quickAdd({ type: "card_payment", card: card.id, amount: toPaise(card.outstanding) > 0n ? card.outstanding : "" })}
    />
  );

  return (
    <Page title="Cards" onAdd={() => setFormTarget({ mode: "create" })} addLabel="Add card">
      <div className="space-y-6">
        {notice && (
          <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>
            {notice.text}
          </Notice>
        )}

        {cards.isPending ? (
          <CardsSkeleton />
        ) : cards.isError ? (
          <Card>
            <EmptyState
              icon={CircleAlert}
              title="Couldn't load your cards"
              description={cards.error.message}
              action={<Button onClick={() => cards.refetch()}>Try again</Button>}
            />
          </Card>
        ) : (
          <>
            {active.length > 0 && next && (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <StatCard
                  icon={CalendarClock}
                  tint="sky"
                  label={`Next payment · ${next.card_name}`}
                  value={formatDateShort(next.billing.pay_by)}
                />
                <StatCard icon={CardIcon} tint="indigo" label={`Due within ${DUE_SOON_DAYS} days`} value={`${dueSoon} of ${active.length}`} />
              </div>
            )}

            {active.length === 0 ? (
              <Card>
                <EmptyState
                  icon={CardIcon}
                  title={archived.length ? "No active cards" : "No credit cards yet"}
                  description="Add a card with its statement day and days to pay — we'll work out every due date."
                  action={<Button onClick={() => setFormTarget({ mode: "create" })}>Add card</Button>}
                />
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{active.map(renderTile)}</div>
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
                {showArchived && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{archived.map(renderTile)}</div>}
              </section>
            )}
          </>
        )}
      </div>

      <CardFormModal
        target={formTarget}
        onClose={() => setFormTarget(null)}
        onSaved={(card) =>
          setNotice({
            tone: "success",
            text:
              formTarget?.mode === "edit"
                ? `${card.card_name} updated.`
                : `${card.card_name} added — pay by ${formatDateShort(card.billing.pay_by)}.${card.logo_data_url ? "" : " No logo found; you can add the bank website in Edit."}`,
          })
        }
      />
    </Page>
  );
}

function CardsSkeleton() {
  return (
    <Loading label="Loading cards">
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} flush className="space-y-4 p-4">
              <Skeleton className="aspect-[1.586] w-full rounded-2xl" />
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-10 w-full" />
            </Card>
          ))}
        </div>
      </div>
    </Loading>
  );
}
