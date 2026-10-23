// Test harness for database-level tests. Every test runs inside a transaction
// that is rolled back, and switches between real Postgres roles/JWT claims so
// Row-Level Security and RPC authorization are exercised exactly as in prod.
import pg from "pg";
import { randomUUID } from "node:crypto";

export const DB_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Return numerics/dates as plain JS numbers/strings.
pg.types.setTypeParser(1700, (v) => parseFloat(v));
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: DB_URL, max: 5 });

export type Person = { id: string; userId: string; name: string };

export class Ctx {
  constructor(public client: pg.PoolClient) {}

  async q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.client.query(sql, params);
    return res.rows as T[];
  }
  async one<T = any>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.q<T>(sql, params);
    return rows[0];
  }

  /** Pin "today" (agency time) for deterministic calculations. */
  async today(date: string) {
    await this.q(`select set_config('app.today', $1, true)`, [date]);
  }

  /** Act as a signed-in user (authenticated role + JWT sub). */
  async as(p: Person | null) {
    await this.q("reset role");
    if (!p) return;
    await this.q(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: p.userId, role: "authenticated" }),
    ]);
    await this.q("set local role authenticated");
  }

  /** Back to superuser (test setup / inspection). */
  async su() {
    await this.q("reset role");
    await this.q(`select set_config('request.jwt.claims', '', true)`);
  }

  /** Run fn inside a savepoint, returning the error message (or null). */
  async err(fn: () => Promise<unknown>): Promise<string | null> {
    await this.q("savepoint t");
    try {
      await fn();
      await this.q("release savepoint t");
      return null;
    } catch (e: any) {
      await this.q("rollback to savepoint t");
      return String(e.message);
    }
  }

  async authUser(email: string): Promise<string> {
    const id = randomUUID();
    await this.su();
    await this.q(`insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`, [id, email]);
    return id;
  }

  /** Bootstrap the first People Admin directly (as the setup script does). */
  async bootstrapAdmin(name = "Ada Admin", start = "2020-01-15"): Promise<Person> {
    const email = `${name.toLowerCase().replace(/\W+/g, ".")}.${randomUUID().slice(0, 6)}@example.test`;
    const userId = await this.authUser(email);
    const { id } = await this.one(
      `insert into employee_profiles (full_name, work_email, start_date, role, user_id)
       values ($1, $2, $3, 'people_admin', $4) returning id`,
      [name, email, start, userId],
    );
    await this.q(
      `insert into vacation_entitlements (employee_id, effective_from, annual_days, year_type, allocation_method)
       values ($1, '2026-01-01', 15, 'calendar', 'upfront')`,
      [id],
    );
    await this.q(`insert into vacation_tracking (employee_id, tracking_start) values ($1, '2026-01-01')`, [id]);
    return { id, userId, name };
  }

  /** Create an employee through the real admin RPC, acting as `admin`. */
  async addEmployee(admin: Person, opts: Partial<EmployeeInput> & { name: string }): Promise<Person> {
    const email = `${opts.name.toLowerCase().replace(/\W+/g, ".")}.${randomUUID().slice(0, 6)}@example.test`;
    const userId = await this.authUser(email);
    await this.as(admin);
    const payload = {
      full_name: opts.name,
      work_email: email,
      job_title: opts.job_title ?? "Producer",
      start_date: opts.start_date ?? "2022-03-01",
      role: opts.role ?? "employee",
      manager_id: opts.manager_id ?? null,
      backup_approver_id: opts.backup_approver_id ?? null,
      annual_days: opts.annual_days ?? 15,
      year_type: opts.year_type ?? "calendar",
      allocation_method: opts.allocation_method ?? "upfront",
      opening_vacation: opts.opening_vacation ?? 0,
      opening_carryover: opts.opening_carryover ?? 0,
      opening_lieu: opts.opening_lieu ?? 0,
      entitlement_effective_from: opts.entitlement_effective_from ?? null,
    };
    const { admin_save_employee: id } = await this.one(`select admin_save_employee($1::jsonb)`, [JSON.stringify(payload)]);
    await this.su();
    return { id, userId, name: opts.name };
  }

  async vacation(p: Person) {
    await this.su();
    await this.q(`select private.sync_vacation($1)`, [p.id]);
    return this.one(`select * from vacation_balance($1)`, [p.id]);
  }
  async lieu(p: Person, category = "discretionary") {
    await this.su();
    return this.one(`select * from lieu_balance($1) where category = $2`, [p.id, category]);
  }
}

export type EmployeeInput = {
  job_title: string;
  start_date: string;
  role: "employee" | "manager" | "people_admin";
  manager_id: string | null;
  backup_approver_id: string | null;
  annual_days: number;
  year_type: "calendar" | "anniversary";
  allocation_method: "upfront" | "accrual";
  opening_vacation: number;
  opening_carryover: number;
  opening_lieu: number;
  entitlement_effective_from: string | null;
};

export async function tx(fn: (c: Ctx) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await fn(new Ctx(client));
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}

/** Standard cast used by many tests: admin, a manager, two employees. */
export async function team(c: Ctx, today = "2026-10-23") {
  await c.today(today);
  const admin = await c.bootstrapAdmin();
  const manager = await c.addEmployee(admin, { name: "Mo Manager", role: "manager", annual_days: 15 });
  const alice = await c.addEmployee(admin, {
    name: "Alice Employee", manager_id: manager.id, annual_days: 10, opening_vacation: 10,
    entitlement_effective_from: "2026-01-01", start_date: "2023-05-10",
  });
  const bob = await c.addEmployee(admin, {
    name: "Bob Employee", manager_id: manager.id, annual_days: 20, opening_vacation: 20,
    entitlement_effective_from: "2026-01-01", start_date: "2021-02-01",
  });
  const carol = await c.addEmployee(admin, { name: "Carol Other", annual_days: 15 }); // no manager → admins approve
  return { admin, manager, alice, bob, carol };
}
