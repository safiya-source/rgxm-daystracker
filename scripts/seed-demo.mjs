// Fictional demonstration data for local development ONLY.
//   node --env-file=.env.local scripts/seed-demo.mjs
// All people and projects below are made up. Every demo account uses the password below.
import { createClient } from "@supabase/supabase-js";

const PASSWORD = "rgxm-demo-2026";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!/127\.0\.0\.1|localhost/.test(url) && !process.argv.includes("--force")) {
  console.error("Refusing to seed demo data into a non-local project (pass --force to override).");
  process.exit(1);
}
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const nextWeekday = (d, isoDow) => { let x = addDays(d, 1); while (((new Date(x + "T12:00:00Z").getUTCDay() + 6) % 7) + 1 !== isoDow) x = addDays(x, 1); return x; };
const prevWeekday = (d, isoDow) => { let x = addDays(d, -1); while (((new Date(x + "T12:00:00Z").getUTCDay() + 6) % 7) + 1 !== isoDow) x = addDays(x, -1); return x; };

const people = [
  { key: "jordan", full_name: "Jordan Rivera", email: "jordan@demo.rgxm.test", job_title: "Managing Director", start_date: "2016-03-14", role: "people_admin", annual_days: 20 },
  { key: "priya", full_name: "Priya Shah", email: "priya@demo.rgxm.test", job_title: "Head of Operations", start_date: "2019-06-03", role: "people_admin", annual_days: 15, manager: "jordan" },
  { key: "marcus", full_name: "Marcus Lee", email: "marcus@demo.rgxm.test", job_title: "Production Director", department: "Production", start_date: "2018-09-10", role: "manager", annual_days: 15, manager: "jordan" },
  { key: "ava", full_name: "Ava Chen", email: "ava@demo.rgxm.test", job_title: "Creative Director", department: "Creative", start_date: "2020-01-06", role: "employee", annual_days: 20, manager: "jordan" },
  { key: "sam", full_name: "Sam Okafor", email: "sam@demo.rgxm.test", job_title: "Senior Producer", department: "Production", start_date: "2021-11-15", role: "employee", annual_days: 15, manager: "marcus", backup: "priya" },
  { key: "lena", full_name: "Lena Novak", email: "lena@demo.rgxm.test", job_title: "Designer", department: "Creative", start_date: "2023-04-24", role: "employee", annual_days: 10, manager: "ava" },
  { key: "theo", full_name: "Theo Martin", email: "theo@demo.rgxm.test", job_title: "Strategist", department: "Strategy", start_date: "2024-12-02", role: "employee", annual_days: 12, allocation_method: "accrual", manager: "priya" },
  { key: "noah", full_name: "Noah Williams", email: "noah@demo.rgxm.test", job_title: "Production Coordinator", department: "Production", start_date: "2026-07-06", role: "employee", annual_days: 10, manager: "marcus" },
];

async function signIn(email) {
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`${email}: ${error.message}`);
  return c;
}
const ok = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

// 1. Auth users
for (const p of people) {
  const r = await service.auth.admin.createUser({ email: p.email, password: PASSWORD, email_confirm: true });
  if (r.error && !/already/.test(r.error.message)) throw r.error;
}

// 2. Bootstrap the first admin (as scripts/bootstrap-admin.mjs would)
const ids = {};
const { data: existing } = await service.from("employee_profiles").select("id, work_email");
for (const e of existing ?? []) ids[people.find((p) => p.email === e.work_email)?.key ?? e.work_email] = e.id;
if (!ids.jordan) {
  const j = people[0];
  const prof = ok(await service.from("employee_profiles").insert({ full_name: j.full_name, work_email: j.email, job_title: j.job_title, start_date: j.start_date, role: "people_admin" }).select().single(), "bootstrap");
  ids.jordan = prof.id;
  const yearStart = today.slice(0, 4) + "-01-01";
  ok(await service.from("vacation_entitlements").insert({ employee_id: prof.id, effective_from: yearStart, annual_days: j.annual_days, year_type: "calendar", allocation_method: "upfront" }), "ent");
  ok(await service.from("vacation_tracking").insert({ employee_id: prof.id, tracking_start: yearStart }), "trk");
  ok(await service.from("vacation_transactions").insert({ employee_id: prof.id, txn_type: "opening_balance", amount: 14, effective_date: yearStart, reason: "Opening vacation balance" }), "open");
}

