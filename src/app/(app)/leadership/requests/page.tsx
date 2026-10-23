import { requireLeader } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProjects, getSettings, requestLabel } from "@/lib/data";
import { Alert, Badge, Card, CardHeader, Empty, PageHeader, StatusBadge, Table, td, th } from "@/components/ui";
import { AdvanceDayForm, LeaderCancel, RequestDecision } from "@/components/decision-forms";
import { formatDate, formatRange } from "@/lib/rules/dates";
import { formatDays } from "@/lib/format";

export const metadata = { title: "Time-Off Requests" };

type Ctx = { vacation_available: number; vacation_pending: number; lieu_available: number; lieu_pending: number; coverage: { date: string; count: number; names: string[] }[] };

export default async function RequestsPage() {
  const me = await requireLeader();
  const supabase = await createClient();
  const settings = await getSettings();
  const [{ data: pending }, { data: recent }, { data: people }, projects] = await Promise.all([
    supabase.from("time_off_requests").select("*, employee:employee_profiles!time_off_requests_employee_id_fkey(full_name), project:projects(name)")
      .eq("status", "pending").neq("employee_id", me.id).order("start_date"),
    supabase.from("time_off_requests").select("*, employee:employee_profiles!time_off_requests_employee_id_fkey(full_name)")
      .neq("status", "pending").neq("employee_id", me.id).order("updated_at", { ascending: false }).limit(30),
    supabase.from("employee_profiles").select("id, full_name").neq("id", me.id).eq("status", "active").order("full_name"),
    getProjects(),
  ]);
  const contexts = await Promise.all((pending ?? []).map(async (r) => (await supabase.rpc("request_review_context", { request_id: r.id }).single()).data as Ctx | null));

  return (
    <>
      <PageHeader title="Time-off requests" subtitle="Vacation and lieu time-off waiting for you, with balances and team coverage." />

      <div className="space-y-4">
        {pending?.length ? pending.map((r, i) => {
          const c = contexts[i];
          const avail = r.kind === "vacation" ? Number(c?.vacation_available ?? 0) : Number(c?.lieu_available ?? 0);
          const after = avail - Number(r.days);
          const short = after < 0 && !(r.kind === "lieu" && r.is_advance);
          const blocked = short && (r.kind === "lieu" || !settings.allow_negative_vacation) ? "Not enough balance to approve" : undefined;
          const crowded = (c?.coverage ?? []).filter((d) => d.count + 1 >= settings.coverage_warning_threshold);
          return (
            <Card key={r.id} className="p-5">
              <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[17px] font-semibold">{r.employee?.full_name}</h3>
                    <Badge tone={r.kind === "vacation" ? "vacation" : "lieu"}>{requestLabel(r)}</Badge>
                    {r.project && <Badge>{r.project.name}</Badge>}
                  </div>
                  <p className="mt-1 text-[15px]">{formatRange(r.start_date, r.end_date)}{r.portion !== "full" && ` · half day (${r.portion.toUpperCase()})`} · <strong>{formatDays(r.days)}</strong></p>
                  {r.note && <p className="mt-2 rounded-xl bg-canvas px-3 py-2 text-sm text-ink-soft">“{r.note}”</p>}
                  <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    <div><dt className="inline text-muted">Available: </dt><dd className="inline tabular font-medium">{formatDays(avail)}</dd></div>
                    {!(r.kind === "lieu" && r.is_advance) && <div><dt className="inline text-muted">After approval: </dt><dd className={`inline tabular font-medium ${after < 0 ? "text-danger" : ""}`}>{formatDays(after)}</dd></div>}
                    <div><dt className="inline text-muted">Submitted: </dt><dd className="inline">{formatDate(r.created_at.slice(0, 10))}</dd></div>
                  </dl>
                  {short && <Alert tone={blocked ? "danger" : "warn"} className="mt-3">
                    {blocked ? "Insufficient balance. This request can't be approved as-is." : "This will take their vacation balance negative (allowed in Settings)."}
                  </Alert>}
                  {r.is_advance && <Alert tone="info" className="mt-3">Advance lieu day: deducted now, offset by the lieu they log for this project.</Alert>}
                  {crowded.length > 0 && (
                    <Alert tone="warn" className="mt-3">
                      Coverage: {crowded.map((d) => `${formatDate(d.date, { year: false })} (${d.names.join(", ")})`).join(" · ")} already away.
                    </Alert>
                  )}
                  {!crowded.length && !!c?.coverage.length && (
                    <p className="mt-3 text-sm text-muted">Also away: {c.coverage.map((d) => `${formatDate(d.date, { year: false })} – ${d.names.join(", ")}`).join(" · ")}</p>
                  )}
                </div>
                <RequestDecision id={r.id} blocked={blocked} />
              </div>
            </Card>
          );
        }) : <Card><Empty title="No requests waiting">You&apos;re all caught up.</Empty></Card>}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Recent decisions" />
          {recent?.length ? (
            <Table>
              <thead><tr><th className={th}>Employee</th><th className={th}>Dates</th><th className={th}>Type</th><th className={th}>Days</th><th className={th}>Status</th><th className={th} /></tr></thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td className={td + " font-medium"}>{r.employee?.full_name}</td>
                    <td className={td + " whitespace-nowrap"}>{formatRange(r.start_date, r.end_date)}</td>
                    <td className={td}>{requestLabel(r)}</td>
                    <td className={td + " tabular"}>{formatDays(r.days, { unit: false })}</td>
                    <td className={td}><StatusBadge status={r.status} /></td>
                    <td className={td + " text-right"}>{r.status === "approved" && <LeaderCancel id={r.id} />}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty title="Nothing yet" />}
        </Card>
        <Card className="h-fit">
          <CardHeader title="Record an advance lieu day" subtitle="“Long week ahead — take Wednesday off.” Offsets the lieu they'll log for that project." />
          <div className="px-5 pb-5">
            <AdvanceDayForm people={people ?? []} projects={projects.filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.name }))} />
          </div>
        </Card>
      </div>
    </>
  );
}
