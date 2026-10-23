import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCurrentLieuRules, getProjects, getSettings, getToday } from "@/lib/data";
import { Alert, Card, CardHeader, Empty, PageHeader, Table, td, th } from "@/components/ui";
import {
  AgencyForm, ApproverRow, HolidayForms, HolidayRow, LieuRulesForm, MaintenanceButton, ProjectRow, VacationSettingsForm,
} from "@/components/settings-forms";
import { formatDate } from "@/lib/rules/dates";
import { cn } from "@/lib/format";

export const metadata = { title: "Settings" };

const TABS = [["agency", "Agency"], ["vacation", "Vacation"], ["lieu", "Lieu rules"], ["holidays", "Holidays"], ["approvals", "Approvals"], ["projects", "Projects"]] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; year?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "agency";
  const supabase = await createClient();
  const [s, today] = await Promise.all([getSettings(), getToday()]);
  const year = Number(sp.year) || Number(today.slice(0, 4));

  return (
    <>
      <PageHeader title="Settings" subtitle="Agency-wide rules. Changes are logged, and rule changes never rewrite past balances." />
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-2xl bg-black/[0.04] p-1 sm:w-fit">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/leadership/settings?tab=${k}`} className={cn("whitespace-nowrap rounded-xl px-4 py-1.5 text-sm", tab === k ? "bg-surface font-medium shadow-card" : "text-muted hover:text-ink")}>{l}</Link>
        ))}
      </div>

      {tab === "agency" && (
        <div className="space-y-5">
          <Card><CardHeader title="Agency" /><div className="px-5 pb-5"><AgencyForm s={s} /></div></Card>
          <Card><CardHeader title="Maintenance" subtitle="Runs automatically every morning. Use this after bulk changes." /><div className="px-5 pb-5"><MaintenanceButton /></div></Card>
        </div>
      )}
      {tab === "vacation" && <Card><CardHeader title="Vacation defaults & rules" /><div className="px-5 pb-5"><VacationSettingsForm s={s} /></div></Card>}
      {tab === "lieu" && <LieuTab today={today} />}
      {tab === "holidays" && <HolidaysTab year={year} />}
      {tab === "approvals" && <ApprovalsTab />}
      {tab === "projects" && <ProjectsTab />}
    </>
  );

  async function LieuTab({ today }: { today: string }) {
    const [rules, { data: versions }] = await Promise.all([getCurrentLieuRules(), supabase.from("lieu_rule_versions").select("*").order("effective_from", { ascending: false })]);
    return (
      <div className="space-y-5">
        <Alert tone="info">These are RGXM&apos;s internal lieu guidelines. They aren&apos;t a statutory overtime calculation. Public-holiday work is always flagged for People Admin review as statutory time.</Alert>
        <Card><CardHeader title="Lieu calculation rules" subtitle="Saving creates a new version; earlier work dates keep the rules they were calculated with." /><div className="px-5 pb-5"><LieuRulesForm r={rules} s={s} today={today} /></div></Card>
        <Card>
          <CardHeader title="Rule history" />
          <Table>
            <thead><tr><th className={th}>Effective from</th><th className={th}>Weekend ½ / full from</th><th className={th}>Weekday credit from</th><th className={th}>Review above</th></tr></thead>
            <tbody>{(versions ?? []).map((v) => (
              <tr key={v.id}>
                <td className={td}>{v.effective_from === "2000-01-01" ? "Original rules" : formatDate(v.effective_from)}</td>
                <td className={td + " tabular"}>{v.weekend_half_min_hours}h → {v.weekend_half_credit} · {v.weekend_full_min_hours}h → {v.weekend_full_credit}</td>
                <td className={td + " tabular"}>{v.weekday_min_hours}h → {v.weekday_credit}</td>
                <td className={td + " tabular"}>{v.weekday_review_above_hours}h</td>
              </tr>
            ))}</tbody>
          </Table>
        </Card>
      </div>
    );
  }

  async function HolidaysTab({ year }: { year: number }) {
    const { data } = await supabase.from("public_holidays").select("*").gte("holiday_date", `${year}-01-01`).lte("holiday_date", `${year}-12-31`).order("holiday_date");
    return (
      <Card>
        <CardHeader title={`Holidays & closures · ${year}`} subtitle="Excluded from vacation and lieu day counts."
          action={<div className="flex gap-2 text-sm"><Link href={`?tab=holidays&year=${year - 1}`} className="text-muted hover:text-ink">← {year - 1}</Link><Link href={`?tab=holidays&year=${year + 1}`} className="text-muted hover:text-ink">{year + 1} →</Link></div>} />
        <div className="space-y-5 px-5 pb-5">
          {data?.length ? (
            <div className="divide-y divide-line">
              {data.map((h) => <HolidayRow key={h.id} id={h.id} label={`${formatDate(h.holiday_date, { weekday: true })} · ${h.name}${h.kind === "closure" ? " (closure)" : ""}`} />)}
            </div>
          ) : <Empty title="No holidays for this year" />}
          <p className="text-xs text-muted">Weekend public holidays get an “observed” day off on the next working day (ESA substitute holiday). Adding or removing a holiday doesn&apos;t change requests that are already approved; adjust those manually if needed.</p>
          <HolidayForms year={year} />
        </div>
      </Card>
    );
  }

  async function ApprovalsTab() {
    const { data } = await supabase.from("employee_profiles").select("id, full_name, role, manager_id, backup_approver_id").eq("status", "active").order("full_name");
    const people = (data ?? []).map((p) => ({ id: p.id, full_name: p.full_name }));
    return (
      <Card>
        <CardHeader title="Who approves whom" subtitle="Each person's requests go to their manager (and backup). People Admins can approve anyone except another People Admin, whose requests go to their assigned approver. Nobody can approve their own." />
        <div className="divide-y divide-line px-5 pb-3">
          <div className="hidden gap-2 pb-2 text-xs font-medium uppercase tracking-wide text-muted sm:grid sm:grid-cols-[1fr_200px_200px_auto]"><span>Employee</span><span>Approver</span><span>Backup</span><span /></div>
          {(data ?? []).map((e) => <ApproverRow key={e.id} e={e} people={people} />)}
        </div>
      </Card>
    );
  }

  async function ProjectsTab() {
    const projects = await getProjects();
    return (
      <Card>
        <CardHeader title="Projects" subtitle="Employees can create projects when logging lieu. Archive old ones to tidy the list." />
        <div className="divide-y divide-line px-5 pb-3">{projects.length ? projects.map((p) => <ProjectRow key={p.id} p={p} />) : <Empty title="No projects yet" />}</div>
      </Card>
    );
  }
}
