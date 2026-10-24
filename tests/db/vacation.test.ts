import { afterAll, describe, expect, it } from "vitest";
import { pool, team, tx } from "./helpers";

afterAll(() => pool.end());

describe("vacation entitlements & balances", () => {
  it("each employee gets their own contractual entitlement", async () => {
    await tx(async (c) => {
      const { alice, bob, admin } = await team(c);
      const x = await c.addEmployee(admin, { name: "Xena", annual_days: 25, start_date: "2015-01-05", opening_vacation: 25 });
      expect((await c.vacation(alice)).annual_entitlement).toBe(10);
      expect((await c.vacation(bob)).annual_entitlement).toBe(20);
      expect((await c.vacation(x)).available).toBe(25);
    });
  });

  it("prorates the first year for a mid-year hire (upfront, rounded up to the half day)", async () => {
    await tx(async (c) => {
      const { admin } = await team(c);
      const n = await c.addEmployee(admin, { name: "New Hire", annual_days: 15, start_date: "2026-07-01" });
      const b = await c.vacation(n);
      // 15 × 184/365 = 7.56 → 8.0
      expect(b.earned).toBe(8);
      expect(b.available).toBe(8);
    });
  });

  it("accrues monthly for progressive accrual, prorating a partial first month", async () => {
    await tx(async (c) => {
      const { admin } = await team(c);
      const full = await c.addEmployee(admin, { name: "Acc Full", annual_days: 12, start_date: "2026-01-01", allocation_method: "accrual" });
      const mid = await c.addEmployee(admin, { name: "Acc Mid", annual_days: 12, start_date: "2026-03-16", allocation_method: "accrual" });
      expect((await c.vacation(full)).available).toBe(9); // Jan–Sep completed
      expect((await c.vacation(mid)).available).toBe(6.52); // 16/31 of March + Apr–Sep
      // Running sync again is idempotent.
      expect((await c.vacation(mid)).available).toBe(6.52);
      // A full year of accrual sums exactly to the entitlement.
      await c.today("2027-01-02");
      const b = await c.vacation(full);
      expect(b.available).toBe(12);
    });
  });

  it("supports employment-anniversary vacation years", async () => {
    await tx(async (c) => {
      const { admin } = await team(c);
      const a = await c.addEmployee(admin, {
        name: "Anni", annual_days: 15, start_date: "2023-05-10", year_type: "anniversary",
        entitlement_effective_from: "2023-05-10",
      });
      const b = await c.vacation(a);
      expect(b.period_start).toBe("2026-05-10");
      expect(b.period_end).toBe("2027-05-09");
      expect(b.available).toBe(60); // four anniversary years allocated
      expect(b.carried_forward).toBe(45);
    });
  });

  it("true-ups an upfront allocation when the entitlement changes mid-year", async () => {
    await tx(async (c) => {
      const { admin, bob } = await team(c);
      await c.as(admin);
      await c.q(`select admin_set_entitlement($1, '2026-07-01', 25, 'calendar', 'upfront', 'Promotion')`, [bob.id]);
      // 20×181/365 + 25×184/365 − 20 = 2.52 → 3.0
      expect((await c.vacation(bob)).available).toBe(23);
      await c.as(admin);
      // Same effective date corrects the entry rather than failing.
      await c.q(`select admin_set_entitlement($1, '2026-07-01', 30, 'calendar', 'upfront', 'Typo fix')`, [bob.id]);
      // 20×181/365 + 30×184/365 − 20 = 5.04 → 5.5
      expect((await c.vacation(bob)).available).toBe(25.5);
      await c.as(admin);
      expect(await c.err(() => c.q(`select admin_set_entitlement($1, '2026-08-01', 30, 'calendar', 'upfront', '')`, [bob.id]))).toMatch(/reason/);
    });
  });

  it("flags entitlements below the Ontario ESA minimum", async () => {
    await tx(async (c) => {
      const r = await c.one(`select statutory_minimum_days('2022-01-01', '2026-10-23') a, statutory_minimum_days('2021-01-01', '2026-10-23') b`);
      expect(r.a).toBe(10);
      expect(r.b).toBe(15);
    });
  });
});

