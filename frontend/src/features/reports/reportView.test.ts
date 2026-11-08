import { describe, expect, it } from "vitest";

import { reportPath } from "../../api/reports";
import { filenameFrom } from "../../lib/api";
import {
  adjustMonthRange,
  categoryChange,
  currentFinancialYear,
  defaultMonthRange,
  fallbackFilename,
  fyLabel,
  fyOptions,
  lastMonth,
  monthOptions,
  monthsBetween,
  paramsFromQuery,
  queryFromParams,
  rangeError,
  shiftMonth,
  yearOptions,
} from "./reportView";

const TODAY = "2026-11-15";
const q = (s: string) => queryFromParams(new URLSearchParams(s), TODAY);

describe("queries", () => {
  it("defaults to last month", () => {
    expect(lastMonth(TODAY)).toBe("2026-10");
    expect(lastMonth("2026-01-03")).toBe("2025-12");
    expect(q("")).toEqual({ view: "month", month: "2026-10" });
  });

  it("reads and round-trips each view", () => {
    for (const s of ["view=month&month=2026-03", "view=range&from=2026-10-01&to=2026-10-15", "view=year&year=2025"]) {
      expect(paramsFromQuery(q(s)).toString()).toBe(s);
    }
  });

  it("falls back on junk or the future", () => {
    expect(q("view=month&month=2026-13")).toEqual({ view: "month", month: "2026-10" });
    expect(q("view=month&month=2027-01")).toEqual({ view: "month", month: "2026-10" });
    expect(q("view=year&year=2099")).toEqual({ view: "year", year: "2026" });
    expect(q("view=range&from=x")).toEqual({ view: "range", from: "2026-11-01", to: TODAY });
  });

  it("maps to API paths (PDF at the same path + /pdf)", () => {
    expect(reportPath({ view: "month", month: "2026-10" })).toBe("/reports/monthly?month=2026-10");
    expect(reportPath({ view: "range", from: "2026-10-01", to: "2026-10-15" }, true)).toBe("/reports/range/pdf?from=2026-10-01&to=2026-10-15");
    expect(reportPath({ view: "year", year: "2025" }, true)).toBe("/reports/yearly/pdf?year=2025");
  });
});

it.each([
  ["2026-10-01", "2026-10-15", null],
  ["", "2026-10-15", "Pick both dates."],
  ["2026-10-15", "2026-10-01", "The start must be on or before the end."],
  ["2026-12-01", "2026-12-31", "The range can't start in the future."],
  ["2024-01-01", "2026-01-02", "Pick a range of up to two years."],
])("rangeError(%s, %s)", (from, to, expected) => {
  expect(rangeError(from, to, TODAY)).toBe(expected);
});

it("month and year options, newest first", () => {
  const months = monthOptions(TODAY, 3);
  expect(months).toEqual([
    { value: "2026-11", label: "November 2026 (so far)" },
    { value: "2026-10", label: "October 2026" },
    { value: "2026-09", label: "September 2026" },
  ]);
  expect(monthOptions("2026-01-31", 2).map((m) => m.value)).toEqual(["2026-01", "2025-12"]);
  expect(yearOptions(TODAY, 2)).toEqual([{ value: "2026", label: "2026 (so far)" }, { value: "2025", label: "2025" }]);
});

it.each([
  ["32.4", "500.00", { text: "+32%", tone: "up" }],
  ["-5.0", "500.00", { text: "−5.0%", tone: "down" }],
  [null, "500.00", { text: "New", tone: "new" }],
  [null, "0.00", { text: "—", tone: "flat" }],
])("categoryChange(%s)", (pct, amount, expected) => {
  expect(categoryChange(pct, amount)).toEqual(expected);
});

it("filenames", () => {
  expect(filenameFrom('attachment; filename="finance-report-2026-10.pdf"')).toBe("finance-report-2026-10.pdf");
  expect(filenameFrom(null)).toBeNull();
  expect(fallbackFilename({ view: "range", from: "2026-10-01", to: "2026-10-15" })).toBe("finance-report-2026-10-01_to_2026-10-15.pdf");
});

describe("month ranges", () => {
  it("counts and shifts months across years", () => {
    expect(monthsBetween("2026-04", "2026-09")).toBe(6);
    expect(monthsBetween("2025-11", "2026-02")).toBe(4);
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-11", 14)).toBe("2028-01");
  });

  it("defaults to the last 6 finished months", () => {
    expect(defaultMonthRange(TODAY)).toEqual({ from: "2026-05", to: "2026-10" });
  });

  it("keeps the range valid when one end moves", () => {
    expect(adjustMonthRange("2026-11", "2026-09", "from")).toEqual({ from: "2026-11", to: "2026-11" });
    expect(adjustMonthRange("2026-06", "2026-03", "to")).toEqual({ from: "2026-03", to: "2026-03" });
    expect(adjustMonthRange("2023-01", "2026-10", "from")).toEqual({ from: "2023-01", to: "2024-12" }); // max 24
    expect(adjustMonthRange("2023-01", "2026-10", "to")).toEqual({ from: "2024-11", to: "2026-10" });
    expect(adjustMonthRange("2026-04", "2026-09", "to")).toEqual({ from: "2026-04", to: "2026-09" });
  });

  it("reads months from the URL, rejecting bad ranges", () => {
    expect(q("view=months&from=2026-04&to=2026-09")).toEqual({ view: "months", from: "2026-04", to: "2026-09" });
    expect(q("view=months&from=2026-09&to=2026-04")).toEqual({ view: "months", from: "2026-05", to: "2026-10" });
    expect(q("view=months&from=2026-04&to=2027-01")).toEqual({ view: "months", from: "2026-05", to: "2026-10" });
  });
});

describe("financial years", () => {
  it.each([
    ["2026-03-31", "2025"],
    ["2026-04-01", "2026"],
    ["2026-11-15", "2026"],
  ])("%s is in FY starting %s", (today, fy) => {
    expect(currentFinancialYear(today)).toBe(fy);
  });

  it("labels, options, URL and file name", () => {
    expect(fyLabel("2025")).toBe("FY 2025–26");
    expect(fyLabel("2099")).toBe("FY 2099–00");
    expect(fyOptions(TODAY, 2)).toEqual([{ value: "2026", label: "FY 2026–27 (so far)" }, { value: "2025", label: "FY 2025–26" }]);
    expect(q("view=fy&fy=2025")).toEqual({ view: "fy", fy: "2025" });
    expect(q("view=fy&fy=2030")).toEqual({ view: "fy", fy: "2026" });
    expect(paramsFromQuery({ view: "fy", fy: "2025" }).toString()).toBe("view=fy&fy=2025");
    expect(reportPath({ view: "fy", fy: "2025" }, true)).toBe("/reports/financial-year/pdf?fy=2025");
    expect(reportPath({ view: "months", from: "2026-04", to: "2026-09" })).toBe("/reports/months?from=2026-04&to=2026-09");
    expect(fallbackFilename({ view: "fy", fy: "2025" })).toBe("finance-report-FY2025-26.pdf");
    expect(fallbackFilename({ view: "months", from: "2026-04", to: "2026-09" })).toBe("finance-report-2026-04_to_2026-09.pdf");
  });
});
