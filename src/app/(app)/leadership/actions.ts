"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import { attempt, check, num, str } from "@/lib/actions";
import type { ActionResult } from "@/components/forms";
import type { Database, Json } from "@/lib/database.types";

type Enums = Database["public"]["Enums"];

/** The approve/decline choice: hidden field (JS) or the clicked button (no-JS fallback). */
const decisionOf = (f: FormData) => f.getAll("decision").map(String).find(Boolean) ?? "";

const done = (msg: string) => {
  revalidatePath("/", "layout");
  return msg;
};

// --- Approvals -------------------------------------------------------------

export async function reviewRequest(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const decision = decisionOf(f);
    check(await supabase.rpc("review_time_off", { request_id: str(f, "id"), decision, note: str(f, "note") || undefined }));
    return done(decision === "approved" ? "Approved" : "Declined");
  });
}

export async function leaderCancelRequest(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    check(await supabase.rpc("cancel_time_off", { request_id: str(f, "id"), reason: str(f, "reason") || undefined }));
    return done("Cancelled and balance restored");
  });
}

export async function reviewLieu(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const decision = decisionOf(f);
    const adjustments = f.getAll("entry_id").map((id, i) => ({
      entry_id: String(id),
      approved_credit: Number(f.getAll("approved_credit")[i]),
      category: String(f.getAll("category")[i] ?? ""),
    }));
    check(await supabase.rpc("review_lieu", {
      submission_id: str(f, "id"), decision, note: str(f, "note") || undefined,
      adjustments: decision === "approved" ? adjustments : [], adjustment_reason: str(f, "adjustment_reason") || undefined,
    }));
    return done(decision === "approved" ? "Lieu approved" : decision === "declined" ? "Declined" : "Sent back for changes");
  });
}

export type BulkPreviewRow = Database["public"]["Functions"]["preview_bulk_lieu"]["Returns"][number];

export async function previewBulk(projectId: string, rows: { employee_id: string; work_date: string; hours: number }[]) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_bulk_lieu", { project_id: projectId, rows });
  return { rows: data ?? [], error: error?.message };
}

export async function commitBulk(projectId: string, rows: { employee_id: string; work_date: string; hours: number }[], note: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bulk_lieu", { project_id: projectId, rows, note: note || undefined });
  if (!error) revalidatePath("/", "layout");
  return { result: data ?? [], error: error?.message };
}

export async function createProject(name: string, client?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_project", { name, client: client || undefined });
  return { id: data, error: error?.message };
}

export async function recordAdvanceDay(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const id = check(await supabase.rpc("submit_time_off", {
      kind: "lieu", start_date: str(f, "date"), end_date: str(f, "date"), portion: (str(f, "portion") || "full") as Enums["day_portion"],
      note: str(f, "note") || undefined, lieu_category: "discretionary", is_advance: true,
      project_id: str(f, "project_id"), for_employee: str(f, "employee_id"),
    }));
    // Recording it is the leadership decision, so approve straight away.
    check(await supabase.rpc("review_time_off", { request_id: id as string, decision: "approved", note: "Advance lieu day" }));
    return done("Advance lieu day recorded and approved");
  });
}

// --- Employees ---------------------------------------------------------------

function employeePayload(f: FormData) {
  return {
    id: str(f, "id") || null,
    full_name: str(f, "full_name"),
    work_email: str(f, "work_email"),
    job_title: str(f, "job_title"),
    department: str(f, "department"),
    start_date: str(f, "start_date"),
    status: str(f, "status") || "active",
    role: str(f, "role") || "employee",
    manager_id: str(f, "manager_id"),
    backup_approver_id: str(f, "backup_approver_id"),
    standard_day_hours: str(f, "standard_day_hours"),
    annual_days: num(f, "annual_days"),
    year_type: str(f, "year_type"),
    allocation_method: str(f, "allocation_method"),
    entitlement_effective_from: str(f, "entitlement_effective_from"),
    opening_vacation: num(f, "opening_vacation") ?? 0,
    opening_carryover: num(f, "opening_carryover") ?? 0,
    opening_lieu: num(f, "opening_lieu") ?? 0,
  };
}

