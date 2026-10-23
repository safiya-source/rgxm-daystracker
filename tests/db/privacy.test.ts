import { afterAll, describe, expect, it } from "vitest";
import { pool, team, tx } from "./helpers";

afterAll(() => pool.end());

describe("employee privacy (RLS + RPC authorization)", () => {
  it("employees see only their own profile, entitlement and ledgers", async () => {
    await tx(async (c) => {
      const { alice, bob } = await team(c);
      await c.as(alice);
      const profiles = await c.q(`select id from employee_profiles`);
      expect(profiles.map((r) => r.id)).toEqual([alice.id]);
      const ents = await c.q(`select employee_id from vacation_entitlements`);
      expect(new Set(ents.map((r) => r.employee_id))).toEqual(new Set([alice.id]));
      const vt = await c.q(`select distinct employee_id from vacation_transactions`);
      expect(vt.map((r) => r.employee_id)).toEqual([alice.id]);
      expect(await c.q(`select * from lieu_transactions where employee_id = $1`, [bob.id])).toEqual([]);
      expect(await c.q(`select * from employment_records where employee_id = $1`, [bob.id])).toEqual([]);
      expect(await c.q(`select * from audit_logs`)).toEqual([]);
    });
  });

  it("employees cannot read another employee's balance through RPCs", async () => {
    await tx(async (c) => {
      const { alice, bob } = await team(c);
      await c.as(alice);
      expect(await c.err(() => c.q(`select * from vacation_balance($1)`, [bob.id]))).toMatch(/Not authorised/);
      expect(await c.err(() => c.q(`select * from lieu_balance($1)`, [bob.id]))).toMatch(/Not authorised/);
      expect(await c.err(() => c.q(`select * from recent_activity($1)`, [bob.id]))).toMatch(/Not authorised/);
      expect(await c.err(() => c.q(`select * from admin_employee_table()`))).toMatch(/People Admins/);
      expect(await c.err(() => c.q(`select * from report_vacation()`))).toMatch(/People Admins/);
      expect(await c.err(() => c.q(`select leadership_overview()`))).toMatch(/People Admins/);
      // Own balance works.
      const own = await c.one(`select * from vacation_balance($1)`, [alice.id]);
      expect(own.annual_entitlement).toBe(10);
    });
  });

  it("employees cannot write directly to any table or escalate their role", async () => {
    await tx(async (c) => {
      const { alice } = await team(c);
      await c.as(alice);
      expect(await c.err(() => c.q(`update employee_profiles set role = 'people_admin' where id = $1`, [alice.id]))).toMatch(/permission denied/);
      expect(await c.err(() => c.q(`insert into vacation_transactions (employee_id, txn_type, amount, effective_date) values ($1, 'adjustment', 50, '2026-01-01')`, [alice.id]))).toMatch(/permission denied/);
      expect(await c.err(() => c.q(`insert into lieu_transactions (employee_id, txn_type, amount, effective_date) values ($1, 'adjustment', 5, '2026-01-01')`, [alice.id]))).toMatch(/permission denied/);
      expect(await c.err(() => c.q(`update agency_settings set allow_negative_vacation = true`))).toMatch(/permission denied/);
      const payload = JSON.stringify({ id: alice.id, full_name: "Alice", work_email: "a@x.test", start_date: "2023-05-10", role: "people_admin" });
      expect(await c.err(() => c.q(`select admin_save_employee($1::jsonb)`, [payload]))).toMatch(/People Admins/);
      expect(await c.err(() => c.q(`select admin_adjust_balance($1, 'vacation', 10, 'gift')`, [alice.id]))).toMatch(/People Admins/);
      expect(await c.err(() => c.q(`select admin_set_entitlement($1, '2026-11-01', 30, 'calendar', 'upfront', 'more')`, [alice.id]))).toMatch(/People Admins/);
      expect(await c.err(() => c.q(`select admin_save_settings('{"allow_negative_vacation": true}')`))).toMatch(/People Admins/);
      await c.su();
      const { role } = await c.one(`select role from employee_profiles where id = $1`, [alice.id]);
      expect(role).toBe("employee");
    });
  });

  it("People Admins cannot change their own role", async () => {
    await tx(async (c) => {
      const { admin } = await team(c);
      await c.as(admin);
      const me = await c.one(`select * from employee_profiles where id = $1`, [admin.id]);
      const payload = JSON.stringify({ ...me, role: "employee" });
      expect(await c.err(() => c.q(`select admin_save_employee($1::jsonb)`, [payload]))).toMatch(/own role/);
    });
  });

  it("employees cannot approve their own requests", async () => {
    await tx(async (c) => {
      const { alice } = await team(c);
      await c.as(alice);
      const { submit_time_off: id } = await c.one(`select submit_time_off('vacation', '2026-11-16', '2026-11-17')`);
      expect(await c.err(() => c.q(`select review_time_off($1, 'approved')`, [id]))).toMatch(/not authorised/);
    });
  });

  it("anon has no access at all", async () => {
    await tx(async (c) => {
      await team(c);
      await c.q("set local role anon");
      expect(await c.err(() => c.q(`select * from employee_profiles`))).toMatch(/permission denied/);
      expect(await c.err(() => c.q(`select * from team_calendar('2026-11-01', '2026-11-30')`))).toMatch(/permission denied/);
    });
  });

  it("team calendar shows colleagues only as name + away + dates", async () => {
    await tx(async (c) => {
      const { alice, bob, manager } = await team(c);
      await c.as(bob);
      const { submit_time_off: pendingId } = await c.one(`select submit_time_off('vacation', '2026-11-23', '2026-11-23', 'full', 'medical — private')`);
      const { submit_time_off: approvedId } = await c.one(`select submit_time_off('vacation', '2026-11-16', '2026-11-17', 'full', 'Cottage trip')`);
      await c.as(manager);
      await c.q(`select review_time_off($1, 'approved')`, [approvedId]);

      await c.as(alice);
      const rows = (await c.q(`select * from team_calendar('2026-11-01', '2026-11-30')`)).filter((r) => r.employee_id === bob.id);
      expect(rows.length).toBe(2); // only the approved request; pending is hidden from peers
      for (const r of rows) {
        expect(r.full_name).toBe("Bob Employee");
        expect(r.kind).toBeNull();
        expect(r.can_see_details).toBe(false);
        expect(Object.keys(r)).not.toContain("note");
      }
      expect(await c.q(`select * from time_off_requests where id = $1`, [pendingId])).toEqual([]);

      // Bob's approver sees type and pending requests.
      await c.as(manager);
      const mgrRows = (await c.q(`select * from team_calendar('2026-11-01', '2026-11-30')`)).filter((r) => r.employee_id === bob.id);
      expect(mgrRows.length).toBe(3);
      expect(mgrRows.every((r) => r.kind === "vacation")).toBe(true);
    });
  });

  it("managers see only the people they approve, but can see their balances", async () => {
    await tx(async (c) => {
      const { manager, alice, bob, carol } = await team(c);
      await c.as(manager);
      const ids = (await c.q(`select id from employee_profiles`)).map((r) => r.id).sort();
      expect(ids).toEqual([manager.id, alice.id, bob.id].sort());
      // Balances of direct reports via RPC: allowed (RGXM decision).
      const b = await c.one(`select * from vacation_balance($1)`, [alice.id]);
      expect(b.available).toBe(10);
      // …but not the underlying contract/ledger rows.
      expect(await c.q(`select * from vacation_entitlements where employee_id = $1`, [alice.id])).toEqual([]);
      expect(await c.q(`select * from vacation_transactions where employee_id = $1`, [alice.id])).toEqual([]);
      // No access to someone outside their scope.
      expect(await c.err(() => c.q(`select * from vacation_balance($1)`, [carol.id]))).toMatch(/Not authorised/);
      await c.as(carol);
      const { submit_time_off: id } = await c.one(`select submit_time_off('vacation', '2026-11-16', '2026-11-16')`);
      await c.as(manager);
      expect(await c.err(() => c.q(`select review_time_off($1, 'approved')`, [id]))).toMatch(/not authorised/);
    });
  });

  it("People Admins see everyone; admins' own requests go to their assigned approver", async () => {
    await tx(async (c) => {
      const { admin, alice, bob, carol, manager } = await team(c);
      const owner = await c.addEmployee(admin, { name: "Olive Owner", role: "people_admin" });
      const admin2 = await c.addEmployee(admin, { name: "Ana Admin2", role: "people_admin", manager_id: owner.id, opening_vacation: 10 });
      await c.as(admin);
      const ids = [admin, alice, bob, carol, manager, owner, admin2].map((p) => p.id);
      const count = await c.one(`select count(*)::int as n from employee_profiles where id = any($1)`, [ids]);
      expect(count.n).toBe(7);
      const rows = await c.q(`select * from admin_employee_table()`);
      expect(rows.find((r) => r.id === bob.id).annual_days).toBe(20);

      await c.as(admin2);
      const { submit_time_off: id } = await c.one(`select submit_time_off('vacation', '2026-11-16', '2026-11-16')`);
      await c.as(admin);
      expect(await c.err(() => c.q(`select review_time_off($1, 'approved')`, [id]))).toMatch(/not authorised/);
      await c.as(owner);
      await c.q(`select review_time_off($1, 'approved')`, [id]);
      void alice; void carol; void manager;
    });
  });

  it("deactivated employees lose all access but their history is preserved", async () => {
    await tx(async (c) => {
      const { admin, alice } = await team(c);
      await c.as(alice);
      await c.q(`select submit_time_off('vacation', '2026-11-16', '2026-11-16')`);
      await c.as(admin);
      await c.q(`select admin_set_employee_status($1, 'inactive')`, [alice.id]);
      await c.as(alice);
      expect(await c.q(`select * from employee_profiles`)).toEqual([]);
      expect(await c.q(`select * from vacation_transactions`)).toEqual([]);
      expect(await c.err(() => c.q(`select submit_time_off('vacation', '2026-11-20', '2026-11-20')`))).toMatch(/not active/);
      await c.su();
      const r = await c.one(`select status from time_off_requests where employee_id = $1`, [alice.id]);
      expect(r.status).toBe("cancelled");
      const n = await c.one(`select count(*)::int as n from vacation_transactions where employee_id = $1`, [alice.id]);
      expect(n.n).toBeGreaterThan(0);
    });
  });

  it("ledgers are append-only, even for superusers", async () => {
    await tx(async (c) => {
      const { alice } = await team(c);
      await c.su();
      expect(await c.err(() => c.q(`update vacation_transactions set amount = 99 where employee_id = $1`, [alice.id]))).toMatch(/append-only/);
      expect(await c.err(() => c.q(`delete from vacation_transactions where employee_id = $1`, [alice.id]))).toMatch(/append-only/);
    });
  });
});
