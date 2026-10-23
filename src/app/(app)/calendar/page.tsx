import Link from "next/link";
import { ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { isLeader, requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSettings, getToday } from "@/lib/data";
import { Badge, Card, PageHeader, buttonClass } from "@/components/ui";
import { addDays, formatDate, isoWeekday, monthName, parts, iso } from "@/lib/rules/dates";
import { cn } from "@/lib/format";

export const metadata = { title: "Team Calendar" };

type Entry = { employee_id: string; full_name: string; leave_date: string; portion: string; status: string; kind: string | null; is_self: boolean; can_see_details: boolean };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const sp = await searchParams;
  const me = await requireProfile();
  const supabase = await createClient();
  const [today, settings, leader] = await Promise.all([getToday(), getSettings(), isLeader(me)]);
  const view = sp.view === "week" ? "week" : "month";
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : today;
  const [y, m] = parts(anchor);

  let from: string, to: string, prev: string, next: string, title: string;
  if (view === "month") {
    const first = iso(y, m, 1);
    from = addDays(first, -(isoWeekday(first) - 1));
    const last = addDays(iso(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1), -1);
    to = addDays(last, 7 - isoWeekday(last));
    prev = iso(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, 1);
    next = iso(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1);
    title = `${monthName(m)} ${y}`;
  } else {
    from = addDays(anchor, -(isoWeekday(anchor) - 1));
    to = addDays(from, 6);
    prev = addDays(from, -7);
    next = addDays(from, 7);
    title = `${formatDate(from, { year: false })} – ${formatDate(to)}`;
  }

  const [{ data }, { data: holidays }] = await Promise.all([
    supabase.rpc("team_calendar", { from_date: from, to_date: to }),
    supabase.from("public_holidays").select("holiday_date, name").gte("holiday_date", from).lte("holiday_date", to),
  ]);
  const entries = (data ?? []) as Entry[];
  const byDay = new Map<string, Entry[]>();
  for (const e of entries) byDay.set(e.leave_date, [...(byDay.get(e.leave_date) ?? []), e]);
  const holidayMap = new Map((holidays ?? []).map((h) => [h.holiday_date, h.name]));
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);

  const threshold = settings.coverage_warning_threshold;
  const busy = (d: string) => new Set((byDay.get(d) ?? []).filter((e) => e.status === "approved").map((e) => e.employee_id)).size;
  const warnings = leader ? days.filter((d) => d.slice(5, 7) === anchor.slice(5, 7) || view === "week").filter((d) => busy(d) >= threshold && settings.working_days.includes(isoWeekday(d))) : [];
  const q = (v: string, d: string) => `/calendar?view=${v}&date=${d}`;

  return (
    <>
      <PageHeader title="Team calendar" subtitle="Who's away, at a glance. Colleagues' leave shows only as “away”."
        action={
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border border-line-strong bg-surface p-0.5">
              {(["month", "week"] as const).map((v) => (
                <Link key={v} href={q(v, anchor)} className={cn("rounded-[10px] px-3 py-1.5 text-sm capitalize", view === v ? "bg-ink text-white" : "text-ink-soft hover:bg-canvas")}>{v}</Link>
              ))}
            </div>
          </div>
        } />

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-1">
            <Link href={q(view, prev)} className={buttonClass("ghost", "sm")} aria-label="Previous"><ChevronLeft className="size-4" /></Link>
            <Link href={q(view, next)} className={buttonClass("ghost", "sm")} aria-label="Next"><ChevronRight className="size-4" /></Link>
            <h2 className="ml-1 text-[17px] font-semibold tracking-tight">{title}</h2>
          </div>
          <Link href={q(view, today)} className={buttonClass("secondary", "sm")}>Today</Link>
        </div>

        {warnings.length > 0 && (
          <div className="flex items-start gap-2 border-b border-line bg-warn-soft px-4 py-2.5 text-sm text-warn">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>Coverage: {threshold}+ people away on {warnings.map((d) => formatDate(d, { year: false })).join(", ")}.</span>
          </div>
        )}

        {/* Grid (tablet/desktop) */}
        <div className="hidden md:block">
          <div className="grid grid-cols-7 border-b border-line bg-canvas/60 text-xs font-medium uppercase tracking-wide text-muted">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="px-3 py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const inMonth = view === "week" || d.slice(5, 7) === anchor.slice(5, 7);
              const weekend = !settings.working_days.includes(isoWeekday(d));
              const list = byDay.get(d) ?? [];
              const crowded = leader && busy(d) >= threshold && !weekend;
              return (
                <div key={d} className={cn("border-b border-r border-line p-2 [&:nth-child(7n)]:border-r-0",
                  view === "week" ? "min-h-[260px]" : "min-h-[112px]", (!inMonth || weekend) && "bg-canvas/50", crowded && "bg-warn-soft/60")}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className={cn("grid size-6 place-items-center rounded-full text-xs tabular",
                      d === today ? "bg-accent font-semibold text-white" : inMonth ? "text-ink-soft" : "text-muted/60")}>{Number(d.slice(8))}</span>
                  </div>
                  {holidayMap.get(d) && <div className="mb-1 truncate rounded-md bg-holiday-soft px-1.5 py-0.5 text-[11px] font-medium text-holiday">{holidayMap.get(d)}</div>}
                  <div className="space-y-1">
                    {list.slice(0, view === "week" ? 12 : 4).map((e) => <Chip key={e.employee_id + e.portion} e={e} />)}
                    {list.length > (view === "week" ? 12 : 4) && <p className="px-1 text-[11px] text-muted">+{list.length - 4} more</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Agenda (mobile) */}
        <ul className="divide-y divide-line md:hidden">
          {days.filter((d) => (view === "week" || d.slice(5, 7) === anchor.slice(5, 7)) && (byDay.get(d)?.length || holidayMap.get(d))).map((d) => (
            <li key={d} className="px-4 py-3">
              <p className={cn("text-sm font-medium", d === today && "text-accent")}>{formatDate(d, { weekday: true, year: false })}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {holidayMap.get(d) && <Badge tone="holiday">{holidayMap.get(d)}</Badge>}
                {(byDay.get(d) ?? []).map((e) => <Chip key={e.employee_id + e.portion} e={e} />)}
              </div>
            </li>
          ))}
          {!entries.length && !holidays?.length && <li className="px-4 py-8 text-center text-sm text-muted">Everyone&apos;s in.</li>}
        </ul>
      </Card>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-accent" /> You</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-line-strong" /> Colleague away</span>
        {leader && <><span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-vacation" /> Vacation</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-lieu" /> Lieu</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full border border-dashed border-ink-soft" /> Pending</span></>}
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-holiday" /> Public holiday</span>
      </div>
    </>
  );
}

function Chip({ e }: { e: Entry }) {
  const pending = e.status === "pending";
  const color = e.is_self ? "bg-accent-soft text-accent-strong"
    : e.kind === "vacation" ? "bg-vacation-soft text-vacation"
    : e.kind ? "bg-lieu-soft text-lieu" : "bg-black/[0.05] text-ink-soft";
  const first = e.full_name.split(" ")[0] + (e.full_name.split(" ")[1] ? " " + e.full_name.split(" ")[1][0] + "." : "");
  return (
    <div title={`${e.full_name} · ${pending ? "pending" : "away"}${e.kind ? " · " + e.kind : ""}${e.portion !== "full" ? " · half day " + e.portion.toUpperCase() : ""}`}
      className={cn("truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium", color, pending && "border border-dashed border-current bg-transparent")}>
      {e.is_self ? "You" : first}{e.portion !== "full" && <span className="opacity-70"> ½</span>}
    </div>
  );
}
