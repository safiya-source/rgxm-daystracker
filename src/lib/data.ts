import "server-only";
import { createClient } from "@/lib/supabase/server";
import { todayIn } from "@/lib/rules/dates";
import type { LieuRules } from "@/lib/rules/lieu";
import type { Database } from "@/lib/database.types";

type Fn = Database["public"]["Functions"];
export type VacationBalance = Fn["vacation_balance"]["Returns"][number];
export type LieuBalance = Fn["lieu_balance"]["Returns"][number];
export type Settings = Database["public"]["Tables"]["agency_settings"]["Row"];
export type Request = Database["public"]["Tables"]["time_off_requests"]["Row"];

export async function getSettings(): Promise<Settings> {
  const supabase = await createClient();
  const { data } = await supabase.from("agency_settings").select("*").eq("id", 1).single();
  return data!;
}

export async function getToday() {
  const s = await getSettings();
  return todayIn(s.timezone);
}

export async function getVacationBalance(emp: string): Promise<VacationBalance | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("vacation_balance", { emp }).maybeSingle();
  return data;
}

export async function getLieuBalances(emp: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("lieu_balance", { emp });
  const rows = data ?? [];
  const disc = rows.find((r) => r.category === "discretionary");
  const stat = rows.find((r) => r.category === "statutory");
  return { discretionary: disc, statutory: stat };
}

/** Holidays and working days for client-side previews. */
export async function getCalendarContext(from: string, to: string) {
  const supabase = await createClient();
  const [{ data: holidays }, settings] = await Promise.all([
    supabase.from("public_holidays").select("holiday_date, name, kind").gte("holiday_date", from).lte("holiday_date", to).order("holiday_date"),
    getSettings(),
  ]);
  return { holidays: holidays ?? [], workingDays: settings.working_days, settings };
}

export async function getCurrentLieuRules(): Promise<LieuRules & { id: string; effective_from: string }> {
  const supabase = await createClient();
  const { data } = await supabase.from("lieu_rule_versions").select("*").order("effective_from", { ascending: false });
  const today = await getToday();
  const current = (data ?? []).find((r) => r.effective_from <= today) ?? data![data!.length - 1];
  return current;
}

export async function getProjects() {
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("id, name, client, is_active, created_at").order("created_at", { ascending: false });
  return data ?? [];
}

export function requestLabel(r: Pick<Request, "kind" | "is_advance" | "lieu_category">) {
  if (r.kind === "vacation") return "Vacation";
  if (r.is_advance) return "Advance lieu day";
  return r.lieu_category === "statutory" ? "Lieu (statutory)" : "Lieu time off";
}
