import { ChevronDown, ChevronRight, CircleAlert, HandCoins, Receipt, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { usePeople, type Person } from "../../api/people";
import { Page } from "../../components/layout/Page";
import { BankAvatar } from "../../components/ui/BankAvatar";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Notice } from "../../components/ui/Notice";
import { ListSkeleton, Loading, StatCardSkeleton } from "../../components/ui/Skeleton";
import { StatCard } from "../../components/ui/StatCard";
import { cn } from "../../lib/cn";
import { toPaise } from "../../lib/money";
import { BalanceChip } from "./BalanceChip";
import { PersonFormModal, type PersonFormTarget } from "./PersonFormModal";
import { SplitBillModal } from "./SplitBillModal";

export function PeoplePage() {
  const people = usePeople();
  const [formTarget, setFormTarget] = useState<PersonFormTarget>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const items = people.data?.items ?? [];
  const active = items.filter((p) => !p.is_archived); // API: most owed first
  const archived = items.filter((p) => p.is_archived);
  const owingCount = active.filter((p) => toPaise(p.totals.outstanding) > 0n).length;

  return (
    <Page
      title="People"
      onAdd={() => setFormTarget({ mode: "create" })}
      addLabel="Add person"
      actions={
        active.length > 0 && (
          <Button variant="secondary" onClick={() => setSplitOpen(true)} icon={<Receipt className="size-4" aria-hidden />}>
            <span className="hidden sm:inline">Split a bill</span>
            <span className="sm:hidden">Split</span>
          </Button>
        )
      }
    >
      <div className="space-y-6">
        {notice && <Notice onDismiss={() => setNotice(null)}>{notice}</Notice>}

        {people.isPending ? (
          <Loading label="Loading people">
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <StatCardSkeleton />
              </div>
              <Card>
                <ListSkeleton rows={4} />
              </Card>
            </div>
          </Loading>
        ) : people.isError ? (
          <Card>
            <EmptyState
              icon={CircleAlert}
              title="Couldn't load people"
              description={people.error.message}
              action={<Button onClick={() => people.refetch()}>Try again</Button>}
            />
          </Card>
        ) : active.length === 0 ? (
          <Card>
            <EmptyState
              icon={Users}
              title={archived.length ? "No active people" : "No one here yet"}
              description="Add people who send you money or share bills — dad, mom, friends — and we'll track who owes what."
              action={<Button onClick={() => setFormTarget({ mode: "create" })}>Add person</Button>}
            />
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <StatCard icon={HandCoins} tint="blue" label="Owed to you" amount={people.data.total_outstanding} showDecimals />
              <StatCard icon={Users} tint="indigo" label="People who owe you" value={`${owingCount} of ${active.length}`} />
            </div>
            <Card flush className="p-2">
              <ul className="divide-y divide-line">
                {active.map((p) => (
                  <PersonRow key={p.id} person={p} />
                ))}
              </ul>
            </Card>
          </>
        )}

        {archived.length > 0 && (
          <section className="space-y-3">
            <button
              type="button"
              onClick={() => setShowArchived(!showArchived)}
              aria-expanded={showArchived}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
            >
              <ChevronDown className={cn("size-4 transition-transform", showArchived && "rotate-180")} aria-hidden />
              {showArchived ? "Hide" : "Show"} archived ({archived.length})
            </button>
            {showArchived && (
              <Card flush className="p-2 opacity-75">
                <ul className="divide-y divide-line">
                  {archived.map((p) => (
                    <PersonRow key={p.id} person={p} />
                  ))}
                </ul>
              </Card>
            )}
          </section>
        )}
      </div>

      <PersonFormModal target={formTarget} onClose={() => setFormTarget(null)} onSaved={(p) => setNotice(`${p.name} added.`)} />
      <SplitBillModal open={splitOpen} onClose={() => setSplitOpen(false)} onDone={setNotice} />
    </Page>
  );
}

function PersonRow({ person }: { person: Person }) {
  return (
    <li>
      <Link
        to={`/people/${person.id}`}
        className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary"
      >
        <BankAvatar name={person.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{person.name}</p>
          <p className="truncate text-sm text-muted">{person.relation ?? "—"}</p>
        </div>
        <BalanceChip outstanding={person.totals.outstanding} />
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  );
}
