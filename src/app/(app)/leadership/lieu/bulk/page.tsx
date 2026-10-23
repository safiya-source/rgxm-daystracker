import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCalendarContext, getCurrentLieuRules, getProjects, getToday } from "@/lib/data";
import { PageHeader } from "@/components/ui";
import { addDays } from "@/lib/rules/dates";
import { BulkLieu } from "./bulk-lieu";

export const metadata = { title: "Bulk Lieu Entry" };

export default async function BulkLieuPage() {
  await requireAdmin();
  const supabase = await createClient();
  const today = await getToday();
  const [{ data: people }, projects, rules, ctx] = await Promise.all([
    supabase.from("employee_profiles").select("id, full_name, job_title").eq("status", "active").order("full_name"),
    getProjects(), getCurrentLieuRules(), getCalendarContext(addDays(today, -400), today),
  ]);
  return (
    <>
      <PageHeader title="Bulk lieu entry" subtitle="Credit a whole crew for the same project in one go." />
      <BulkLieu people={people ?? []} projects={projects.filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.name }))}
        rules={rules} holidays={ctx.holidays.filter((h) => h.kind === "statutory").map((h) => h.holiday_date)} workingDays={ctx.workingDays} today={today} />
    </>
  );
}
