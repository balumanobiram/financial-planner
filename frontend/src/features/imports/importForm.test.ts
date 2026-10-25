import { describe, expect, it } from "vitest";

import type { ColumnMapping, ImportPreview, ParsedRow } from "../../api/imports";
import {
  base64FromDataUrl,
  blankMapping,
  buildCommit,
  checkFile,
  cleanMapping,
  defaultSelection,
  filterRows,
  importSource,
  initialMapping,
  mappingErrors,
  selectionTotals,
} from "./importForm";

const split: ColumnMapping = {
  ...blankMapping(4, false),
  date_column: "Date",
  description_columns: ["Narration"],
  amount_mode: "split",
  debit_column: "Withdrawal",
  credit_column: "Deposit",
};

const preview = (over: Partial<ImportPreview> = {}): ImportPreview => ({
  filename: "s.csv",
  header_row: 4,
  columns: ["Date", "Narration", "Withdrawal", "Deposit"],
  sample_rows: [],
  total_rows: 3,
  saved_mapping: null,
  suggested_mapping: null,
  date_formats: { auto: "Detect automatically" },
  ...over,
});

const row = (n: number, over: Partial<ParsedRow> = {}): ParsedRow => ({
  row_number: n,
  occurred_on: "2026-10-01",
  description: `row ${n}`,
  amount: "-100.00",
  error: null,
  duplicate: null,
  ...over,
});

describe("checkFile", () => {
  it.each([
    [{ name: "hdfc.CSV", size: 10 }, null],
    [{ name: "card.xlsx", size: 10 }, null],
    [{ name: "old.xls", size: 10 }, "Old .xls files aren't supported — open it and save as .xlsx or .csv."],
    [{ name: "s.pdf", size: 10 }, "Choose a .csv or .xlsx file."],
    [{ name: "s.csv", size: 0 }, "That file is empty."],
    [{ name: "s.csv", size: 5 * 1024 * 1024 + 1 }, "That file is over 5 MB. Export a shorter date range."],
  ])("%o", (file, expected) => {
    expect(checkFile(file)).toBe(expected);
  });
});

it("base64FromDataUrl strips the data: prefix", () => {
  expect(base64FromDataUrl("data:text/csv;base64,eCx5")).toBe("eCx5");
  expect(base64FromDataUrl("garbage")).toBe("");
});

it("importSource", () => {
  expect(importSource("card:c1")).toEqual({ card_id: "c1" });
  expect(importSource("account:a1")).toEqual({ account_id: "a1" });
  expect(importSource("")).toBeNull();
});

describe("initialMapping", () => {
  it("prefers the saved mapping, on the preview's heading row", () => {
    const result = initialMapping(preview({ saved_mapping: { ...split, header_row: 9 }, suggested_mapping: { ...split, date_column: "X" } }), false);
    expect(result).toEqual({ mapping: { ...split, header_row: 4 }, from: "saved" });
  });

  it("falls back to the suggestion when saved columns no longer exist", () => {
    const result = initialMapping(preview({ saved_mapping: { ...split, debit_column: "Gone" }, suggested_mapping: split }), false);
    expect(result.from).toBe("suggested");
  });

  it("blank when there's nothing to go on; cards default to 'spends are positive'", () => {
    const result = initialMapping(preview(), true);
    expect(result.from).toBe("blank");
    expect(result.mapping.sign).toBe("positive_is_debit");
  });
});

describe("mappingErrors / cleanMapping", () => {
  it("accepts a complete mapping", () => {
    expect(mappingErrors(split)).toEqual({});
  });

  it("names every missing column", () => {
    expect(Object.keys(mappingErrors(blankMapping(0, false))).sort()).toEqual(["credit_column", "date_column", "debit_column", "description_columns"]);
    expect(mappingErrors({ ...split, credit_column: "Withdrawal" })).toEqual({ credit_column: "Pick two different columns." });
    expect(mappingErrors({ ...split, amount_mode: "single" })).toEqual({ amount_column: "Which column has the amount?" });
  });

  it("drops the other mode's columns", () => {
    const single = cleanMapping({ ...split, amount_mode: "single", amount_column: "Amt", drcr_column: "Type" });
    expect([single.debit_column, single.credit_column, single.amount_column, single.drcr_column]).toEqual([null, null, "Amt", "Type"]);
    expect(cleanMapping({ ...split, amount_column: "Amt" }).amount_column).toBeNull();
  });
});

describe("review", () => {
  const dup = { transaction_id: "t1", description: "Swiggy", type: "expense" };
  const rows = [
    row(7),
    row(8, { amount: "85000.00" }),
    row(9, { duplicate: dup }),
    row(10, { error: "No date — not a transaction line", occurred_on: null }),
  ];

  it("ticks importable non-duplicates by default", () => {
    expect([...defaultSelection(rows)]).toEqual([7, 8]);
  });

  it("filters by tab", () => {
    const selected = new Set([7, 9]);
    expect(filterRows(rows, "selected", selected).map((r) => r.row_number)).toEqual([7, 9]);
    expect(filterRows(rows, "duplicates", selected).map((r) => r.row_number)).toEqual([9]);
    expect(filterRows(rows, "errors", selected).map((r) => r.row_number)).toEqual([10]);
    expect(filterRows(rows, "all", selected)).toHaveLength(4);
  });

  it("totals only selected, importable rows — exactly", () => {
    expect(selectionTotals([...rows, row(11, { amount: "-0.10" }), row(12, { amount: "-0.20" })], new Set([7, 8, 9, 10, 11, 12]))).toEqual({
      count: 5,
      moneyIn: "85000.00",
      moneyOut: "200.30", // 100 + 100 (the duplicate, ticked by hand) + 0.10 + 0.20
    });
  });

  it("builds the commit body with categories and a clean mapping", () => {
    const body = buildCommit({ account_id: "a1" }, { ...split, amount_column: "x" }, rows, new Set([7, 9, 10]), { 7: "food" });
    expect(body).toEqual({
      source: { account_id: "a1" },
      mapping: { ...split, amount_column: null },
      rows: [
        { occurred_on: "2026-10-01", description: "row 7", amount: "-100.00", category_id: "food" },
        { occurred_on: "2026-10-01", description: "row 9", amount: "-100.00", category_id: null },
      ],
    });
  });
});