export async function saveEmployee(_: ActionResult, f: FormData): Promise<ActionResult> {
  let id = "";
  const res = await attempt(async () => {
    await requireAdmin();
    const payload = employeePayload(f);
    if (!payload.full_name || !payload.work_email || !payload.start_date) throw new Error("Name, email and start date are required");
    const supabase = await createClient();
    id = check(await supabase.rpc("admin_save_employee", { payload })) as string;
    // Keep auth access in sync with status.
    if (payload.id) await syncBan(id);
  });
  if (res?.error) return res;
  revalidatePath("/", "layout");
  redirect(`/leadership/employees/${id}?saved=1`);
}

async function syncBan(employeeId: string) {
  const supabase = await createClient();
  const { data: p } = await supabase.from("employee_profiles").select("user_id, status").eq("id", employeeId).single();
  if (p?.user_id) {
    await createAdminClient().auth.admin.updateUserById(p.user_id, { ban_duration: p.status === "inactive" ? "876000h" : "none" });
  }
}

export async function setEmployeeStatus(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    await requireAdmin();
    const supabase = await createClient();
    const status = str(f, "status") as Enums["employment_status"];
    check(await supabase.rpc("admin_set_employee_status", { emp: str(f, "id"), new_status: status }));
    await syncBan(str(f, "id"));
    return done(status === "inactive" ? "Employee deactivated. Their sign-in is disabled and history is kept." : "Employee reactivated");
  });
}

export async function changeEntitlement(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    check(await supabase.rpc("admin_set_entitlement", {
      emp: str(f, "id"), effective_from: str(f, "effective_from"), annual_days: Number(str(f, "annual_days")),
      year_type: str(f, "year_type") as Enums["vacation_year_type"], allocation_method: str(f, "allocation_method") as Enums["allocation_method"],
      note: str(f, "note"),
    }));
    return done("Entitlement updated");
  });
}

export async function adjustBalance(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const sign = str(f, "direction") === "remove" ? -1 : 1;
    check(await supabase.rpc("admin_adjust_balance", {
      emp: str(f, "id"), ledger: str(f, "ledger"), amount: sign * Math.abs(Number(str(f, "amount"))), reason: str(f, "reason"),
      category: (str(f, "category") || "discretionary") as Enums["lieu_category"],
    }));
    return done("Balance adjusted");
  });
}

async function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

/** Send (or re-send) a secure invitation. Existing accounts get a password-reset link instead. */
async function invite(employeeId: string) {
  await requireAdmin();
  const supabase = await createClient();
  const { data: p } = await supabase.from("employee_profiles").select("id, work_email, user_id, status").eq("id", employeeId).single();
  if (!p) throw new Error("Employee not found");
  if (p.status !== "active") throw new Error("Reactivate this employee before inviting them");
  const redirectTo = `${await siteUrl()}/auth/confirm?next=/auth/set-password`;
  if (p.user_id) {
    const { error } = await supabase.auth.resetPasswordForEmail(p.work_email, { redirectTo });
    if (error) throw error;
  } else {
    const { error } = await createAdminClient().auth.admin.inviteUserByEmail(p.work_email, { redirectTo });
    if (error) throw error;
  }
  check(await supabase.rpc("admin_mark_invited", { emp: p.id }));
}

export async function inviteEmployee(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    await invite(str(f, "id"));
    return done("Invitation sent");
  });
}

export async function inviteAllPending(_: ActionResult): Promise<ActionResult> {
  return attempt(async () => {
    await requireAdmin();
    const supabase = await createClient();
    const { data } = await supabase.from("employee_profiles").select("id").eq("status", "active").is("invited_at", null).is("user_id", null);
    for (const p of data ?? []) await invite(p.id);
    return done(`Sent ${data?.length ?? 0} invitation(s)`);
  });
}

export async function setApprover(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    await requireAdmin();
    const supabase = await createClient();
    const { data: p } = await supabase.from("employee_profiles").select("*").eq("id", str(f, "id")).single();
    if (!p) throw new Error("Employee not found");
    check(await supabase.rpc("admin_save_employee", {
      payload: { ...p, manager_id: str(f, "manager_id"), backup_approver_id: str(f, "backup_approver_id") },
    }));
    return done("Approvers saved");
  });
}

