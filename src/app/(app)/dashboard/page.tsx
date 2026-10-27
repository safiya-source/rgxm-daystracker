import Link from "next/link";
import { CalendarHeart, CalendarDays, PlusCircle, Clock, ArrowRight } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLieuBalances, getToday, getVacationBalance, requestLabel } from "@/lib/data";
import { VacationCard, LieuCard } from "@/components/balance-cards";
import { Badge, Card, CardHeader, Empty, LinkButton, PageHeader } from "@/components/ui";
import { anniversaryInfo, formatDate, formatRange, formatTenure } from "@/lib/rules/dates";
import { formatDays } from "@/lib/format";
import { ActivityList } from "@/components/activity-list";

export const metadata = { title: "My Dashboard" };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-CA", { hour: "numeric", hourCycle: "h23", timeZone: "America/Toronto" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage() {
  const me = await requireProfile();
  const supabase = await createClient();
  await supabase.rpc("sync_my_vacation");
  const today = await getToday();
  const [vac, lieu, { data: upcoming }, { data: activity }] = await Promise.all([
    getVacationBalance(me.id),
    getLieuBalances(me.id),
    supabase.from("time_off_requests").select("*").eq("employee_id", me.id).in("status", ["approved", "pending"])
      .gte("end_date", today).order("start_date").limit(6),
    supabase.rpc("recent_activity", { emp: me.id, max_rows: 8 }),
  ]);
  const anniv = anniversaryInfo(me.start_date, today);

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${me.full_name.split(" ")[0]}`}
        subtitle={formatDate(today, { weekday: true, long: true })}
        action={<>
          <LinkButton href="/time-off/request"><PlusCircle className="size-4" /> Request time off</LinkButton>
          <LinkButton href="/lieu/new" variant="secondary"><Clock className="size-4" /> Add lieu time</LinkButton>
        </>}
      />

      <div className="grid gap-5 md:grid-cols-2">
        <VacationCard b={vac} />
        <LieuCard disc={lieu.discretionary} stat={lieu.statutory} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Upcoming time off" icon={<CalendarDays className="size-5 text-muted" />}
            action={<Link href="/time-off" className="text-sm text-muted hover:text-ink">All requests <ArrowRight className="inline size-3.5" /></Link>} />
          {upcoming?.length ? (
            <ul className="divide-y divide-line px-5 pb-2">
              {upcoming.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium">{formatRange(r.start_date, r.end_date)}{r.portion !== "full" && ` (${r.portion.toUpperCase()})`}</p>
                    <p className="text-sm text-muted">{requestLabel(r)} · {formatDays(r.days)}</p>
                  </div>
                  <Badge tone={r.status === "approved" ? (r.kind === "vacation" ? "vacation" : "lieu") : "warn"}>
                    {r.status === "approved" ? "Approved" : "Pending"}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nothing booked yet" action={<LinkButton href="/time-off/request" variant="secondary" size="sm">Plan some time off</LinkButton>}>
              Time away matters. Your approved and pending requests show up here.
            </Empty>
          )}
        </Card>

        <Card>
          <CardHeader title="Milestones" icon={<CalendarHeart className="size-5 text-accent" />} />
          <div className="space-y-4 px-5 pb-5">
            <div>
              <p className="text-[13px] text-muted">Tenure at RGXM</p>
              <p className="text-xl font-semibold tracking-tight">{formatTenure(me.start_date, today)}</p>
              <p className="text-xs text-muted">Since {formatDate(me.start_date, { long: true })}</p>
            </div>
            <div className="bg-silver rounded-xl p-3.5 shadow-card">
              <p className="text-[13px] font-medium text-ink-soft">Next work anniversary</p>
              <p className="text-[15px] font-semibold">
                {anniv.years} year{anniv.years === 1 ? "" : "s"} · {formatDate(anniv.date, { long: true })}
              </p>
              <p className="text-xs text-ink-soft">{anniv.daysUntil === 0 ? "It's today! 🎉" : `In ${anniv.daysUntil} day${anniv.daysUntil === 1 ? "" : "s"}`}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Recent activity" />
        <ActivityList rows={activity ?? []} />
      </Card>
    </>
  );
}
