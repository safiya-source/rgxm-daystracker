import { afterAll, describe, expect, it } from "vitest";
import { Ctx, Person, pool, team, tx } from "./helpers";

afterAll(() => pool.end());

async function project(c: Ctx, as: Person, name = "Taco Bell – Diablo Maple") {
  await c.as(as);
  const { create_project: id } = await c.one(`select create_project($1)`, [name]);
  return id as string;
}
const entries = (rows: [string, number][]) => JSON.stringify(rows.map(([work_date, hours]) => ({ work_date, hours })));

describe("lieu calculation rules", () => {
  it("weekend thresholds: <2h → 0, 2–<4h → 0.5, 4h+ → 1", async () => {
    await tx(async (c) => {
      await team(c);
      const r = await c.q(
        `select h, (calc_lieu_credit('2026-10-17', h)).* from unnest(array[1.5, 2, 3.99, 4, 6, 14]::numeric[]) h`,
      );
      expect(r.map((x) => x.proposed_credit)).toEqual([0, 0.5, 0.5, 1, 1, 1]);
      expect(r.every((x) => x.day_type === "weekend" && !x.needs_review)).toBe(true);
    });
  });

  it("extended weekdays: <10h → 0, 10–12h → 0.5, >12h → leadership review", async () => {
    await tx(async (c) => {
      await team(c);
      const r = await c.q(
        `select h, (calc_lieu_credit('2026-10-14', h)).* from unnest(array[8, 9.5, 10, 12, 12.5]::numeric[]) h`,
      );
      expect(r.map((x) => x.proposed_credit)).toEqual([0, 0, 0.5, 0.5, 0.5]);
      expect(r.map((x) => x.needs_review)).toEqual([false, false, false, false, true]);
    });
  });

  it("public holidays are flagged as statutory for People Admin review", async () => {
    await tx(async (c) => {
      await team(c);
      const r = await c.one(`select * from calc_lieu_credit('2026-10-12', 8)`); // Thanksgiving
      expect(r).toMatchObject({ day_type: "holiday", category: "statutory", needs_review: true, proposed_credit: 1 });
    });
  });

  it("rule changes are versioned and never rewrite history", async () => {
    await tx(async (c) => {
      const { admin, alice } = await team(c);
      const pid = await project(c, alice);
      await c.as(alice);
      const { submit_lieu: sub } = await c.one(`select submit_lieu($1, $2)`, [pid, entries([["2026-10-17", 4]])]);
      await c.as(admin);
      await c.q(`select admin_save_lieu_rules($1::jsonb, '2026-10-24')`, [JSON.stringify({
        weekend_half_min_hours: 2, weekend_half_credit: 0.5, weekend_full_min_hours: 5, weekend_full_credit: 1,
        weekday_min_hours: 10, weekday_credit: 0.5, weekday_review_above_hours: 12,
      })]);
      await c.today("2026-10-26");
      expect((await c.one(`select * from calc_lieu_credit('2026-10-17', 4)`)).proposed_credit).toBe(1);
      expect((await c.one(`select * from calc_lieu_credit('2026-10-24', 4)`)).proposed_credit).toBe(0.5);
      await c.su();
      const e = await c.one(`select proposed_credit from lieu_work_entries where submission_id = $1`, [sub]);
      expect(e.proposed_credit).toBe(1);
      await c.as(admin);
      expect(await c.err(() => c.q(`select admin_save_lieu_rules('{}'::jsonb, '2026-01-01')`))).toMatch(/on or after/);
    });
  });
});

