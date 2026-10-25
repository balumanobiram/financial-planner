/** Pure logic for the import wizard: file checks, mapping validation, row selection, totals, commit body. */

import type { ColumnMapping, CommitRequest, ImportPreview, ImportSource, ParsedRow } from "../../api/imports";
import { fromPaise, toPaise } from "../../lib/money";

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // same limit as the backend

/** Problem with the chosen file, or null if it's fine to send. */
export function checkFile(file: { name: string; size: number }): string | null {
  if (!/\.(csv|xlsx)$/i.test(file.name)) {
    return /\.xls$/i.test(file.name) ? "Old .xls files aren't supported — open it and save as .xlsx or .csv." : "Choose a .csv or .xlsx file.";
  }
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_FILE_BYTES) return "That file is over 5 MB. Export a shorter date range.";
  return null;
}

/** "data:text/csv;base64,AAAA" → "AAAA" (what FileReader.readAsDataURL gives us). */
export function base64FromDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? "" : dataUrl.slice(comma + 1);
}

/** "account:<id>" / "card:<id>" → API source. */
export function importSource(value: string): ImportSource | null {
  const [kind, id] = value.split(":");
  if (!id) return null;
  return kind === "card" ? { card_id: id } : kind === "account" ? { account_id: id } : null;
}

// ---- Mapping --------------------------------------------------------------------------

export function blankMapping(headerRow: number, isCard: boolean): ColumnMapping {
  return {
    header_row: headerRow,
    date_column: "",
    date_format: "auto",
    description_columns: [],
    amount_mode: "split",
    amount_column: null,
    sign: isCard ? "positive_is_debit" : "negative_is_debit",
    drcr_column: null,
    debit_column: null,
    credit_column: null,
  };
}

/**
 * Start from the saved mapping if its columns still exist in this file, else the suggestion,
 * else blank. Always uses the preview's heading row (it may have been changed by hand).
 */
export function initialMapping(preview: ImportPreview, isCard: boolean): { mapping: ColumnMapping; from: "saved" | "suggested" | "blank" } {
  const fits = (m: ColumnMapping) =>
    [m.date_column, ...m.description_columns, m.amount_column, m.debit_column, m.credit_column, m.drcr_column]
      .filter((c): c is string => Boolean(c))
      .every((c) => preview.columns.includes(c));
  if (preview.saved_mapping && fits(preview.saved_mapping)) {
    return { mapping: { ...preview.saved_mapping, header_row: preview.header_row }, from: "saved" };
  }
  if (preview.suggested_mapping) return { mapping: { ...preview.suggested_mapping, header_row: preview.header_row }, from: "suggested" };
  return { mapping: blankMapping(preview.header_row, isCard), from: "blank" };
}

export type MappingErrors = Partial<Record<"date_column" | "description_columns" | "amount_column" | "debit_column" | "credit_column", string>>;

/** Same rules as the backend's ColumnMapping, so mistakes show next to the field. */
export function mappingErrors(m: ColumnMapping): MappingErrors {
  const errors: MappingErrors = {};
  if (!m.date_column) errors.date_column = "Which column has the date?";
  if (m.description_columns.length === 0) errors.description_columns = "Pick at least one column for the description.";
  if (m.amount_mode === "single" && !m.amount_column) errors.amount_column = "Which column has the amount?";
  if (m.amount_mode === "split") {
    if (!m.debit_column) errors.debit_column = "Which column is money out?";
    if (!m.credit_column) errors.credit_column = "Which column is money in?";
    else if (m.credit_column === m.debit_column) errors.credit_column = "Pick two different columns.";
  }
  return errors;
}

/** Drop fields the chosen mode doesn't use, so the saved mapping is clean. */
export function cleanMapping(m: ColumnMapping): ColumnMapping {
  return m.amount_mode === "single"
    ? { ...m, debit_column: null, credit_column: null }
    : { ...m, amount_column: null, drcr_column: null };
}

// ---- Review ---------------------------------------------------------------------------

export const isImportable = (r: ParsedRow) => r.error === null && r.occurred_on !== null && r.amount !== null;

/** Ticked to start with: everything importable that isn't a possible duplicate. */
export function defaultSelection(rows: ParsedRow[]): Set<number> {
  return new Set(rows.filter((r) => isImportable(r) && !r.duplicate).map((r) => r.row_number));
}

export type ReviewTab = "all" | "selected" | "duplicates" | "errors";

export function filterRows(rows: ParsedRow[], tab: ReviewTab, selected: Set<number>): ParsedRow[] {
  switch (tab) {
    case "selected":
      return rows.filter((r) => selected.has(r.row_number));
    case "duplicates":
      return rows.filter((r) => r.duplicate);
    case "errors":
      return rows.filter((r) => !isImportable(r));
    default:
      return rows;
  }
}

/** Count and exact in/out of what will be imported. */
export function selectionTotals(rows: ParsedRow[], selected: Set<number>): { count: number; moneyIn: string; moneyOut: string } {
  let inP = 0n;
  let outP = 0n;
  let count = 0;
  for (const r of rows) {
    if (!selected.has(r.row_number) || !isImportable(r) || r.amount === null) continue;
    const p = toPaise(r.amount);
    if (p > 0n) inP += p;
    else outP -= p;
    count += 1;
  }
  return { count, moneyIn: fromPaise(inP), moneyOut: fromPaise(outP) };
}

export function buildCommit(
  source: ImportSource,
  mapping: ColumnMapping,
  rows: ParsedRow[],
  selected: Set<number>,
  categories: Record<number, string>,
): CommitRequest {
  return {
    source,
    mapping: cleanMapping(mapping),
    rows: rows
      .filter((r) => selected.has(r.row_number) && isImportable(r))
      .map((r) => ({
        occurred_on: r.occurred_on as string,
        description: r.description,
        amount: r.amount as string,
        category_id: categories[r.row_number] || null,
      })),
  };
}