/** CSV import: one row per employee (see the template on the Setup page). */
export async function importEmployees(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    await requireAdmin();
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("Choose a CSV file");
    const { parseCsv } = await import("@/lib/csv");
    const rows = parseCsv(await file.text());
    if (!rows.length) throw new Error("The file has no rows");
    const supabase = await createClient();
    const { data: people } = await supabase.from("employee_profiles").select("id, work_email");
    const byEmail = new Map((people ?? []).map((p) => [p.work_email.toLowerCase(), p.id]));
    const errors: string[] = [];
    let created = 0;
    // Two passes so managers listed later in the file can still be referenced.
    for (const pass of [1, 2]) {
      for (const [i, r] of rows.entries()) {
        const email = (r.work_email ?? r.email ?? "").toLowerCase();
        if (!email) { if (pass === 1) errors.push(`Row ${i + 2}: missing email`); continue; }
        const manager = byEmail.get((r.manager_email ?? "").toLowerCase()) ?? "";
        if (pass === 1 && !byEmail.has(email)) {
          const res = await supabase.rpc("admin_save_employee", { payload: {
            full_name: r.full_name ?? r.name, work_email: email, job_title: r.job_title, department: r.department,
            start_date: r.start_date, role: r.role || "employee", manager_id: manager,
            annual_days: r.annual_vacation_days ? Number(r.annual_vacation_days) : null,
            year_type: r.vacation_year || "", allocation_method: r.allocation || "",
            entitlement_effective_from: r.balances_as_of || "",
            opening_vacation: Number(r.opening_vacation || 0), opening_carryover: Number(r.carryover || 0), opening_lieu: Number(r.opening_lieu || 0),
          } });
          if (res.error) errors.push(`Row ${i + 2} (${email}): ${res.error.message}`);
          else { byEmail.set(email, res.data as string); created++; }
        } else if (pass === 2 && r.manager_email && manager) {
          const id = byEmail.get(email)!;
          const { data: p } = await supabase.from("employee_profiles").select("*").eq("id", id).single();
          if (p && !p.manager_id) await supabase.rpc("admin_save_employee", { payload: { ...p, manager_id: manager } });
        }
      }
    }
    revalidatePath("/", "layout");
    if (errors.length) throw new Error(`Imported ${created}. ${errors.length} problem(s): ${errors.slice(0, 5).join("; ")}`);
    return `Imported ${created} employee(s)`;
  });
}

// --- Settings ----------------------------------------------------------------

export async function saveSettings(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const payload: { [k: string]: Json } = {};
    for (const k of ["agency_name", "timezone", "standard_day_hours", "default_vacation_year", "default_allocation", "carryover_cap_days",
      "lieu_expiry_months", "coverage_warning_threshold", "absence_reminder_days"]) {
      if (f.has(k)) payload[k] = str(f, k);
    }
    for (const k of ["allow_negative_vacation", "allow_half_days", "email_notifications_enabled", "onboarding_completed"]) {
      if (f.has(k + "__present")) payload[k] = f.get(k) === "on";
    }
    if (f.has("working_days__present")) payload.working_days = f.getAll("working_days").map(Number);
    if (f.has("anniversary_reminder_days")) payload.anniversary_reminder_days = str(f, "anniversary_reminder_days").split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0);
    check(await supabase.rpc("admin_save_settings", { payload }));
    return done("Settings saved");
  });
}

export async function saveLieuRules(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const payload = Object.fromEntries(["weekend_half_min_hours", "weekend_half_credit", "weekend_full_min_hours", "weekend_full_credit",
      "weekday_min_hours", "weekday_credit", "weekday_review_above_hours"].map((k) => [k, Number(str(f, k))]));
    check(await supabase.rpc("admin_save_lieu_rules", { payload, effective_from: str(f, "effective_from") || undefined }));
    return done("New lieu rules saved. Earlier credits keep the rules they were calculated with.");
  });
}

export async function addHoliday(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    check(await supabase.rpc("admin_add_holiday", { holiday_date: str(f, "date"), name: str(f, "name"), kind: (str(f, "kind") || "closure") as Enums["holiday_kind"] }));
    return done("Holiday added");
  });
}

export async function deleteHoliday(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    check(await supabase.rpc("admin_delete_holiday", { holiday_id: str(f, "id") }));
    return done("Holiday removed");
  });
}

export async function generateHolidays(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const n = check(await supabase.rpc("admin_generate_holidays", { yr: Number(str(f, "year")) }));
    return done(`Added ${n} holiday(s)`);
  });
}

export async function updateProject(_: ActionResult, f: FormData): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    check(await supabase.rpc("admin_update_project", { project_id: str(f, "id"), name: str(f, "name"), client: str(f, "client"), is_active: f.get("is_active") === "on" }));
    return done("Project saved");
  });
}

export async function runMaintenance(_: ActionResult): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    check(await supabase.rpc("admin_run_maintenance"));
    return done("Balances recalculated and reminders sent");
  });
}
