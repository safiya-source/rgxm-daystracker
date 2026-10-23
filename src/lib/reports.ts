import "server-only";
import { createClient } from "@/lib/supabase/server";

export const VACATION_COLUMNS = [
  { key: "full_name", label: "Employee" }, { key: "status", label: "Status" }, { key: "annual_entitlement", label: "Annual entitlement" },
  { key: "period_start", label: "Year start" }, { key: "period_end", label: "Year end" }, { key: "opening_balance", label: "Opening balance" },
  { key: "carryover", label: "Carryover" }, { key: "earned", label: "Allocated / accrued" }, { key: "adjustments", label: "Adjustments" },
  { key: "used", label: "Vacation used" }, { key: "booked", label: "Vacation booked" }, { key: "pending", label: "Pending" },
  { key: "available", label: "Available balance" },
];
export const LIEU_COLUMNS = [
  { key: "full_name", label: "Employee" }, { key: "project", label: "Project" }, { key: "work_date", label: "Date worked" },
  { key: "hours", label: "Hours worked" }, { key: "day_type", label: "Day type" }, { key: "category", label: "Category" },
  { key: "proposed_credit", label: "Proposed credit" }, { key: "approved_credit", label: "Approved lieu credit" }, { key: "status", label: "Status" },
  { key: "lieu_used", label: "Lieu used (employee total)" }, { key: "remaining_balance", label: "Remaining balance (employee)" },
];
export const PROJECT_COLUMNS = [
  { key: "full_name", label: "Employee" }, { key: "work_date", label: "Date worked" }, { key: "hours", label: "Hours worked" },
  { key: "day_type", label: "Day type" }, { key: "proposed_credit", label: "Proposed credit" }, { key: "approved_credit", label: "Approved lieu" }, { key: "status", label: "Status" },
];

export async function loadReport(type: string, params: { from?: string; to?: string; project?: string }) {
  const supabase = await createClient();
  if (type === "lieu") {
    const { data, error } = await supabase.rpc("report_lieu", { from_date: params.from || undefined, to_date: params.to || undefined });
    if (error) throw error;
    return data ?? [];
  }
  if (type === "project") {
    if (!params.project) return [];
    const { data, error } = await supabase.rpc("report_project", { project_id: params.project });
    if (error) throw error;
    return data ?? [];
  }
  const { data, error } = await supabase.rpc("report_vacation");
  if (error) throw error;
  return data ?? [];
}
