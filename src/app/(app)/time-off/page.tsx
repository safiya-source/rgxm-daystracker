import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLieuBalances, getToday, getVacationBalance, requestLabel } from "@/lib/data";
import { LieuCard, VacationCard } from "@/components/balance-cards";
import { Alert, Card, CardHeader, Empty, LinkButton, PageHeader, StatusBadge, Table, td, th } from "@/components/ui";
import { formatDate, formatRange } from "@/lib/rules/dates";
import { formatDays } from "@/lib/format";
import { CancelButton, WithdrawLieuButton } from "./row-actions";
import { Ledger } from "@/components/ledger";

export const metadata = { title: "My Time Off" };

export default async function MyTimeOffPage({ searchParams }: { searchParams: Promise<{ submitted?: string; lieu?: string }> }) {
  const sp = await searchParams;
  const me = await requireProfile();
  const supabase = await createClient();
  await supabase.rpc("sync_my_vacation");
  const today = await getToday();
  const [vac, lieu, { data: requests }, { data: subs }, { data: vtx }, { data: ltx }] = await Promise.all([
    getVacationBalance(me.id),
    getLieuBalances(me.id),
    supabase.from("time_off_requests").select("*").eq("employee_id", me.id).order("start_date", { ascending: false }).limit(50),
    supabase.from("lieu_submissions").select("*, projects(name), lieu_work_entries(work_date, hours, proposed_credit, approved_credit, needs_review)")
      .eq("employee_id", me.id).order("created_at", { ascending: false }).limit(30),
    supabase.from("vacation_transactions").select("*").eq("employee_id", me.id).order("created_at", { ascending: false }).limit(40),
    supabase.from("lieu_transactions").select("*").eq("employee_id", me.id).order("created_at", { ascending: false }).limit(40),
  ]);

  return (
    <>
      <PageHeader title="My time off" subtitle="Your balances, requests and full history."
        action={<><LinkButton href="/time-off/request">Request time off</LinkButton><LinkButton href="/lieu/new" variant="secondary">Add lieu time</LinkButton></>} />
      {sp.submitted && <Alert tone="ok" className="mb-5">Request submitted. We&apos;ve let your approver know.</Alert>}
      {sp.lieu && <Alert tone="ok" className="mb-5">Lieu time submitted for approval. It&apos;ll be added to your balance once approved.</Alert>}

      <div className="grid gap-5 md:grid-cols-2">
        <VacationCard b={vac} />
        <LieuCard disc={lieu.discretionary} stat={lieu.statutory} />
      </div>

      <Card className="mt-5">
        <CardHeader title="Time-off requests" />
        {requests?.length ? (
          <Table>
            <thead><tr><th className={th}>Dates</th><th className={th}>Type</th><th className={th}>Days</th><th className={th}>Status</th><th className={th}>Note</th><th className={th}></th></tr></thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className={td + " whitespace-nowrap font-medium"}>{formatRange(r.start_date, r.end_date)}{r.portion !== "full" && ` · ${r.portion.toUpperCase()}`}</td>
                  <td className={td}>{requestLabel(r)}</td>
                  <td className={td + " tabular"}>{formatDays(r.days, { unit: false })}</td>
                  <td className={td}><StatusBadge status={r.status} /></td>
                  <td className={td + " max-w-[240px] text-muted"}>
                    {r.note && <p className="truncate">{r.note}</p>}
                    {r.review_note && <p className="truncate text-xs">Approver: {r.review_note}</p>}
                  </td>
                  <td className={td + " text-right"}>
                    {(r.status === "pending" || (r.status === "approved" && r.start_date > today)) && <CancelButton id={r.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <Empty title="No requests yet" />}
      </Card>

      <Card className="mt-5">
        <CardHeader title="Lieu submissions" subtitle="Weekend and extended days you've logged" />
        {subs?.length ? (
          <ul className="divide-y divide-line">
            {subs.map((s) => (
              <li key={s.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{s.projects?.name}</p>
                    <p className="text-sm text-muted">
                      {s.lieu_work_entries.map((e) => `${formatDate(e.work_date, { weekday: true, year: false })} · ${e.hours}h`).join("  ·  ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm tabular">
                      {s.status === "approved" ? formatDays(s.total_approved) : `${formatDays(s.total_proposed)} proposed`}
                    </span>
                    <StatusBadge status={s.status} />
                  </div>
                </div>
                {s.review_note && <p className="mt-2 text-sm text-ink-soft">“{s.review_note}”</p>}
                {s.adjustment_reason && <p className="mt-1 text-sm text-ink-soft">Adjusted: {s.adjustment_reason}</p>}
                {(s.status === "changes_requested" || s.status === "pending") && (
                  <div className="mt-2 flex gap-2">
                    <Link href={`/lieu/new?edit=${s.id}`} className="text-sm font-medium text-accent hover:underline">Edit &amp; resubmit</Link>
                    <WithdrawLieuButton id={s.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : <Empty title="No lieu logged yet" action={<LinkButton href="/lieu/new" variant="secondary" size="sm">Add lieu time</LinkButton>}>Worked a weekend activation or a long production day? Log it in under 30 seconds.</Empty>}
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Ledger title="Vacation history" rows={vtx ?? []} color="text-vacation" />
        <Ledger title="Lieu history" rows={ltx ?? []} color="text-lieu" />
      </div>
    </>
  );
}
