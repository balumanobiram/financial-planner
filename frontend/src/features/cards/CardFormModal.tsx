import { Check } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { CARD_NETWORKS, useSaveCard, type CreditCard, type CreditCardInput } from "../../api/cards";
import { CreditCardVisual } from "../../components/cards/CreditCardVisual";
import { NetworkMark } from "../../components/cards/NetworkMark";
import { Button } from "../../components/ui/Button";
import { SelectField, TextAreaField, TextField } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { cn } from "../../lib/cn";
import { isHexColor, readableTextOn } from "../../lib/color";
import {
  CARD_COLOR_PRESETS,
  initialCardValues,
  ordinal,
  validateCardForm,
  type CardFormErrors,
  type CardFormValues,
} from "./cardForm";

export type CardFormTarget = { mode: "create" } | { mode: "edit"; card: CreditCard } | null;

type Props = { target: CardFormTarget; onClose: () => void; onSaved: (card: CreditCard) => void };

export function CardFormModal({ target, onClose, onSaved }: Props) {
  const formId = useId();
  const save = useSaveCard();
  const editing = target?.mode === "edit" ? target.card : undefined;

  const close = () => {
    save.reset();
    onClose();
  };

  return (
    <Modal
      open={target !== null}
      onClose={close}
      title={editing ? "Edit card" : "Add credit card"}
      description={editing ? undefined : "Only the last 4 digits are stored — never the full number or CVV."}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {editing ? "Save changes" : "Add card"}
          </Button>
        </>
      }
    >
      <CardForm
        formId={formId}
        card={editing}
        serverError={save.isError ? save.error.message : undefined}
        onSubmit={(input) =>
          save.mutate(
            { id: editing?.id, input },
            {
              onSuccess: (card) => {
                onSaved(card);
                close();
              },
            },
          )
        }
      />
    </Modal>
  );
}

type CardFormProps = {
  formId: string;
  card?: CreditCard;
  serverError?: string;
  onSubmit: (input: CreditCardInput) => void;
};

function CardForm({ formId, card, serverError, onSubmit }: CardFormProps) {
  const [values, setValues] = useState<CardFormValues>(() => initialCardValues(card));
  const [errors, setErrors] = useState<CardFormErrors>({});

  const set = <K extends keyof CardFormValues>(key: K, value: CardFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = validateCardForm(values);
    setErrors(result.errors);
    if (result.input) onSubmit(result.input);
  };

  // Keep showing the stored logo in the preview while the bank is unchanged.
  const previewLogo = card && card.bank_name === values.bank_name.trim() ? card.logo_data_url : null;

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-5 pb-2">
      <div className="mx-auto max-w-xs">
        <CreditCardVisual
          card={{
            bank_name: values.bank_name.trim(),
            card_name: values.card_name.trim(),
            network: values.network,
            last4: /^\d{4}$/.test(values.last4) ? values.last4 : null,
            color: isHexColor(values.color) ? values.color : "#1a1a2e",
            logo_data_url: previewLogo,
          }}
        />
        {!previewLogo && (
          <p className="mt-2 text-center text-xs text-muted">The bank logo is fetched automatically when you save.</p>
        )}
      </div>

      {serverError && <Notice tone="error">{serverError}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Bank"
          placeholder="HDFC Bank"
          data-autofocus={!card || undefined}
          value={values.bank_name}
          onChange={(e) => set("bank_name", e.target.value)}
          error={errors.bank_name}
        />
        <TextField
          label="Card name"
          placeholder="Regalia Gold"
          value={values.card_name}
          onChange={(e) => set("card_name", e.target.value)}
          error={errors.card_name}
        />
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Network</legend>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {CARD_NETWORKS.map((n) => {
            const selected = values.network === n.value;
            return (
              <label
                key={n.value}
                className={cn(
                  "flex h-12 cursor-pointer flex-col items-center justify-center rounded-xl border text-ink transition-colors",
                  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary",
                  selected ? "border-primary bg-tint-blue" : "border-line hover:bg-surface-muted",
                )}
              >
                <input
                  type="radio"
                  name="network"
                  value={n.value}
                  checked={selected}
                  onChange={() => set("network", n.value)}
                  className="sr-only"
                />
                {n.value === "other" ? (
                  <span className="text-xs font-semibold">Other</span>
                ) : (
                  <NetworkMark network={n.value} className="scale-75" />
                )}
                <span className="sr-only">{n.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Card colour</legend>
        <div className="flex flex-wrap items-center gap-2">
          {CARD_COLOR_PRESETS.map((preset) => {
            const selected = values.color.toLowerCase() === preset.value;
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => set("color", preset.value)}
                aria-label={preset.label}
                aria-pressed={selected}
                title={preset.label}
                className={cn(
                  "grid size-9 place-items-center rounded-full ring-offset-2 transition-shadow focus-visible:outline-2 focus-visible:outline-primary",
                  selected ? "ring-2 ring-primary" : "ring-1 ring-line",
                )}
                style={{ background: preset.value, color: readableTextOn(preset.value) }}
              >
                {selected && <Check className="size-4" aria-hidden />}
              </button>
            );
          })}
          <label className="relative grid size-9 cursor-pointer place-items-center rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)] ring-1 ring-line" title="Custom colour">
            <span className="sr-only">Custom colour</span>
            <input
              type="color"
              value={isHexColor(values.color) ? values.color : "#1a1a2e"}
              onChange={(e) => set("color", e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        </div>
        {errors.color && <p className="mt-1.5 text-xs font-medium text-negative">{errors.color}</p>}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Statement day"
          value={values.statement_day}
          onChange={(e) => set("statement_day", e.target.value)}
          error={errors.statement_day}
          hint="Day of the month your bill is generated."
        >
          {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
            <option key={day} value={day}>
              {ordinal(day)}
              {day >= 29 ? " (last day in shorter months)" : ""}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Days to pay after statement"
          inputMode="numeric"
          value={values.payment_due_days}
          onChange={(e) => set("payment_due_days", e.target.value.replace(/\D/g, "").slice(0, 2))}
          error={errors.payment_due_days}
          hint={errors.payment_due_days ? undefined : "Check your statement — often 15, 18 or 20."}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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
        <TextField
          label="Credit limit (₹)"
          placeholder="Optional"
          inputMode="decimal"
          autoComplete="off"
          value={values.credit_limit}
          onChange={(e) => set("credit_limit", e.target.value)}
          error={errors.credit_limit}
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
        placeholder="Optional — reward rules, annual fee waiver, anything useful"
        value={values.notes}
        onChange={(e) => set("notes", e.target.value)}
        error={errors.notes}
      />
    </form>
  );
}
