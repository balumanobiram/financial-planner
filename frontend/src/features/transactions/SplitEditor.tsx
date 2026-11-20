import { Plus, X } from "lucide-react";

import type { Person } from "../../api/people";
import { Button, IconButton } from "../../components/ui/Button";
import { SelectField, TextField } from "../../components/ui/Field";
import { cn } from "../../lib/cn";
import { formatINR, normalizeMoneyInput, toPaise } from "../../lib/money";
import { equalValues, type PeopleSplitResult, type PersonRow, type SplitUnit } from "./split";

type Props = {
  total: string;
  people: Person[]; // active people to choose from
  rows: PersonRow[];
  unit: SplitUnit;
  result: PeopleSplitResult;
  /** Only show errors after the first submit attempt. */
  showErrors: boolean;
  onChange: (rows: PersonRow[], unit: SplitUnit) => void;
};

/** "Who owes you what": people with a ₹ amount or a % each; you keep the rest. Used by the inbox and Edit. */
export function SplitEditor({ total, people, rows, unit, result, showErrors, onChange }: Props) {
  const validTotal = normalizeMoneyInput(total);
  const canFill = validTotal !== null && toPaise(validTotal) > 0n && rows.length > 0;
  const fill = (includeMe: boolean) => {
    if (!canFill || validTotal === null) return;
    const values = equalValues(validTotal, rows.length, includeMe, unit);
    onChange(rows.map((r, i) => ({ ...r, value: values[i] })), unit);
  };
  const setRow = (i: number, patch: Partial<PersonRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)), unit);

  if (people.length === 0) {
    return <p className="rounded-xl bg-surface-muted px-3.5 py-2.5 text-sm text-muted">Add people on the People page first, then split with them here.</p>;
  }

  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Who owes you</legend>
      <div className="flex flex-wrap items-center gap-1.5">
        <div role="radiogroup" aria-label="Split by" className="inline-flex rounded-lg bg-surface-muted p-0.5 text-xs font-semibold">
          {(["amount", "percent"] as const).map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={unit === u}
              onClick={() => onChange(rows.map((r) => ({ ...r, value: "" })), u)}
              className={cn("rounded-md px-2.5 py-1", unit === u ? "bg-surface text-ink shadow-sm" : "text-muted")}
            >
              {u === "amount" ? "₹ amounts" : "% of total"}
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" disabled={!canFill} onClick={() => fill(true)}>
          Equal, incl. me
        </Button>
        <Button size="sm" variant="secondary" disabled={!canFill} onClick={() => fill(false)}>
          They pay all
        </Button>
      </div>

      {rows.map((row, i) => {
        const rowError = showErrors ? result.rowErrors[i] : undefined;
        const share = result.shares.find((s) => s.person_id === row.person_id);
        return (
          <div key={i}>
            <div className="flex items-start gap-2">
              <SelectField
                label={`Person ${i + 1}`}
                className="min-w-0 flex-1 [&_label]:sr-only"
                value={row.person_id}
                onChange={(e) => setRow(i, { person_id: e.target.value })}
              >
                <option value="">Choose…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </SelectField>
              <TextField
                label={`${unit === "percent" ? "Percent" : "Amount"} for person ${i + 1}`}
                className="w-28 [&_label]:sr-only"
                placeholder={unit === "percent" ? "%" : "₹ share"}
                inputMode="decimal"
                autoComplete="off"
                value={row.value}
                onChange={(e) => setRow(i, { value: e.target.value })}
              />
              <IconButton
                label={`Remove person ${i + 1}`}
                icon={<X className="size-4" aria-hidden />}
                className="mt-1"
                disabled={rows.length === 1}
                onClick={() => onChange(rows.filter((_, j) => j !== i), unit)}
              />
            </div>
            {unit === "percent" && share && !rowError && <p className="mt-1 text-xs text-muted tabular-nums">= {formatINR(share.amount)}</p>}
            {rowError && <p className="mt-1 text-xs font-medium text-negative">{rowError}</p>}
          </div>
        );
      })}

      <Button
        size="sm"
        variant="ghost"
        icon={<Plus className="size-3.5" aria-hidden />}
        disabled={rows.length >= Math.min(20, people.length)}
        onClick={() => onChange([...rows, { person_id: "", value: "" }], unit)}
      >
        Add person
      </Button>

      {(showErrors || result.error?.startsWith("Shares")) && result.error && <p className="text-xs font-medium text-negative">{result.error}</p>}
      {result.mine !== null && (
        <p
          className={cn("rounded-xl px-3.5 py-2.5 text-sm", toPaise(result.mine) < 0n ? "bg-pill-overdue text-pill-overdue-fg" : "bg-surface-muted text-muted")}
          aria-live="polite"
        >
          Your share (counted in charts): <span className="font-semibold text-ink tabular-nums">{formatINR(result.mine)}</span>
        </p>
      )}
    </fieldset>
  );
}