describe("employee lieu submissions", () => {
  it("multi-day submission from the spec example totals 1.5 days", async () => {
    await tx(async (c) => {
      const { alice, manager } = await team(c, "2026-12-08");
      const pid = await project(c, alice);
      await c.as(alice);
      const { submit_lieu: sub } = await c.one(`select submit_lieu($1, $2)`, [pid, entries([["2026-12-05", 6], ["2026-12-06", 3]])]);
      let l = await c.lieu(alice);
      expect([l.pending_credits, l.available]).toEqual([1.5, 0]);
      await c.as(manager);
      const rows = await c.q(`select work_date, hours, proposed_credit from lieu_work_entries where submission_id = $1 order by work_date`, [sub]);
      expect(rows.map((r) => r.proposed_credit)).toEqual([1, 0.5]);
      await c.q(`select review_lieu($1, 'approved')`, [sub]);
      l = await c.lieu(alice);
      expect([l.pending_credits, l.earned, l.available]).toEqual([0, 1.5, 1.5]);
      await c.su();
      const n = await c.q(`select type from notifications where recipient_id = $1 order by created_at`, [alice.id]);
      expect(n.map((x) => x.type)).toEqual(["lieu_submitted", "lieu_approved"]);
    });
  });

  it("prevents duplicate credits for the same employee and date", async () => {
    await tx(async (c) => {
      const { alice, bob, manager } = await team(c);
      const p1 = await project(c, alice);
      const p2 = await project(c, alice, "Another Activation");
      await c.as(alice);
      const { submit_lieu: s1 } = await c.one(`select submit_lieu($1, $2)`, [p1, entries([["2026-10-17", 5]])]);
      expect(await c.err(() => c.q(`select submit_lieu($1, $2)`, [p1, entries([["2026-10-17", 5]])]))).toMatch(/already been logged/);
      expect(await c.err(() => c.q(`select submit_lieu($1, $2)`, [p2, entries([["2026-10-17", 3]])]))).toMatch(/already been logged/);
      expect(await c.err(() => c.q(`select submit_lieu($1, $2)`, [p2, entries([["2026-10-18", 3], ["2026-10-18", 4]])]))).toMatch(/more than once/);
      expect(await c.err(() => c.q(`select submit_lieu($1, $2)`, [p2, entries([["2026-10-31", 3]])]))).toMatch(/future/);
      // Another employee on the same date is fine.
      await c.as(bob);
      await c.q(`select submit_lieu($1, $2)`, [p1, entries([["2026-10-17", 5]])]);
      // After a decline, the date frees up again.
      await c.as(manager);
      await c.q(`select review_lieu($1, 'declined', 'Was a regular day')`, [s1]);
      await c.as(alice);
      await c.q(`select submit_lieu($1, $2)`, [p1, entries([["2026-10-17", 5]])]);
    });
  });

  it("request changes → resubmit → approve with documented adjustment", async () => {
    await tx(async (c) => {
      const { alice, manager } = await team(c);
      const pid = await project(c, alice);
      await c.as(alice);
      const { submit_lieu: sub } = await c.one(`select submit_lieu($1, $2)`, [pid, entries([["2026-10-17", 3], ["2026-10-14", 13]])]);
      await c.as(manager);
      expect(await c.err(() => c.q(`select review_lieu($1, 'changes_requested')`, [sub]))).toMatch(/what to change/);
      await c.q(`select review_lieu($1, 'changes_requested', 'Saturday was 5 hours I think?')`, [sub]);
      await c.as(alice);
      await c.q(`select submit_lieu($1, $2, null, $3)`, [pid, entries([["2026-10-17", 5], ["2026-10-14", 13]]), sub]);
      await c.as(manager);
      const es = await c.q(`select id, work_date, proposed_credit, needs_review from lieu_work_entries where submission_id = $1 order by work_date`, [sub]);
      expect(es.map((e) => [e.proposed_credit, e.needs_review])).toEqual([[0.5, true], [1, false]]);
      const adj = JSON.stringify([{ entry_id: es[0].id, approved_credit: 1 }]);
      expect(await c.err(() => c.q(`select review_lieu($1, 'approved', null, $2)`, [sub, adj]))).toMatch(/reason/);
      await c.q(`select review_lieu($1, 'approved', null, $2, '15-hour install day')`, [sub, adj]);
      expect((await c.lieu(alice)).available).toBe(2);
      await c.su();
      const acts = await c.q(`select action from approval_records where subject_id = $1 order by created_at`, [sub]);
      expect(acts.map((a) => a.action)).toEqual(["submitted", "changes_requested", "resubmitted", "adjusted", "approved"]);
    });
  });

  it("statutory and discretionary lieu are tracked separately", async () => {
    await tx(async (c) => {
      const { admin, carol } = await team(c);
      const pid = await project(c, carol);
      await c.as(carol);
      const { submit_lieu: sub } = await c.one(`select submit_lieu($1, $2)`, [pid, entries([["2026-10-12", 8], ["2026-10-17", 8]])]);
      await c.as(admin);
      await c.q(`select review_lieu($1, 'approved')`, [sub]);
      expect((await c.lieu(carol, "statutory")).available).toBe(1);
      expect((await c.lieu(carol, "discretionary")).available).toBe(1);
      await c.as(carol);
      expect(await c.err(() => c.q(`select submit_time_off('lieu', '2026-11-02', '2026-11-03', 'full', null, 'statutory')`))).toMatch(/Not enough lieu/);
      await c.q(`select submit_time_off('lieu', '2026-11-02', '2026-11-02', 'full', null, 'statutory')`);
    });
  });
});

