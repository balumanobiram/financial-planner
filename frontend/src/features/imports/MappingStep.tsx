import { useState } from "react";

import type { ColumnMapping, ImportPreview } from "../../api/imports";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { SelectField, TextField } from "../../components/ui/Field";
import { Notice } from "../../components/ui/Notice";
import { cn } from "../../lib/cn";
import { Chip } from "../transactions/pickers";
import { cleanMapping, mappingErrors, type MappingErrors } from "./importForm";

type Props = {
  preview: ImportPreview;
  mapping: ColumnMapping;
  from: "saved" | "suggested" | "blank";
  sourceName: string;
  reloading: boolean;
  parsing: boolean;
  error?: string;
  onHeaderRow: (row: number) => void;
  onBack: () => void;
  onNext: (mapping: ColumnMapping) => void;
};

/** Step 2: say which column is which, checked against the first rows of the file. */
export function MappingStep({ preview, mapping: initial, from, sourceName, reloading, parsing, error, onHeaderRow, onBack, onNext }: Props) {
  const [m, setM] = useState<ColumnMapping>(initial);
  const [errors, setErrors] = useState<MappingErrors>({});
  const [headerInput, setHeaderInput] = useState(String(preview.header_row + 1)); // people count rows from 1
  const set = <K extends keyof ColumnMapping>(key: K, value: ColumnMapping[K]) => {
    setM((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = () => {
    const found = mappingErrors(m);
    setErrors(found);
    if (Object.keys(found).length === 0) onNext(cleanMapping(m));
  };

  // Which role each column plays, shown above the preview table.
  const roles: Record<string, string> = {};
  const tag = (col: string | null, label: string) => col && (roles[col] = roles[col] ? `${roles[col]} + ${label}` : label);
  tag(m.date_column, "Date");
  m.description_columns.forEach((c) => tag(c, "Description"));
  if (m.amount_mode === "single") {
    tag(m.amount_column, "Amount");
    tag(m.drcr_column, "Dr/Cr");
  } else {
    tag(m.debit_column, "Money out");
    tag(m.credit_column, "Money in");
  }

  const columnOptions = (
    <>
      <option value="">Choose…</option>
      {preview.columns.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </>
  );
  const headerRow = Number(headerInput);
  const headerValid = Number.isInteger(headerRow) && headerRow >= 1 && headerRow <= 51;

  return (
    <div className="space-y-5">
      {from === "saved" && <Notice tone="success">Using the column layout you saved for {sourceName}. Check it still fits this file.</Notice>}
      {from === "suggested" && <Notice tone="success">We guessed the columns from the headings — check them against the preview below.</Notice>}
      {from === "blank" && <Notice tone="error">Couldn't recognise the headings. Check the heading row, then pick the columns.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <Card flush>
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5 sm:px-6">
          <div>
            <h2 className="text-lg font-semibold">{preview.filename}</h2>
            <p className="text-sm text-muted">
              {preview.total_rows} rows below the headings · showing the first {preview.sample_rows.length}
            </p>
          </div>
          <div className="flex items-end gap-2">
            <TextField
              label="Headings are on row"
              type="number"
              inputMode="numeric"
              min={1}
              max={51}
              className="w-40"
              value={headerInput}
              onChange={(e) => setHeaderInput(e.target.value)}
            />
            <Button
              variant="secondary"
              className="h-11"
              loading={reloading}
              disabled={!headerValid || headerRow - 1 === preview.header_row}
              onClick={() => onHeaderRow(headerRow - 1)}
            >
              Apply
            </Button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto border-t border-line">
          <table className="w-full min-w-max text-left text-sm">
            <thead>
              <tr className="bg-surface-muted">
                {preview.columns.map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 align-bottom font-semibold whitespace-nowrap">
                    {roles[c] && <span className="mb-1 block w-fit rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-fg uppercase">{roles[c]}</span>}
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {preview.sample_rows.slice(0, 8).map((row, i) => (
                <tr key={i}>
                  {preview.columns.map((c, j) => (
                    <td key={c} className={cn("max-w-64 truncate px-3 py-2 whitespace-nowrap", roles[c] ? "text-ink" : "text-muted")}>
                      {row[j]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Date column" value={m.date_column} onChange={(e) => set("date_column", e.target.value)} error={errors.date_column}>
            {columnOptions}
          </SelectField>
          <SelectField label="Date format" value={m.date_format} onChange={(e) => set("date_format", e.target.value)} hint="Automatic reads day first (05/06 = 5 June).">
            {Object.entries(preview.date_formats).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        </div>

        <div role="group" aria-label="Description columns">
          <p className="mb-2 text-sm font-medium">Description (up to 3 columns, joined)</p>
          <div className="flex flex-wrap gap-2">
            {preview.columns.map((c) => {
              const on = m.description_columns.includes(c);
              return (
                <Chip
                  key={c}
                  selected={on}
                  onClick={() =>
                    set("description_columns", on ? m.description_columns.filter((d) => d !== c) : [...m.description_columns, c].slice(-3))
                  }
                >
                  {c}
                </Chip>
              );
            })}
          </div>
          {errors.description_columns && <p className="mt-1.5 text-xs font-medium text-negative">{errors.description_columns}</p>}
        </div>

        <div role="radiogroup" aria-label="How amounts are shown" className="grid gap-1 rounded-xl bg-surface-muted p-1 sm:grid-cols-2">
          {(
            [
              ["split", "Separate money out / in columns"],
              ["single", "One amount column"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={m.amount_mode === mode}
              onClick={() => set("amount_mode", mode)}
              className={cn("h-10 rounded-lg px-3 text-sm font-semibold", m.amount_mode === mode ? "bg-surface shadow-sm" : "text-muted")}
            >
              {label}
            </button>
          ))}
        </div>

        {m.amount_mode === "split" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Money out (withdrawal / debit)" value={m.debit_column ?? ""} onChange={(e) => set("debit_column", e.target.value || null)} error={errors.debit_column}>
              {columnOptions}
            </SelectField>
            <SelectField label="Money in (deposit / credit)" value={m.credit_column ?? ""} onChange={(e) => set("credit_column", e.target.value || null)} error={errors.credit_column}>
              {columnOptions}
            </SelectField>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField label="Amount" value={m.amount_column ?? ""} onChange={(e) => set("amount_column", e.target.value || null)} error={errors.amount_column}>
              {columnOptions}
            </SelectField>
            <SelectField label="A positive amount means" value={m.sign} onChange={(e) => set("sign", e.target.value as ColumnMapping["sign"])}>
              <option value="negative_is_debit">Money in (minus = spent)</option>
              <option value="positive_is_debit">Money spent (card statements)</option>
            </SelectField>
            <SelectField
              label="Dr / Cr column (optional)"
              value={m.drcr_column ?? ""}
              onChange={(e) => set("drcr_column", e.target.value || null)}
              hint="If set, it decides in or out."
            >
              <option value="">None</option>
              {preview.columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
          </div>
        )}
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="secondary" onClick={onBack}>
          Start over
        </Button>
        <Button loading={parsing} onClick={submit}>
          Next: review rows
        </Button>
      </div>
    </div>
  );
}
