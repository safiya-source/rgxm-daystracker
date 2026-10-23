// The browser previews (TS) must agree with the authoritative SQL functions.
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "./helpers";
import { addDays, nextAnniversary, yearsOfService } from "@/lib/rules/dates";
import { calcLieuCredit, DEFAULT_LIEU_RULES } from "@/lib/rules/lieu";
import { countLeaveDays } from "@/lib/rules/leave";

afterAll(() => pool.end());

function rand(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

describe("TS ↔ SQL parity", () => {
  it("anniversaries and years of service (500 random dates)", async () => {
    const r = rand(42);
    const cases = Array.from({ length: 500 }, () => [addDays("2016-01-01", Math.floor(r() * 3700)), addDays("2024-01-01", Math.floor(r() * 2000))]);
    cases.push(["2020-02-29", "2026-02-28"], ["2020-02-29", "2028-02-28"], ["2020-02-29", "2028-02-29"]);
    const { rows } = await pool.query(
      `select s::text, a::text, next_anniversary(s, a)::text na, years_of_service(s, a) ys
       from unnest($1::date[], $2::date[]) as t(s, a)`, [cases.map((c) => c[0]), cases.map((c) => c[1])]);
    for (const row of rows) {
      expect([row.s, row.a, nextAnniversary(row.s, row.a), yearsOfService(row.s, row.a)]).toEqual([row.s, row.a, row.na, row.ys]);
    }
  });

  it("lieu credit calculation (default rules)", async () => {
    const r = rand(7);
    const cases = Array.from({ length: 300 }, () => [addDays("2026-01-01", Math.floor(r() * 365)), Math.round(r() * 32) / 2 + 0.5]);
    const [{ rows: hol }] = [await pool.query(`select holiday_date::text d from public_holidays`)];
    const ctx = { holidays: new Set(hol.map((h) => h.d)), workingDays: [1, 2, 3, 4, 5] };
    const { rows } = await pool.query(
      `select d::text, h::float, (calc_lieu_credit(d, h)).* from unnest($1::date[], $2::numeric[]) as t(d, h)`,
      [cases.map((c) => c[0]), cases.map((c) => c[1])]);
    for (const row of rows) {
      const ts = calcLieuCredit(row.d, row.h, DEFAULT_LIEU_RULES, ctx);
      expect([row.d, row.h, ts.dayType, ts.credit, ts.needsReview, ts.category])
        .toEqual([row.d, row.h, row.day_type, Number(row.proposed_credit), row.needs_review, row.category]);
    }
  });

  it("working-day counting", async () => {
    const { rows: hol } = await pool.query(`select holiday_date::text d from public_holidays`);
    const ctx = { holidays: new Set(hol.map((h) => h.d)), workingDays: [1, 2, 3, 4, 5] };
    const r = rand(99);
    for (let i = 0; i < 60; i++) {
      const s = addDays("2026-01-01", Math.floor(r() * 700));
      const e = addDays(s, Math.floor(r() * 25));
      const { rows } = await pool.query(`select coalesce(sum(amount), 0)::float n from leave_days($1, $2)`, [s, e]);
      expect([s, e, countLeaveDays(s, e, "full", ctx).days]).toEqual([s, e, rows[0].n]);
    }
  });
});
