import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCalendarContext, getCurrentLieuRules, getProjects, getToday } from "@/lib/data";
import { Alert, PageHeader } from "@/components/ui";
import { addDays } from "@/lib/rules/dates";
import { LieuForm } from "./lieu-form";

export const metadata = { title: "Add Lieu Time" };

export default async function AddLieuPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams;
  const me = await requireProfile();
  const supabase = await createClient();
  const today = await getToday();
  const [ctx, rules, projects] = await Promise.all([getCalendarContext(addDays(today, -400), today), getCurrentLieuRules(), getProjects()]);

  let existing: { id: string; project_id: string; review_note: string | null; entries: { work_date: string; hours: number }[] } | null = null;
  if (edit) {
    const { data } = await supabase.from("lieu_submissions").select("id, project_id, review_note, status, employee_id, lieu_work_entries(work_date, hours)")
      .eq("id", edit).eq("employee_id", me.id).in("status", ["pending", "changes_requested"]).maybeSingle();
    if (data) existing = { id: data.id, project_id: data.project_id, review_note: data.review_note, entries: data.lieu_work_entries.sort((a, b) => a.work_date.localeCompare(b.work_date)) };
  }

  return (
    <>
      <PageHeader title={existing ? "Edit lieu submission" : "Add lieu time"} subtitle="Project, dates and hours. We'll work out the lieu credit for you." />
      {existing?.review_note && <Alert tone="warn" className="mb-5">Your approver asked: “{existing.review_note}”</Alert>}
      <LieuForm
        today={today}
        rules={rules}
        holidays={ctx.holidays.filter((h) => h.kind === "statutory").map((h) => h.holiday_date)}
        workingDays={ctx.workingDays}
        projects={projects.filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.name }))}
        existing={existing}
      />
    </>
  );
}
