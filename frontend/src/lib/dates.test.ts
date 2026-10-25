import { describe, expect, it } from "vitest";

import { formatDate, formatDateTime, todayIST } from "./dates";

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
