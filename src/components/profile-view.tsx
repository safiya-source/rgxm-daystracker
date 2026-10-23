import { Mail, Briefcase, CalendarDays, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getLieuBalances, getToday, getVacationBalance, requestLabel } from "@/lib/data";
import { Badge, Card, CardHeader, Empty } from "@/components/ui";
import { VacationCard, LieuCard } from "@/components/balance-cards";
import { ActivityList } from "@/components/activity-list";
import { anniversaryInfo, formatDate, formatRange, formatTenure } from "@/lib/rules/dates";
import { formatDays, ROLE_LABEL } from "@/lib/format";
import type { Profile } from "@/lib/auth";

/** Full profile: used for "My Profile" and the People Admin employee page. */
export async function ProfileView({ p, approvers }: { p: Profile; approvers: string[] }) {
  const supabase = await createClient();
  const today = await getToday();
  const [vac, lieu, { data: upcoming }, { data: activity }] = await Promise.all([
    getVacationBalance(p.id), getLieuBalances(p.id),
    supabase.from("time_off_requests").select("*").eq("employee_id", p.id).eq("status", "approved").gte("end_date", today).order("start_date").limit(8),
    supabase.rpc("recent_activity", { emp: p.id, max_rows: 12 }),
  ]);
  const anniv = anniversaryInfo(p.start_date, today);

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-accent-soft text-xl font-semibold text-accent-strong">
            {p.full_name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">{p.full_name}</h2>
              <Badge tone={p.status === "active" ? "ok" : "neutral"}>{p.status === "active" ? "Active" : "Inactive"}</Badge>
              {p.role !== "employee" && <Badge tone="accent">{ROLE_LABEL[p.role]}</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              <span className="flex items-center gap-1.5"><Briefcase className="size-4" />{p.job_title ?? "—"}{p.department && ` · ${p.department}`}</span>
              <span className="flex items-center gap-1.5"><Mail className="size-4" />{p.work_email}</span>
              <span className="flex items-center gap-1.5"><UserCheck className="size-4" />Approver: {approvers.length ? approvers.join(", ") : "People Admins"}</span>
            </div>
          </div>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-4">
          <div><dt className="text-[13px] text-muted">Start date</dt><dd className="font-medium">{formatDate(p.start_date, { long: true })}</dd></div>
          <div><dt className="text-[13px] text-muted">Tenure</dt><dd className="font-medium">{formatTenure(p.start_date, today)}</dd></div>
          <div><dt className="text-[13px] text-muted">Next anniversary</dt><dd className="font-medium">{formatDate(anniv.date, { long: true })}</dd>
            <dd className="text-xs text-muted">{anniv.years} year{anniv.years === 1 ? "" : "s"} · in {anniv.daysUntil} days</dd></div>
          <div><dt className="text-[13px] text-muted">Vacation entitlement</dt><dd className="font-medium">{vac?.annual_entitlement != null ? `${formatDays(vac.annual_entitlement)} / year` : "—"}</dd></div>
        </dl>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <VacationCard b={vac} />
        <LieuCard disc={lieu.discretionary} stat={lieu.statutory} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming approved leave" icon={<CalendarDays className="size-5 text-muted" />} />
          {upcoming?.length ? (
            <ul className="divide-y divide-line px-5 pb-2">
              {upcoming.map((r) => (
                <li key={r.id} className="flex justify-between py-3 text-sm">
                  <span className="font-medium">{formatRange(r.start_date, r.end_date)}</span>
                  <span className="text-muted">{requestLabel(r)} · {formatDays(r.days)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty title="No upcoming leave" />}
        </Card>
        <Card>
          <CardHeader title="Recent activity" />
          <ActivityList rows={activity ?? []} />
        </Card>
      </div>
    </div>
  );
}
