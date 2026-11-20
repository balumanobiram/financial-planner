import { CircleAlert, CopyCheck, MessageSquareText, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { useBulkApprove, useInbox, useSetSmsStatus, type SmsItem, type SmsStatus } from "../../api/inbox";
import { Page } from "../../components/layout/Page";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Notice } from "../../components/ui/Notice";
import { Skeleton } from "../../components/ui/Skeleton";
import { cn } from "../../lib/cn";
import { formatDateTime } from "../../lib/dates";
import { formatINR } from "../../lib/money";
import { ApproveModal } from "./ApproveModal";
import { inboxIsQuiet, QUIET_DAYS } from "./inboxForm";

const TABS: Array<{ status: SmsStatus; label: string }> = [
  { status: "pending", label: "To review" },
  { status: "ignored", label: "Ignored" },
  { status: "rejected", label: "Not money" },
  { status: "approved", label: "Approved" },
];

type PageNotice = { tone: "success" | "error"; text: string } | null;

/** SMS from the iPhone Shortcut. Nothing here counts anywhere until you approve it. */
export function InboxPage() {
  const [params, setParams] = useSearchParams();
  const status = (TABS.find((t) => t.status === params.get("status"))?.status ?? "pending") as SmsStatus;
  const inbox = useInbox(status);
  const bulk = useBulkApprove();
  const setStatus = useSetSmsStatus();
  const [approving, setApproving] = useState<SmsItem | null>(null);
  const [notice, setNotice] = useState<PageNotice>(null);

  const items = inbox.data?.items ?? [];
  const quick = items.filter((i) => i.can_quick_approve);
  const onError = (error: Error) => setNotice({ tone: "error", text: error.message });

  const approveAll = () =>
    bulk.mutate(
      quick.map((i) => i.id),
      {
        onSuccess: ({ approved, skipped }) =>
          setNotice({ tone: "success", text: `Approved ${approved}.${skipped ? ` ${skipped} need a closer look.` : ""}` }),
        onError,
      },
    );

  const change = (sms: SmsItem, action: "ignore" | "restore") =>
    setStatus.mutate(
      { id: sms.id, action },
      { onSuccess: () => setNotice({ tone: "success", text: action === "ignore" ? "Ignored." : "Back in the inbox." }), onError },
    );

  return (
    <Page
      title="Inbox"
      subtitle="Bank SMS waiting for you. Nothing counts until you approve it."
      actions={
        status === "pending" &&
        quick.length > 0 && (
          <Button variant="secondary" loading={bulk.isPending} onClick={approveAll} icon={<CopyCheck className="size-4" aria-hidden />}>
            Approve {quick.length} unflagged
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {inbox.data && inboxIsQuiet(inbox.data.last_received_at) && (
          <Notice tone="error">
            No SMS in the last {QUIET_DAYS} days. Check the iPhone Shortcut automation is still on (Shortcuts → Automation).
          </Notice>
        )}
        {notice && (
          <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>
            {notice.text}
          </Notice>
        )}

        <div role="tablist" aria-label="Show" className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {TABS.map((t) => (
            <button
              key={t.status}
              role="tab"
              type="button"
              aria-selected={status === t.status}
              onClick={() => setParams(t.status === "pending" ? {} : { status: t.status }, { replace: true })}
              className={cn(
                "h-9 shrink-0 rounded-lg px-3 text-sm font-medium",
                status === t.status ? "bg-tint-blue text-primary" : "text-muted hover:bg-surface-muted",
              )}
            >
              {t.label}
              {t.status === "pending" && inbox.data ? ` (${inbox.data.pending_count})` : ""}
            </button>
          ))}
        </div>

        {inbox.isPending ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-36 rounded-2xl" />
            ))}
          </div>
        ) : inbox.isError ? (
          <Card>
            <EmptyState icon={CircleAlert} title="Couldn't load the inbox" description={inbox.error.message} />
          </Card>
        ) : items.length === 0 ? (
          <Card>
            <EmptyState
              icon={MessageSquareText}
              title={status === "pending" ? "All caught up" : "Nothing here"}
              description={status === "pending" ? "New bank SMS will appear here for you to approve." : undefined}
            />
          </Card>
        ) : (
          <ul className="space-y-3">
            {items.map((sms) => (
              <li key={sms.id}>
                <SmsCard
                  sms={sms}
                  busy={setStatus.isPending && setStatus.variables?.id === sms.id}
                  onApprove={() => setApproving(sms)}
                  onIgnore={() => change(sms, "ignore")}
                  onRestore={() => change(sms, "restore")}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <ApproveModal sms={approving} onClose={() => setApproving(null)} onDone={(text) => setNotice({ tone: "success", text })} />
    </Page>
  );
}

function SmsCard({ sms, busy, onApprove, onIgnore, onRestore }: { sms: SmsItem; busy: boolean; onApprove: () => void; onIgnore: () => void; onRestore: () => void }) {
  const flags = [
    sms.duplicate_of_sms_id || sms.duplicate_of_transaction_id ? "Possible duplicate" : null,
    sms.needs_review && !(sms.duplicate_of_sms_id || sms.duplicate_of_transaction_id) ? "Check this" : null,
    !sms.parsed ? "Not read yet" : null,
  ].filter(Boolean);

  return (
    <Card flush className="space-y-3 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-lg font-bold tabular-nums", sms.direction === "credit" ? "text-positive" : "text-ink")}>
            {sms.amount ? `${sms.direction === "credit" ? "+" : sms.direction === "debit" ? "−" : ""}${formatINR(sms.amount)}` : "Amount?"}
          </p>
          <p className="truncate text-sm text-muted">
            {[sms.merchant, sms.source?.name ?? (sms.last4 ? `••${sms.last4} (not matched)` : null)].filter(Boolean).join(" · ") || sms.sender}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-xs text-muted">{formatDateTime(sms.occurred_at ?? sms.received_at)}</span>
          {flags.map((f) => (
            <span key={f} className="rounded-md bg-pill-duesoon px-1.5 py-0.5 text-[11px] font-semibold text-pill-duesoon-fg">
              {f}
            </span>
          ))}
        </div>
      </div>

      <p className="rounded-xl bg-surface-muted px-3 py-2 font-mono text-xs leading-relaxed break-words text-muted">{sms.text}</p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {sms.category && <span>Suggested: <span className="font-medium text-ink">{sms.category.name}</span></span>}
        {sms.suggested_kind && sms.suggested_kind !== "expense" && <span className="font-medium">{sms.suggested_kind.replace("_", " ")}</span>}
        {sms.upi_ref && <span>UPI ref {sms.upi_ref}</span>}
        {sms.note && <span className="text-pill-duesoon-fg">{sms.note}</span>}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        {sms.status === "pending" ? (
          <>
            <Button size="sm" onClick={onApprove}>
              Review & approve
            </Button>
            <Button size="sm" variant="secondary" loading={busy} onClick={onIgnore}>
              Ignore / not mine
            </Button>
          </>
        ) : sms.status === "approved" ? (
          <span className="text-xs text-muted">Approved — find it under Transactions.</span>
        ) : (
          <Button size="sm" variant="secondary" loading={busy} onClick={onRestore} icon={<RotateCcw className="size-3.5" aria-hidden />}>
            Back to inbox
          </Button>
        )}
      </div>
    </Card>
  );
}
