// Real concurrent transactions on separate connections (committed data, cleaned up after).
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { Ctx, pool, team } from "./helpers";

const created: string[] = [];

async function asUser(client: pg.PoolClient, userId: string) {
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: "authenticated" })]);
  await client.query("set local role authenticated");
}

async function race(userA: string, userB: string, sqlA: string, sqlB: string, params: unknown[][]) {
  const a = await pool.connect();
  const b = await pool.connect();
  try {
    await a.query("begin"); await b.query("begin");
    await asUser(a, userA); await asUser(b, userB);
    await a.query(`select set_config('app.today', '2026-10-23', true)`);
    await b.query(`select set_config('app.today', '2026-10-23', true)`);
    const run = async (c: pg.PoolClient, sql: string, p: unknown[]) => {
      try { await c.query(sql, p); await c.query("commit"); return "ok"; }
      catch (e: any) { await c.query("rollback"); return String(e.message); }
    };
    return await Promise.all([run(a, sqlA, params[0]), run(b, sqlB, params[1])]);
  } finally { a.release(); b.release(); }
}

afterAll(async () => {
  // Remove committed fixtures (bypassing append-only triggers via replica mode).
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local session_replication_role = replica");
    for (const t of ["notifications", "approval_records", "vacation_transactions", "lieu_transactions", "time_off_request_days",
      "time_off_requests", "lieu_work_entries", "lieu_submissions", "employment_records", "vacation_entitlements", "vacation_tracking"]) {
      await c.query(`delete from public.${t} where ${t === "notifications" ? "recipient_id" : t === "approval_records" ? "subject_employee_id" : "employee_id"} = any($1)`, [created]);
    }
    await c.query(`delete from public.projects where created_by = any($1)`, [created]);
    const users = await c.query(`select user_id from public.employee_profiles where id = any($1)`, [created]);
    await c.query(`delete from public.employee_profiles where id = any($1)`, [created]);
    await c.query(`delete from auth.users where id = any($1)`, [users.rows.map((r) => r.user_id)]);
    await c.query("commit");
  } finally { c.release(); }
  await pool.end();
});

describe("concurrent approvals", () => {
  it("two approvers approving the same request at once post exactly one deduction", async () => {
    const setup = await pool.connect();
    const c = new Ctx(setup);
    await setup.query("begin");
    const t = await team(c);
    created.push(...Object.values(t).map((p) => p.id));
    await c.as(t.alice);
    const { submit_time_off: id } = await c.one(`select submit_time_off('vacation', '2026-11-16', '2026-11-18')`);
    await setup.query("commit");
    setup.release();

    const results = await race(t.manager.userId, t.admin.userId,
      `select review_time_off($1, 'approved')`, `select review_time_off($1, 'approved')`, [[id], [id]]);
    expect(results.filter((r) => r === "ok").length).toBe(1);
    expect(results.find((r) => r !== "ok")).toMatch(/already been approved/);

    const { rows } = await pool.query(`select count(*)::int n, sum(amount)::float s from vacation_transactions where request_id = $1`, [id]);
    expect(rows[0]).toEqual({ n: 1, s: -3 });
  });

  it("approve vs decline race leaves a single consistent outcome", async () => {
    const setup = await pool.connect();
    const c = new Ctx(setup);
    await setup.query("begin");
    const t = await team(c);
    created.push(...Object.values(t).map((p) => p.id));
    await c.as(t.bob);
    const { create_project: pid } = await c.one(`select create_project('Race Project ' || gen_random_uuid())`);
    const { submit_lieu: sub } = await c.one(`select submit_lieu($1, '[{"work_date":"2026-10-17","hours":6}]')`, [pid]);
    await setup.query("commit");
    setup.release();

    const results = await race(t.manager.userId, t.admin.userId,
      `select review_lieu($1, 'approved')`, `select review_lieu($1, 'declined', 'no')`, [[sub], [sub]]);
    expect(results.filter((r) => r === "ok").length).toBe(1);
    const { rows } = await pool.query(`select status, (select coalesce(sum(amount),0)::float from lieu_transactions where submission_id = $1) credited from lieu_submissions where id = $1`, [sub]);
    expect(rows[0].credited).toBe(rows[0].status === "approved" ? 1 : 0);
  });

  it("simultaneous submissions for the same work date cannot both succeed", async () => {
    const setup = await pool.connect();
    const c = new Ctx(setup);
    await setup.query("begin");
    const t = await team(c);
    created.push(...Object.values(t).map((p) => p.id));
    await c.as(t.carol);
    const { create_project: pid } = await c.one(`select create_project('Dup Project ' || gen_random_uuid())`);
    await setup.query("commit");
    setup.release();

    const sql = `select submit_lieu($1, '[{"work_date":"2026-10-18","hours":5}]')`;
    const results = await race(t.carol.userId, t.carol.userId, sql, sql, [[pid], [pid]]);
    expect(results.filter((r) => r === "ok").length).toBe(1);
    const { rows } = await pool.query(`select count(*)::int n from lieu_work_entries where employee_id = $1 and is_active`, [t.carol.id]);
    expect(rows[0].n).toBe(1);
  });
});
