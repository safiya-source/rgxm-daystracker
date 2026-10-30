// Create the first People Admin for a fresh RGXM Daystracker install.
//   node --env-file=.env.local scripts/bootstrap-admin.mjs "Full Name" email@rgxm.com 2019-04-01 [--password=…]
// Without --password an invitation email is sent (requires SMTP configured in Supabase).
import { createClient } from "@supabase/supabase-js";

const [name, email, startDate] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const password = process.argv.find((a) => a.startsWith("--password="))?.split("=")[1];
if (!name || !email || !startDate) {
  console.error('Usage: node --env-file=.env.local scripts/bootstrap-admin.mjs "Full Name" email 2019-04-01 [--password=…]');
  process.exit(1);
}
const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { count } = await admin.from("employee_profiles").select("id", { count: "exact", head: true }).eq("role", "people_admin");
if (count) {
  console.error("A People Admin already exists — add further admins from the app (Employees → Add employee).");
  process.exit(1);
}

const { data: profile, error: pErr } = await admin.from("employee_profiles")
  .insert({ full_name: name, work_email: email.toLowerCase(), start_date: startDate, role: "people_admin" }).select().single();
if (pErr) throw pErr;

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
await admin.from("vacation_entitlements").insert({ employee_id: profile.id, effective_from: today, annual_days: 15, year_type: "calendar", allocation_method: "upfront", note: "Set during bootstrap — update in Employees" });
await admin.from("vacation_tracking").insert({ employee_id: profile.id, tracking_start: today });

if (password) {
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  console.log(`✓ ${name} can sign in at ${site}/login`);
} else {
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${site}/auth/confirm?next=/auth/set-password` });
  if (error) throw error;
  console.log(`✓ Invitation sent to ${email}`);
}
console.log("Next: sign in, open Settings → Setup to configure the agency, and set this admin's real entitlement.");
