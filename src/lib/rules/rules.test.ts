import { describe, expect, it } from "vitest";
import { anniversaryInfo, formatTenure, monthsOfService, nextAnniversary, tenure, yearsOfService } from "./dates";
import { calcLieuCredit, DEFAULT_LIEU_RULES } from "./lieu";
import { countLeaveDays, statutoryMinimumDays } from "./leave";

const ctx = { holidays: new Set(["2026-10-12", "2026-12-25", "2026-12-26", "2026-12-28", "2027-01-01"]), workingDays: [1, 2, 3, 4, 5] };

describe("tenure", () => {
  it("formats years and months", () => {
    expect(formatTenure("2024-06-23", "2026-10-23")).toBe("2 years, 4 months");
    expect(formatTenure("2026-10-01", "2026-10-23")).toBe("0 months");
    expect(formatTenure("2025-10-23", "2026-10-23")).toBe("1 year");
    expect(formatTenure("2026-11-01", "2026-10-23")).toMatch(/Starts/);
  });
  it("handles month ends and leap years", () => {
    expect(monthsOfService("2026-01-31", "2026-02-28")).toBe(1);
    expect(monthsOfService("2026-01-31", "2026-02-27")).toBe(0);
    expect(tenure("2024-02-29", "2025-02-28")).toEqual({ years: 1, months: 0 });
    expect(yearsOfService("2024-02-29", "2025-02-27")).toBe(0);
    expect(yearsOfService("2024-02-29", "2028-02-29")).toBe(4);
  });
  it("finds the next anniversary", () => {
    expect(nextAnniversary("2020-02-29", "2026-03-01")).toBe("2027-02-28");
    expect(nextAnniversary("2024-02-29", "2028-01-10")).toBe("2028-02-29");
    expect(nextAnniversary("2021-10-23", "2026-10-23")).toBe("2026-10-23");
    expect(nextAnniversary("2026-10-23", "2026-10-23")).toBe("2027-10-23");
    expect(anniversaryInfo("2024-11-12", "2026-10-13")).toEqual({ date: "2026-11-12", years: 2, daysUntil: 30 });
  });
});

describe("lieu preview", () => {
  it("weekend thresholds", () => {
    expect([1.9, 2, 3.5, 4, 10].map((h) => calcLieuCredit("2026-12-05", h, DEFAULT_LIEU_RULES, ctx).credit)).toEqual([0, 0.5, 0.5, 1, 1]);
  });
  it("weekday thresholds and review", () => {
    const r = [9, 10, 12, 12.5].map((h) => calcLieuCredit("2026-12-02", h, DEFAULT_LIEU_RULES, ctx));
    expect(r.map((x) => x.credit)).toEqual([0, 0.5, 0.5, 0.5]);
    expect(r.map((x) => x.needsReview)).toEqual([false, false, false, true]);
  });
  it("holiday", () => {
    expect(calcLieuCredit("2026-10-12", 8, DEFAULT_LIEU_RULES, ctx)).toMatchObject({ dayType: "holiday", category: "statutory" });
  });
});

describe("leave day counting", () => {
  it("skips weekends and holidays", () => {
    expect(countLeaveDays("2026-12-21", "2027-01-01", "full", ctx).days).toBe(7);
    expect(countLeaveDays("2026-11-16", "2026-11-16", "am", ctx).days).toBe(0.5);
    expect(countLeaveDays("2026-11-16", "2026-11-17", "am", ctx).days).toBe(0);
  });
  it("statutory minimum", () => {
    expect(statutoryMinimumDays(4)).toBe(10);
    expect(statutoryMinimumDays(5)).toBe(15);
  });
});
