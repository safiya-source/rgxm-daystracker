import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCalendarContext, getLieuBalances, getProjects, getToday, getVacationBalance } from "@/lib/data";
import { PageHeader } from "@/components/ui";
import { addDays } from "@/lib/rules/dates";
import { RequestForm } from "./request-form";

export const metadata = { title: "Request Time Off" };

export default async function RequestPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  const me = await requireProfile();
  const supabase = await createClient();
  await supabase.rpc("sync_my_vacation");
  const today = await getToday();
  const [vac, lieu, ctx, projects, { data: approvers }] = await Promise.all([
    getVacationBalance(me.id), getLieuBalances(me.id),
    getCalendarContext(addDays(today, -60), addDays(today, 730)), getProjects(), supabase.rpc("my_approvers"),
  ]);
  return (
    <>
      <PageHeader title="Request time off"
        subtitle={approvers?.length ? `Goes to ${approvers.map((a) => a.full_name).join(" or ")} for approval.` : "Goes to a People Admin for approval."} />
      <RequestForm
        initialKind={kind === "lieu" ? "lieu" : "vacation"}
        today={today}
        vacationAvailable={Number(vac?.available_after_pending ?? 0)}
        lieuAvailable={Number(lieu.discretionary?.available ?? 0) - Number(lieu.discretionary?.pending_usage ?? 0)}
        statutoryAvailable={Number(lieu.statutory?.available ?? 0) - Number(lieu.statutory?.pending_usage ?? 0)}
        holidays={ctx.holidays.map((h) => ({ date: h.holiday_date, name: h.name }))}
        workingDays={ctx.workingDays}
        allowHalfDays={ctx.settings.allow_half_days}
        allowNegative={ctx.settings.allow_negative_vacation}
        projects={projects.filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.name }))}
      />
    </>
  );
}