describe("vacation requests", () => {
  it("counts working days only, excluding weekends and Ontario holidays", async () => {
    await tx(async (c) => {
      const { alice } = await team(c);
      await c.as(alice);
      // Dec 21 2026 – Jan 1 2027: Christmas, Boxing Day (Sat) observed Mon Dec 28, New Year's Day.
      const p = await c.one(`select * from preview_time_off('2026-12-21', '2027-01-01')`);
      expect(p.days).toBe(7);
      expect(p.holidays.join()).toMatch(/Christmas/);
      // A weekend-only range has no working days.
      expect(await c.err(() => c.q(`select submit_time_off('vacation', '2026-11-14', '2026-11-15')`))).toMatch(/no working days/);
      // Good Friday 2027
      const gf = await c.one(`select * from preview_time_off('2027-03-26', '2027-03-26')`);
      expect(gf.days).toBe(0);
    });
  });

  it("supports half days and prevents overlapping requests", async () => {
    await tx(async (c) => {
      const { alice } = await team(c);
      await c.as(alice);
      const p = await c.one(`select * from preview_time_off('2026-11-16', '2026-11-16', 'am')`);
      expect(p.days).toBe(0.5);
      await c.q(`select submit_time_off('vacation', '2026-11-16', '2026-11-16', 'am')`);
      await c.q(`select submit_time_off('vacation', '2026-11-16', '2026-11-16', 'pm')`); // other half is fine
      expect(await c.err(() => c.q(`select submit_time_off('vacation', '2026-11-16', '2026-11-16', 'am')`))).toMatch(/already have time off/);
      expect(await c.err(() => c.q(`select submit_time_off('vacation', '2026-11-13', '2026-11-17')`))).toMatch(/already have time off/);
      expect(await c.err(() => c.q(`select submit_time_off('vacation', '2026-11-16', '2026-11-17', 'am')`))).toMatch(/single date/);
      await c.su();
      await c.q(`update agency_settings set allow_half_days = false`);
      await c.as(alice);
      expect(await c.err(() => c.q(`select submit_time_off('vacation', '2026-11-18', '2026-11-18', 'am')`))).toMatch(/turned off/);
    });
  });

  it("pending requests don't deduct; approval does; future approved time counts as booked", async () => {
    await tx(async (c) => {
      const { alice, manager } = await team(c);
      await c.as(alice);
      const { submit_time_off: id } = await c.one(`select submit_time_off('vacation', '2026-11-16', '2026-11-18')`);
      let b = await c.vacation(alice);
      expect([b.available, b.pending, b.available_after_pending]).toEqual([10, 3, 7]);
      await c.as(manager);
      await c.q(`select review_time_off($1, 'approved', 'Enjoy!')`, [id]);
      b = await c.vacation(alice);
      expect([b.available, b.pending, b.booked, b.used]).toEqual([7, 0, 3, 0]);
      // Time passes: booked becomes used.
      await c.today("2026-11-20");
      b = await c.vacation(alice);
      expect([b.booked, b.used, b.available]).toEqual([0, 3, 7]);
      // Notifications were created for the employee and approver.
      await c.su();
      const n = await c.q(`select type from notifications where recipient_id = $1 order by created_at`, [alice.id]);
      expect(n.map((r) => r.type)).toEqual(["vacation_submitted", "vacation_approved"]);
      const m = await c.q(`select type from notifications where recipient_id = $1`, [manager.id]);
      expect(m.map((r) => r.type)).toContain("approval_needed");
    });
  });

  it("flags insufficient balance and blocks the approval unless negative balances are allowed", async () => {
    await tx(async (c) => {
      const { alice, manager, admin } = await team(c);
      await c.as(alice);
      const { submit_time_off: id } = await c.one(`select submit_time_off('vacation', '2026-11-02', '2026-11-16')`); // 11 days
      expect((await c.vacation(alice)).available_after_pending).toBe(-1);
      await c.as(manager);
      expect(await c.err(() => c.q(`select review_time_off($1, 'approved')`, [id]))).toMatch(/Insufficient vacation balance/);
      await c.as(admin);
      await c.q(`select admin_save_settings('{"allow_negative_vacation": true}')`);
      await c.as(manager);
      await c.q(`select review_time_off($1, 'approved')`, [id]);
      expect((await c.vacation(alice)).available).toBe(-1);
    });
  });

  it("declines and cancellations restore balances correctly", async () => {
    await tx(async (c) => {
      const { alice, manager, admin } = await team(c);
      await c.as(alice);
      const { submit_time_off: a } = await c.one(`select submit_time_off('vacation', '2026-11-16', '2026-11-16')`);
      const { submit_time_off: b } = await c.one(`select submit_time_off('vacation', '2026-11-23', '2026-11-24')`);
      const { submit_time_off: d } = await c.one(`select submit_time_off('vacation', '2026-12-01', '2026-12-01')`);
      await c.as(manager);
      await c.q(`select review_time_off($1, 'declined', 'Install week')`, [a]);
      await c.q(`select review_time_off($1, 'approved')`, [b]);
      expect(await c.err(() => c.q(`select review_time_off($1, 'approved')`, [a]))).toMatch(/already been declined/);
      expect((await c.vacation(alice)).available).toBe(8);
      await c.as(alice);
      await c.q(`select cancel_time_off($1, 'Plans changed')`, [b]);
      await c.q(`select cancel_time_off($1)`, [d]);
      let bal = await c.vacation(alice);
      expect([bal.available, bal.pending, bal.booked]).toEqual([10, 0, 0]);
      // Declined dates can be requested again.
      await c.as(alice);
      const { submit_time_off: e } = await c.one(`select submit_time_off('vacation', '2026-11-16', '2026-11-16')`);
      await c.as(manager);
      await c.q(`select review_time_off($1, 'approved')`, [e]);
      // Once started, only leadership can cancel; history is kept.
      await c.today("2026-11-16");
      await c.as(alice);
      expect(await c.err(() => c.q(`select cancel_time_off($1)`, [e]))).toMatch(/only be cancelled by leadership/);
      await c.as(admin);
      await c.q(`select cancel_time_off($1, 'Called in sick instead')`, [e]);
      bal = await c.vacation(alice);
      expect(bal.available).toBe(10);
      await c.su();
      const t = await c.q(`select txn_type, amount from vacation_transactions where employee_id = $1 and request_id is not null order by created_at`, [alice.id]);
      expect(t.map((r) => `${r.txn_type}:${r.amount}`)).toEqual(["usage:-2", "usage_reversal:2", "usage:-1", "usage_reversal:1"]);
    });
  });

  it("documented manual adjustments", async () => {
    await tx(async (c) => {
      const { alice, admin } = await team(c);
      await c.as(admin);
      expect(await c.err(() => c.q(`select admin_adjust_balance($1, 'vacation', 2, '  ')`, [alice.id]))).toMatch(/reason is required/);
      await c.q(`select admin_adjust_balance($1, 'vacation', 1.5, 'Worked through holiday shutdown')`, [alice.id]);
      await c.q(`select admin_adjust_balance($1, 'lieu', -0.5, 'Correction')`, [alice.id]);
      expect((await c.vacation(alice)).available).toBe(11.5);
      expect((await c.lieu(alice)).available).toBe(-0.5);
      await c.su();
      const n = await c.q(`select type from notifications where recipient_id = $1 and type = 'balance_adjusted'`, [alice.id]);
      expect(n.length).toBe(2);
      const audit = await c.one(`select count(*)::int n from audit_logs where table_name = 'vacation_transactions' and new_data->>'employee_id' = $1`, [alice.id]);
      expect(audit.n).toBeGreaterThan(0);
    });
  });
});

describe("annual rollover", () => {
  it("allocates the new year and carries everything forward when there is no cap", async () => {
    await tx(async (c) => {
      const { alice } = await team(c);
      await c.today("2027-01-04");
      const b = await c.vacation(alice);
      expect(b.period_start).toBe("2027-01-01");
      expect([b.carried_forward, b.earned, b.available]).toEqual([10, 10, 20]);
    });
  });

  it("forfeits only the amount above the carryover cap", async () => {
    await tx(async (c) => {
      const { alice, admin, manager } = await team(c);
      await c.as(admin);
      await c.q(`select admin_save_settings('{"carryover_cap_days": 5}')`);
      await c.as(alice);
      const { submit_time_off: id } = await c.one(`select submit_time_off('vacation', '2026-12-14', '2026-12-15')`);
      await c.as(manager);
      await c.q(`select review_time_off($1, 'approved')`, [id]);
      await c.today("2027-01-04");
      const b = await c.vacation(alice);
      // 10 − 2 used = 8 at year end → 3 forfeited, 5 carried, +10 new allocation
      expect([b.carried_forward, b.earned, b.available]).toEqual([5, 10, 15]);
      // idempotent
      expect((await c.vacation(alice)).available).toBe(15);
    });
  });
});
