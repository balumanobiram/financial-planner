import { useId, useState, type FormEvent } from "react";

import { ACCOUNT_TYPES, useSaveAccount, type AccountType, type BankAccount } from "../../api/accounts";
import { Button } from "../../components/ui/Button";
import { SelectField, TextAreaField, TextField } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { todayIST } from "../../lib/dates";
import { initialValues, validateAccountForm, type AccountFormErrors, type AccountFormValues } from "./accountForm";

export type AccountFormTarget = { mode: "create" } | { mode: "edit"; account: BankAccount } | null;

type Props = { target: AccountFormTarget; onClose: () => void; onSaved: (account: BankAccount) => void };

export function AccountFormModal({ target, onClose, onSaved }: Props) {
  const formId = useId();
  const save = useSaveAccount();
  const editing = target?.mode === "edit" ? target.account : undefined;

  const close = () => {
    save.reset();
    onClose();
  };

  return (
    <Modal
      open={target !== null}
      onClose={close}
      title={editing ? "Edit account" : "Add account"}
      description={editing ? undefined : "A bank account or wallet you want to track."}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          {/* form={formId}: submits the form even though this button sits outside it */}
          <Button type="submit" form={formId} loading={save.isPending}>
            {editing ? "Save changes" : "Add account"}
          </Button>
        </>
      }
    >
      <AccountForm
        formId={formId}
        account={editing}
        serverError={save.isError ? save.error.message : undefined}
        onSubmit={(input) =>
          save.mutate(
            { id: editing?.id, input },
            {
              onSuccess: (account) => {
                onSaved(account);
                close();
              },
            },
          )
        }
      />
    </Modal>
  );
}

type AccountFormProps = {
  formId: string;
  account?: BankAccount;
  serverError?: string;
  onSubmit: (input: NonNullable<ReturnType<typeof validateAccountForm>["input"]>) => void;
};

/** Mounted only while the modal is open, so its state starts fresh every time. */
function AccountForm({ formId, account, serverError, onSubmit }: AccountFormProps) {
  const [values, setValues] = useState<AccountFormValues>(() => initialValues(account));
  const [errors, setErrors] = useState<AccountFormErrors>({});

  const set = <K extends keyof AccountFormValues>(key: K, value: AccountFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = validateAccountForm(values);
    setErrors(result.errors);
    if (result.input) onSubmit(result.input);
  };

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4 pb-2">
      {serverError && <Notice tone="error">{serverError}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Bank or wallet"
          placeholder="HDFC Bank"
          data-autofocus={!account || undefined}
          value={values.bank_name}
          onChange={(e) => set("bank_name", e.target.value)}
          error={errors.bank_name}
        />
        <TextField
          label="Nickname"
          placeholder="Salary"
          value={values.nickname}
          onChange={(e) => set("nickname", e.target.value)}
          error={errors.nickname}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Type"
          value={values.account_type}
          onChange={(e) => set("account_type", e.target.value as AccountType)}
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Last 4 digits"
          placeholder="Optional"
          inputMode="numeric"
          maxLength={4}
          autoComplete="off"
          value={values.last4}
          onChange={(e) => set("last4", e.target.value.replace(/\D/g, ""))}
          error={errors.last4}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Opening balance (₹)"
          placeholder="0.00"
          inputMode="decimal"
          autoComplete="off"
          value={values.opening_balance}
          onChange={(e) => set("opening_balance", e.target.value)}
          error={errors.opening_balance}
          hint={errors.opening_balance ? undefined : "Balance on the opening date."}
        />
        <TextField
          label="Opening date"
          type="date"
          max={todayIST()}
          value={values.opening_date}
          onChange={(e) => set("opening_date", e.target.value)}
          error={errors.opening_date}
        />
      </div>

      <TextField
        label="Bank website (for the logo)"
        placeholder="Auto-detected from the bank name"
        autoCapitalize="none"
        spellCheck={false}
        value={values.bank_domain}
        onChange={(e) => set("bank_domain", e.target.value)}
        error={errors.bank_domain}
        hint={errors.bank_domain ? undefined : "e.g. hdfcbank.com — leave empty to detect it automatically."}
      />

      <TextAreaField
        label="Notes"
        placeholder="Optional — branch, IFSC, anything useful"
        value={values.notes}
        onChange={(e) => set("notes", e.target.value)}
        error={errors.notes}
      />
    </form>
  );
}