describe("leadership bulk lieu entry", () => {
  it("credits several employees at once (spec example) and blocks duplicates", async () => {
    await tx(async (c) => {
      const { admin, alice, bob, carol } = await team(c, "2026-12-08");
      const pid = await project(c, admin);
      const rows = JSON.stringify([
        { employee_id: alice.id, work_date: "2026-12-05", hours: 6 }, { employee_id: alice.id, work_date: "2026-12-06", hours: 6 },
        { employee_id: bob.id, work_date: "2026-12-05", hours: 5 }, { employee_id: bob.id, work_date: "2026-12-06", hours: 0 },
        { employee_id: carol.id, work_date: "2026-12-05", hours: 3 }, { employee_id: carol.id, work_date: "2026-12-06", hours: 5 },
      ]);
      await c.as(admin);
      const preview = await c.q(`select * from preview_bulk_lieu($1, $2)`, [pid, rows]);
      expect(preview.length).toBe(5);
      const res = await c.q(`select * from bulk_lieu($1, $2, 'Weekend activation')`, [pid, rows]);
      const totals = Object.fromEntries(res.map((r) => [r.employee_id, [r.status, r.total]]));
      expect(totals[alice.id]).toEqual(["approved", 2]);
      expect(totals[bob.id]).toEqual(["approved", 1]);
      expect(totals[carol.id]).toEqual(["approved", 1.5]);
      expect((await c.lieu(alice)).available).toBe(2);
      expect((await c.lieu(carol)).available).toBe(1.5);

      await c.as(admin);
      const again = await c.q(`select * from preview_bulk_lieu($1, $2)`, [pid, rows]);
      expect(again.every((r) => r.conflict)).toBe(true);
      expect(await c.err(() => c.q(`select * from bulk_lieu($1, $2)`, [pid, rows]))).toMatch(/already been logged/);
      // Report
      const rep = await c.q(`select * from report_project($1)`, [pid]);
      expect(rep.reduce((s, r) => s + r.approved_credit, 0)).toBe(4.5);
    });
  });

  it("an admin's own bulk credit and flagged days wait for review", async () => {
    await tx(async (c) => {
      const { admin, alice } = await team(c);
      const pid = await project(c, admin);
      await c.as(admin);
      const res = await c.q(`select * from bulk_lieu($1, $2)`, [pid, JSON.stringify([
        { employee_id: admin.id, work_date: "2026-10-17", hours: 6 },
        { employee_id: alice.id, work_date: "2026-10-14", hours: 14 },
      ])]);
      expect(res.every((r) => r.status === "pending")).toBe(true);
      expect((await c.lieu(admin)).available).toBe(0);
    });
  });

  it("only People Admins can bulk-enter", async () => {
    await tx(async (c) => {
      const { manager, alice } = await team(c);
      const pid = await project(c, manager);
      await c.as(manager);
      expect(await c.err(() => c.q(`select * from bulk_lieu($1, $2)`, [pid, JSON.stringify([{ employee_id: alice.id, work_date: "2026-10-17", hours: 6 }])]))).toMatch(/People Admins/);
    });
  });
});

