import { describe, expect, it } from "vitest";

import { formatDate, formatDateShort, formatDateTime, formatTimestampDate, shiftDate, todayIST } from "./dates";

describe("formatDate", () => {
  it("formats a date-only value without shifting the day", () => {
    expect(formatDate("2026-10-30")).toBe("30 Oct 2026");
    expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
  });

  it("rejects non-dates", () => {
    expect(() => formatDate("30/10/2026")).toThrow("Invalid date");
  });
});

describe("formatDateTime", () => {
  it("converts UTC to IST (+05:30), including across midnight", () => {
    expect(formatDateTime("2026-10-25T18:30:00Z")).toMatch(/^26 Oct 2026, 12:00\s?am$/i);
    expect(formatDateTime("2026-10-25T06:45:00+00:00")).toMatch(/^25 Oct 2026, 12:15\s?pm$/i);
  });
});

describe("todayIST", () => {
  it("uses the IST calendar day, not UTC", () => {
    // 20:00 UTC on 25 Oct is already 01:30 on 26 Oct in India.
    expect(todayIST(new Date("2026-10-25T20:00:00Z"))).toBe("2026-10-26");
    expect(todayIST(new Date("2026-10-25T10:00:00Z"))).toBe("2026-10-25");
  });
});

describe("formatDateShort", () => {
  it("drops the year", () => {
    expect(formatDateShort("2026-11-01")).toBe("1 Nov");
    expect(formatDateShort("2027-01-30")).toBe("30 Jan");
  });
});

describe("formatTimestampDate", () => {
  it("shows the IST calendar day of a UTC timestamp", () => {
    // Midnight IST on 1 Oct is 18:30 UTC on 30 Sep — must still read as 1 Oct.
    expect(formatTimestampDate("2026-09-30T18:30:00Z")).toBe("1 Oct 2026");
    expect(formatTimestampDate("2026-10-25T06:00:00+00:00")).toBe("25 Oct 2026");
  });
});

describe("shiftDate", () => {
  it.each([
    ["2026-10-25", -1, "2026-10-24"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2028-03-01", -1, "2028-02-29"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-10-25", -29, "2026-09-26"],
  ])("%s %+d → %s", (date, days, expected) => {
    expect(shiftDate(date, days)).toBe(expected);
  });
});
