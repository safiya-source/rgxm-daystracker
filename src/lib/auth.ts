import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type Profile = Database["public"]["Tables"]["employee_profiles"]["Row"];
export type Role = Database["public"]["Enums"]["app_role"];

/** The signed-in user's active profile, or null. Cached per request. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("employee_profiles").select("*").eq("user_id", user.id).eq("status", "active").maybeSingle();
  return data;
});

export async function requireProfile(): Promise<Profile> {
  const p = await getProfile();
  if (!p) redirect("/auth/inactive");
  return p;
}

/** Managers and People Admins (approvers). Data access is still enforced by RLS. */
export async function requireLeader(): Promise<Profile> {
  const p = await requireProfile();
  if (p.role === "employee") {
    // Employees can be backup approvers too; allow if they have anyone to approve.
    const supabase = await createClient();
    const { count } = await supabase.from("employee_profiles").select("id", { count: "exact", head: true }).neq("id", p.id);
    if (!count) redirect("/dashboard");
  }
  return p;
}

export async function requireAdmin(): Promise<Profile> {
  const p = await requireProfile();
  if (p.role !== "people_admin") redirect("/dashboard");
  return p;
}

export const isLeader = async (p: Profile) => {
  if (p.role !== "employee") return true;
  const supabase = await createClient();
  const { count } = await supabase.from("employee_profiles").select("id", { count: "exact", head: true }).neq("id", p.id);
  return (count ?? 0) > 0;
};
