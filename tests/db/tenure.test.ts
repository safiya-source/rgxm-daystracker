import { afterAll, describe, expect, it } from "vitest";
import { pool, team, tx } from "./helpers";

afterAll(() => pool.end());

describe("tenure & anniversaries (database)", () => {
  it("computes next anniversary and years, including Feb 29 starts", async () => {
    const { rows } = await pool.query(`select
      next_anniversary('2020-02-29', '2026-03-01')::text a, next_anniversary('2024-02-29', '2028-01-10')::text b,
      next_anniversary('2026-10-23', '2026-10-23')::text c, next_anniversary('2021-10-23', '2026-10-23')::text d,
      years_of_service('2024-02-29', '2025-02-28') e, years_of_service('2020-11-12', '2026-11-11') f`);
    expect(rows[0]).toEqual({ a: "2027-02-28", b: "2028-02-29", c: "2027-10-23", d: "2026-10-23", e: 1, f: 5 });
  });

  it("lists upcoming anniversaries and sends reminders at 30 / 7 / 0 days", async () => {
    await tx(async (c) => {
      const { admin } = await team(c, "2026-10-13");
      const e = await c.addEmployee(admin, { name: "Annie Versary", start_date: "2024-11-12", opening_vacation: 10 });
      await c.as(admin);
      const up = await c.q(`select * from upcoming_anniversaries(30)`);
      const row = up.find((r) => r.employee_id === e.id);
      expect(row).toMatchObject({ anniversary: "2026-11-12", years: 2, days_until: 30 });
      await c.su();
      await c.q(`select private.daily_maintenance()`);
      await c.q(`select private.daily_maintenance()`); // de-duplicated
      const n = await c.q(`select title from notifications where recipient_id = $1 and type = 'anniversary'`, [admin.id]);
      expect(n.map((x) => x.title)).toEqual(["In 30 days: Annie Versary — 2 year work anniversary"]);
    });
  });
});