// 3. Everyone else through the real admin RPC
const jordan = await signIn("jordan@demo.rgxm.test");
for (const p of people.slice(1)) {
  if (ids[p.key]) continue;
  const migrated = p.start_date < today.slice(0, 4) + "-01-01";
  ids[p.key] = ok(await jordan.rpc("admin_save_employee", { payload: {
    full_name: p.full_name, work_email: p.email, job_title: p.job_title, department: p.department ?? null,
    start_date: p.start_date, role: p.role, manager_id: ids[p.manager] ?? null, backup_approver_id: ids[p.backup] ?? null,
    annual_days: p.annual_days, year_type: "calendar", allocation_method: p.allocation_method ?? "upfront",
    entitlement_effective_from: migrated ? today.slice(0, 4) + "-01-01" : null,
    opening_vacation: migrated ? Math.max(0, p.annual_days - 3) : 0,
    opening_carryover: p.key === "ava" ? 2 : 0,
    opening_lieu: p.key === "sam" ? 1 : 0,
  } }), p.full_name);
}
ok(await service.from("employee_profiles").update({ manager_id: ids.priya }).eq("id", ids.jordan), "jordan approver");
ok(await jordan.rpc("admin_save_settings", { payload: { onboarding_completed: true } }), "settings");

// 4. Activity
const as = {};
for (const p of people) as[p.key] = await signIn(p.email);
const mon = nextWeekday(today, 1);
const sat = prevWeekday(today, 6), sun = addDays(sat, 1);
const prevSat = addDays(sat, -7);

const sam1 = ok(await as.sam.rpc("submit_time_off", { kind: "vacation", start_date: addDays(mon, 7), end_date: addDays(mon, 11), note: "Family trip" }), "sam vac");
ok(await as.marcus.rpc("review_time_off", { request_id: sam1, decision: "approved", note: "Have a great trip!" }), "approve sam");
ok(await as.lena.rpc("submit_time_off", { kind: "vacation", start_date: addDays(mon, 8), end_date: addDays(mon, 9) }), "lena vac");
const ava1 = ok(await as.ava.rpc("submit_time_off", { kind: "vacation", start_date: addDays(mon, 9), end_date: addDays(mon, 10) }), "ava vac");
ok(await as.jordan.rpc("review_time_off", { request_id: ava1, decision: "approved" }), "approve ava");
const priya1 = ok(await as.priya.rpc("submit_time_off", { kind: "vacation", start_date: addDays(mon, 2), end_date: addDays(mon, 2), portion: "pm" }), "priya");
ok(await as.jordan.rpc("review_time_off", { request_id: priya1, decision: "approved" }), "approve priya");

const taco = ok(await as.jordan.rpc("create_project", { name: "Taco Bell – Diablo Maple", client: "Taco Bell Canada" }), "project");
const fest = ok(await as.jordan.rpc("create_project", { name: "Northern Lights Music Fest – Brand Village" }), "project2");
ok(await as.jordan.rpc("bulk_lieu", { project_id: taco, note: "Weekend activation", rows: [
  { employee_id: ids.sam, work_date: prevSat, hours: 6 }, { employee_id: ids.sam, work_date: addDays(prevSat, 1), hours: 6 },
  { employee_id: ids.lena, work_date: prevSat, hours: 5 },
  { employee_id: ids.theo, work_date: prevSat, hours: 3 }, { employee_id: ids.theo, work_date: addDays(prevSat, 1), hours: 5 },
] }), "bulk");
ok(await as.noah.rpc("submit_lieu", { project_id: fest, entries: [{ work_date: sat, hours: 6 }, { work_date: sun, hours: 3 }] }), "noah lieu");
ok(await as.ava.rpc("submit_lieu", { project_id: fest, entries: [{ work_date: addDays(sat, -2), hours: 13 }], note: "Load-in ran late" }), "ava lieu");
ok(await as.theo.rpc("submit_time_off", { kind: "lieu", start_date: addDays(mon, 4), end_date: addDays(mon, 4) }), "theo lieu use");

console.log(`✓ Demo data loaded. Sign in at http://localhost:3000/login with any of:`);
for (const p of people) console.log(`   ${p.email.padEnd(26)} ${p.role.padEnd(13)} ${p.full_name}`);
console.log(`   password: ${PASSWORD}`);
