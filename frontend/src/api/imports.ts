/** Statement import API: types mirror backend/app/schemas/imports.py. Money is a string; dates are YYYY-MM-DD. */

import { useMutation } from "@tanstack/react-query";

import { apiFetch } from "../lib/api";
import { useInvalidateMoney } from "./invalidate";

export type ImportSource = { account_id: string } | { card_id: string };
export type ImportFile = { filename: string; content_base64: string };

export type ColumnMapping = {
  header_row: number; // 0-based
  date_column: string;
  date_format: string; // "auto" or a key of date_formats
  description_columns: string[];
  amount_mode: "single" | "split";
  amount_column: string | null;
  sign: "negative_is_debit" | "positive_is_debit";
  drcr_column: string | null;
  debit_column: string | null;
  credit_column: string | null;
};

export type ImportPreview = {
  filename: string;
  header_row: number;
  columns: string[];
  sample_rows: string[][];
  total_rows: number;
  saved_mapping: ColumnMapping | null;
  suggested_mapping: ColumnMapping | null;
  date_formats: Record<string, string>;
};

export type ParsedRow = {
  row_number: number; // 1-based line in the file
  occurred_on: string | null;
  description: string | null;
  amount: string | null; // signed: negative = money out
  error: string | null;
  duplicate: { transaction_id: string; description: string | null; type: string } | null;
};

export type ParseResult = {
  rows: ParsedRow[];
  summary: {
    rows: number;
    importable: number;
    duplicates: number;
    errors: number;
    date_from: string | null;
    date_to: string | null;
    money_in: string;
    money_out: string;
  };
};

export type CommitRow = { occurred_on: string; description: string | null; amount: string; category_id: string | null };
export type CommitRequest = { source: ImportSource; mapping: ColumnMapping | null; rows: CommitRow[] };

// Preview and parse save nothing, so they're mutations only in the "POST with a body" sense.
export function usePreviewImport() {
  return useMutation({
    mutationFn: (body: { file: ImportFile; source: ImportSource; header_row?: number }) =>
      apiFetch<ImportPreview>("/imports/preview", { method: "POST", body }),
  });
}

export function useParseImport() {
  return useMutation({
    mutationFn: (body: { file: ImportFile; source: ImportSource; mapping: ColumnMapping }) =>
      apiFetch<ParseResult>("/imports/parse", { method: "POST", body }),
  });
}

export function useCommitImport() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (body: CommitRequest) =>
      apiFetch<{ created: number; mapping_saved: boolean }>("/imports/commit", { method: "POST", body }),
    onSuccess: invalidate,
  });
}
