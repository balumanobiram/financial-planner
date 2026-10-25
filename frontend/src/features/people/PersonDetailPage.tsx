import {
  Archive,
  ArchiveRestore,
  ArrowDownLeft,
  ArrowLeft,
  CircleAlert,
  Gift,
  HandCoins,
  Pencil,
  Receipt,
  Trash2,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { usePerson, useSetPersonArchived, type HistoryEntry } from "../../api/people";
import { useDeleteTransaction } from "../../api/transactions";
import { Page } from "../../components/layout/Page";
import { Button, IconButton } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { EmptyState } from "../../components/ui/EmptyState";
import { Money } from "../../components/ui/Money";
import { Notice } from "../../components/ui/Notice";
import { ListSkeleton, Loading, StatCardSkeleton } from "../../components/ui/Skeleton";
import { StatCard } from "../../components/ui/StatCard";
import { StatusPill } from "../../components/ui/StatusPill";
import { cn } from "../../lib/cn";
import { formatTimestampDate } from "../../lib/dates";
import { formatINR } from "../../lib/money";
import { BalanceChip } from "./BalanceChip";
import { PersonFormModal, type PersonFormTarget } from "./PersonFormModal";
import { RecordPaymentModal } from "./RecordPaymentModal";
import { SplitBillModal } from "./SplitBillModal";

type PageNotice = { tone: "success" | "error"; text: string } | null;

const TYPE_META = {
  shared_expense: { label: "Shared expense", icon: Receipt, tint: "bg-tint-indigo text-tint-indigo-fg" },
  settlement: { label: "Paid back", icon: ArrowDownLeft, tint: "bg-tint-blue text-tint-blue-fg" },
  income: { label: "Gift / income", icon: Gift, tint: "bg-tint-cyan text-tint-cyan-fg" },
} as const;

export function PersonDetailPage() {
  const { personId = "" } = useParams();
  const person = usePerson(personId);
  const setArchived = useSetPersonArchived();
  const deleteTxn = useDeleteTransaction();
  const [paying, setPaying] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [editTarget, setEditTarget] = useState<PersonFormTarget>(null);
  const [deleting, setDeleting] = useState<HistoryEntry | null>(null);
  const [notice, setNotice] = useState<PageNotice>(null);

  const back = (
    <Link to="/people" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
      <ArrowLeft className="size-4" aria-hidden />
      People
    </Link>
  );

  if (person.isPending) {
    return (
      <Page title="Person">
        <Loading label="Loading person">
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </div>
            <Card>
              <ListSkeleton rows={4} />
            </Card>
          </div>
        </Loading>
      </Page>
    );
  }

  if (person.isError) {
    return (
      <Page title="Person">
        <div className="space-y-4">
          {back}
          <Card>
            <EmptyState
              icon={CircleAlert}
              title="Couldn't load this person"
              description={person.error.message}
              action={<Button onClick={() => person.refetch()}>Try again</Button>}
            />
          </Card>
        </div>
      </Page>
    );
  }

  const p = person.data;
  const archived = p.is_archived;
  const { totals } = p;

  return (
    <Page
      title={p.name}
      subtitle={p.relation ?? undefined}
      onAdd={archived ? undefined : () => setPaying(true)}
      addLabel="Record payment"
      actions={
        archived ? (
          <Button
            variant="secondary"
            loading={setArchived.isPending}
            icon={<ArchiveRestore className="size-4" aria-hidden />}
            onClick={() => setArchived.mutate({ id: p.id, archived: false })}
          >
            Unarchive
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setSplitting(true)} icon={<Receipt className="size-4" aria-hidden />}>
              <span className="hidden sm:inline">Split a bill</span>
              <span className="sm:hidden">Split</span>
            </Button>
            <IconButton label={`Edit ${p.name}`} icon={<Pencil className="size-4" aria-hidden />} onClick={() => setEditTarget({ mode: "edit", person: p })} />
            <IconButton
              label={`Archive ${p.name}`}
              icon={<Archive className="size-4" aria-hidden />}
              onClick={() =>
                setArchived.mutate(
                  { id: p.id, archived: true },
                  { onSuccess: () => setNotice({ tone: "success", text: `${p.name} archived. Their history is kept.` }) },
                )
              }
            />
          </>
        )
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {back}
          <BalanceChip outstanding={totals.outstanding} className="text-sm" />
        </div>

        {notice && (
          <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>
            {notice.text}
          </Notice>
        )}
        {archived && <Notice tone="error">Archived — unarchive to record new payments or splits.</Notice>}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard icon={HandCoins} tint="blue" label="Owes you" amount={totals.outstanding} showDecimals />
          <StatCard icon={ArrowDownLeft} tint="indigo" label={`Paid back of ${formatINR(totals.shared_total, { showDecimals: false })}`} amount={totals.settled_total} showDecimals />
          <StatCard icon={Wallet} tint="cyan" label="Gifts / income received" amount={totals.received_total} showDecimals />
        </div>

        <Card flush className="p-2 sm:p-3">
          <h2 className="px-3 pt-3 pb-2 text-lg font-semibold">History</h2>
          {p.history.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Nothing yet"
              description={`Split a bill with ${p.name} or record money they sent you.`}
              action={!archived && <Button onClick={() => setSplitting(true)}>Split a bill</Button>}
            />
          ) : (
            <ul className="divide-y divide-line">
              {p.history.map((entry) => (
                <HistoryRow key={`${entry.type}-${entry.transaction_id}`} entry={entry} onDelete={() => setDeleting(entry)} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <RecordPaymentModal person={paying ? p : null} onClose={() => setPaying(false)} onDone={(text) => setNotice({ tone: "success", text })} />
      <SplitBillModal open={splitting} personId={p.id} onClose={() => setSplitting(false)} onDone={(text) => setNotice({ tone: "success", text })} />
      <PersonFormModal target={editTarget} onClose={() => setEditTarget(null)} onSaved={(saved) => setNotice({ tone: "success", text: `${saved.name} updated.` })} />
      <ConfirmModal
        open={deleting !== null}
        title="Delete this entry?"
        confirmLabel="Delete"
        danger
        busy={deleteTxn.isPending}
        error={deleteTxn.isError ? deleteTxn.error.message : undefined}
        onClose={() => {
          deleteTxn.reset();
          setDeleting(null);
        }}
        onConfirm={() =>
          deleting &&
          deleteTxn.mutate(deleting.transaction_id, {
            onSuccess: () => {
              setNotice({ tone: "success", text: "Entry deleted. Totals and balances have been updated." });
              setDeleting(null);
            },
          })
        }
      >
        {deleting && (
          <p>
            {deleting.type === "shared_expense"
              ? `This removes the whole ${formatINR(deleting.total_spent ?? deleting.amount)} expense — including anyone else's share of it.`
              : `This removes the ${formatINR(deleting.amount)} payment and takes it back out of ${deleting.source.name}.`}{" "}
            This can't be undone.
          </p>
        )}
      </ConfirmModal>
    </Page>
  );
}

function HistoryRow({ entry, onDelete }: { entry: HistoryEntry; onDelete: () => void }) {
  const meta = TYPE_META[entry.type];
  const Icon = meta.icon;
  const isShare = entry.type === "shared_expense";

  return (
    <li className="flex items-start gap-3 px-3 py-3.5">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", meta.tint)}>
        <Icon className="size-4.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate font-semibold">{entry.description || meta.label}</p>
          <span className={cn("shrink-0 font-semibold tabular-nums", !isShare && "text-positive")}>
            {!isShare && "+"}
            <Money value={entry.amount} />
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {meta.label} · {formatTimestampDate(entry.occurred_at)} · {entry.source.name}
          {isShare && entry.total_spent && <> · of {formatINR(entry.total_spent)}</>}
        </p>
        {isShare && entry.status && (
          <p className="mt-1.5 flex items-center gap-2">
            <StatusPill status={entry.status} />
            {entry.status === "partpaid" && entry.remaining && (
              <span className="text-xs text-muted tabular-nums">{formatINR(entry.remaining)} still to pay</span>
            )}
          </p>
        )}
      </div>
      <IconButton label="Delete entry" icon={<Trash2 className="size-4" aria-hidden />} onClick={onDelete} className="-mt-1.5 -mr-1" />
    </li>
  );
}
