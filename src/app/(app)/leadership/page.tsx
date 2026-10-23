import Link from "next/link";
import { Cake, Plane, Users, ClipboardCheck, Sparkles, Clock, ArrowRight } from "lucide-react";
import { requireLeader } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSettings, getToday } from "@/lib/data";
import { Alert, Card, CardHeader, Empty, LinkButton, PageHeader, Badge } from "@/components/ui";
import { EmployeeTable, type EmployeeRow } from "@/components/employee-table";
import { addDays, formatDate } from "@/lib/rules/dates";
import { formatDays } from "@/lib/format";

export const metadata = { title: "Leadership Overview" };

type Overview = { active_employees: number; pending_vacation: number; pending_lieu_submissions: number; pending_lieu_usage: number; away_today: string[]; outstanding_lieu: number; anniversaries_90: number };

export default async function OverviewPage() {
  const me = await requireLeader();
  const admin = me.role === "people_admin";
  const supabase = await createClient();
  const today = await getToday();
  const [settings, { data: queue }, { data: anniversaries }, { data: week }, overview, table] = await Promise.all([
    getSettings(),
    supabase.rpc("approval_queue_counts").single(),
    supabase.rpc("upcoming_anniversaries", { within_days: 90 }),
    supabase.rpc("team_calendar", { from_date: today, to_date: addDays(today, 13) }),
    admin ? supabase.rpc("leadership_overview") : Promise.resolve({ data: null }),
    admin ? supabase.rpc("admin_employee_table") : Promise.resolve({ data: null }),
  ]);
  const o = overview.data as Overview | null;
  const awayNext = new Map<string, { name: string; dates: string[]; pending: boolean }>();
  for (const e of week ?? []) {
    const cur = awayNext.get(e.employee_id) ?? { name: e.full_name, dates: [], pending: e.status === "pending" };
    cur.dates.push(e.leave_date);
    awayNext.set(e.employee_id, cur);
  }
  const annivList = (anniversaries ?? []).filter((a) => a.employee_id !== me.id);

  const tiles = admin && o ? [
    { label: "Active employees", value: o.active_employees, icon: Users, href: "/leadership/employees" },
    { label: "Pending vacation", value: o.pending_vacation, icon: ClipboardCheck, href: "/leadership/requests" },
    { label: "Pending lieu submissions", value: o.pending_lieu_submissions, icon: Sparkles, href: "/leadership/lieu" },
    { label: "Pending lieu usage", value: o.pending_lieu_usage, icon: Clock, href: "/leadership/requests" },
    { label: "Away today", value: o.away_today.length, icon: Plane, href: "/calendar", hint: o.away_today.join(", ") },
    { label: "Anniversaries (90 days)", value: o.anniversaries_90, icon: Cake },
    { label: "Outstanding lieu", value: formatDays(o.outstanding_lieu), icon: Sparkles, hint: "Approved, not yet used" },
  ] : [
    { label: "Vacation to review", value: queue?.pending_vacation ?? 0, icon: ClipboardCheck, href: "/leadership/requests" },
    { label: "Lieu submissions", value: queue?.pending_lieu_submissions ?? 0, icon: Sparkles, href: "/leadership/lieu" },
    { label: "Lieu usage requests", value: queue?.pending_lieu_usage ?? 0, icon: Clock, href: "/leadership/requests" },
  ];

  return (
    <>
      <PageHeader title="Overview" subtitle={admin ? "Everything happening across RGXM." : "Requests from your team, and who's around."}
        action={admin && <><LinkButton href="/leadership/employees/new">Add employee</LinkButton><LinkButton href="/leadership/lieu/bulk" variant="secondary">Bulk lieu entry</LinkButton></>} />

      {admin && !settings.onboarding_completed && (
        <Alert tone="info" className="mb-5 flex items-center justify-between gap-3">
          <span><strong>Finish setting up RGXM People.</strong> Agency settings, employees, approvers and invitations, in five short steps.</span>
          <Link href="/leadership/setup" className="shrink-0 font-medium text-accent">Open setup →</Link>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map((t) => {
          const body = (
            <Card className="h-full p-4 transition hover:border-line-strong">
              <div className="flex items-center justify-between text-muted"><span className="text-[13px]">{t.label}</span><t.icon className="size-4" /></div>
              <p className="mt-2 text-2xl font-semibold tracking-tight tabular">{t.value}</p>
              {"hint" in t && t.hint && <p className="mt-0.5 truncate text-xs text-muted">{t.hint}</p>}
            </Card>
          );
          return t.href ? <Link key={t.label} href={t.href}>{body}</Link> : <div key={t.label}>{body}</div>;
        })}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming work anniversaries" icon={<Cake className="size-5 text-accent" />} subtitle="Next 90 days" />
          {annivList.length ? (
            <ul className="divide-y divide-line px-5 pb-2">
              {annivList.map((a) => (
                <li key={a.employee_id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium">{a.full_name} — {a.years} year{a.years === 1 ? "" : "s"}</p>
                    <p className="text-muted">{formatDate(a.anniversary, { long: true, year: false })}</p>
                  </div>
                  <Badge tone={a.days_until <= 30 ? "accent" : "neutral"}>{a.days_until === 0 ? "Today" : `${a.days_until} days`}</Badge>
                </li>
              ))}
            </ul>
          ) : <Empty title="No anniversaries in the next 90 days" />}
        </Card>
        <Card>
          <CardHeader title="Away in the next two weeks" icon={<Plane className="size-5 text-vacation" />}
            action={<Link href="/calendar" className="text-sm text-muted hover:text-ink">Calendar <ArrowRight className="inline size-3.5" /></Link>} />
          {awayNext.size ? (
            <ul className="divide-y divide-line px-5 pb-2">
              {[...awayNext.values()].map((a) => (
                <li key={a.name} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span className="font-medium">{a.name}</span>
                  <span className="text-muted">
                    {formatDate(a.dates[0], { year: false })}{a.dates.length > 1 && ` – ${formatDate(a.dates[a.dates.length - 1], { year: false })}`}
                    {a.pending && <Badge tone="warn" className="ml-2">Pending</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          ) : <Empty title="Everyone's around" />}
        </Card>
      </div>

      {admin && table.data && (
        <Card className="mt-5">
          <CardHeader title="Employees" subtitle="Balances are visible to People Admins only"
            action={<Link href="/leadership/employees" className="text-sm text-muted hover:text-ink">Manage <ArrowRight className="inline size-3.5" /></Link>} />
          <EmployeeTable rows={table.data as EmployeeRow[]} today={today} compact />
        </Card>
      )}
    </>
  );
}