describe("using lieu time", () => {
  it("checks balance, deducts on approval, restores on cancellation", async () => {
    await tx(async (c) => {
      const { alice, manager, admin } = await team(c);
      await c.as(admin);
      await c.q(`select admin_adjust_balance($1, 'lieu', 1.5, 'Opening balance correction')`, [alice.id]);
      await c.as(alice);
      expect(await c.err(() => c.q(`select submit_time_off('lieu', '2026-11-02', '2026-11-03')`))).toMatch(/Not enough lieu/);
      const { submit_time_off: id } = await c.one(`select submit_time_off('lieu', '2026-11-02', '2026-11-02')`);
      // Pending usage is reserved against new requests.
      expect(await c.err(() => c.q(`select submit_time_off('lieu', '2026-11-04', '2026-11-04')`))).toMatch(/Not enough lieu/);
      await c.q(`select submit_time_off('lieu', '2026-11-04', '2026-11-04', 'am')`);
      await c.as(manager);
      await c.q(`select review_time_off($1, 'approved')`, [id]);
      let l = await c.lieu(alice);
      expect([l.available, l.booked, l.pending_usage]).toEqual([0.5, 1, 0.5]);
      await c.as(alice);
      await c.q(`select cancel_time_off($1)`, [id]);
      l = await c.lieu(alice);
      expect([l.available, l.booked]).toEqual([1.5, 0]);
    });
  });

  it("advance lieu days for a project offset the later credit; banked lieu and PTO don't", async () => {
    await tx(async (c) => {
      const { alice, manager } = await team(c, "2026-12-01");
      const pid = await project(c, alice);
      // "Long week ahead — take Wednesday off": advance day with zero balance is allowed.
      await c.as(manager);
      const { submit_time_off: adv } = await c.one(
        `select submit_time_off('lieu', '2026-12-02', '2026-12-02', 'full', 'Rest before install', 'discretionary', true, $1, $2)`,
        [pid, alice.id],
      );
      await c.q(`select review_time_off($1, 'approved')`, [adv]);
      expect((await c.lieu(alice)).available).toBe(-1);
      await c.today("2026-12-08");
      await c.as(alice);
      const { submit_lieu: sub } = await c.one(`select submit_lieu($1, $2)`, [pid, entries([["2026-12-05", 8], ["2026-12-06", 8]])]);
      await c.as(manager);
      const ctx = await c.one(`select * from lieu_review_context($1)`, [sub]);
      expect(ctx.advance_days.length).toBe(1);
      expect(ctx.advance_days[0].same_project).toBe(true);
      await c.q(`select review_lieu($1, 'approved')`, [sub]);
      expect((await c.lieu(alice)).available).toBe(1); // 2 earned − 1 advance
    });
  });
});

describe("lieu expiry (optional setting)", () => {
  it("expires unused credits FIFO after the configured months", async () => {
    await tx(async (c) => {
      const { admin, alice, manager } = await team(c, "2026-01-15");
      const pid = await project(c, admin);
      await c.as(admin);
      await c.q(`select * from bulk_lieu($1, $2)`, [pid, JSON.stringify([{ employee_id: alice.id, work_date: "2026-01-10", hours: 6 }])]);
      await c.q(`select admin_save_settings('{"lieu_expiry_months": 6}')`);
      await c.as(alice);
      const { submit_time_off: id } = await c.one(`select submit_time_off('lieu', '2026-01-20', '2026-01-20', 'am')`);
      await c.as(manager);
      await c.q(`select review_time_off($1, 'approved')`, [id]);
      await c.today("2026-08-01");
      await c.su();
      await c.q(`select private.expire_lieu($1)`, [alice.id]);
      await c.q(`select private.expire_lieu($1)`, [alice.id]); // idempotent
      expect((await c.lieu(alice)).available).toBe(0);
    });
  });
});
