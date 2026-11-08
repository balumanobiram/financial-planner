import { useId, useState, type FormEvent } from "react";

import { useReconcile, type BankAccount, type ReconcileResponse } from "../../api/accounts";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Money } from "../../components/ui/Money";
import { Notice } from "../../components/ui/Notice";
import { formatINRSigned, normalizeMoneyInput, subtractMoney } from "../../lib/money";

type Props = {
  account: BankAccount | null;
  onClose: () => void;
  onDone: (result: ReconcileResponse) => void;
};

/** "Enter what your bank app shows" → an adjustment transaction covers the difference. */
export function ReconcileModal({ account, onClose, onDone }: Props) {
  const formId = useId();
  const reconcile = useReconcile();

  const close = () => {
    reconcile.reset();
    onClose();
  };

  return (
    <Modal
      open={account !== null}
      onClose={close}
      title="Reconcile balance"
      description={account ? `${account.nickname} · ${account.bank_name}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={reconcile.isPending}>
            Reconcile
          </Button>
        </>
      }
    >
      {account && (
        <ReconcileForm
          formId={formId}
          account={account}
          serverError={reconcile.isError ? reconcile.error.message : undefined}
          onSubmit={(actualBalance) =>
            reconcile.mutate(
              { id: account.id, actualBalance },
              {
                onSuccess: (result) => {
                  onDone(result);
                  close();
                },
              },
            )
          }
        />
      )}
    </Modal>
  );
}

function ReconcileForm({
  formId,
  account,
  serverError,
  onSubmit,
}: {
  formId: string;
  account: BankAccount;
  serverError?: string;
  onSubmit: (actualBalance: string) => void;
}) {
  const [raw, setRaw] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const actual = normalizeMoneyInput(raw);
  const difference = actual === null ? null : subtractMoney(actual, account.current_balance);
  const error = submitted && actual === null ? "Enter the balance shown in your bank app, e.g. 24500.75" : undefined;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (actual !== null) onSubmit(actual);
  };

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4 pb-2">
      {serverError && <Notice tone="error">{serverError}</Notice>}

      <div className="flex items-baseline justify-between rounded-xl bg-surface-muted px-4 py-3">
        <span className="text-sm text-muted">Balance here</span>
        <Money value={account.current_balance} className="text-lg font-bold" />
      </div>

      <TextField
        label="Balance in your bank app (₹)"
        placeholder="0.00"
        inputMode="decimal"
        autoComplete="off"
        data-autofocus
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        error={error}
      />

      {difference !== null && (
        <p className="text-sm text-muted" aria-live="polite">
          {difference === "0.00" ? (
            "Already in sync — nothing will be added."
          ) : (
            <>
              An adjustment of{" "}
              <span className="font-semibold text-ink tabular-nums">{formatINRSigned(difference)}</span> will be recorded.
            </>
          )}
        </p>
      )}
    </form>
  );
}
