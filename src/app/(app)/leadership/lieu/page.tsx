import { requireLeader } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Alert, Badge, Card, CardHeader, Empty, LinkButton, PageHeader, StatusBadge, Table, td, th } from "@/components/ui";
import { LieuDecision } from "@/components/decision-forms";
import { formatDate } from "@/lib/rules/dates";
import { formatDays } from "@/lib/format";

export const metadata = { title: "Lieu Approvals" };

export default async function LieuApprovalsPage() {
  const me = await requireLeader();
  const supabase = await createClient();
  const select = "*, employee:employee_profiles!lieu_submissions_employee_id_fkey(full_name), project:projects(name), lieu_work_entries(id, work_date, hours, day_type, proposed_credit, approved_credit, category, needs_review, review_reason)";
  const [{ data: pending }, { data: recent }] = await Promise.all([
    supabase.from("lieu_submissions").select(select).eq("status", "pending").not("employee_id", "in", `(${me.self_approval_allowed ? "00000000-0000-0000-0000-000000000000" : me.id})`).order("created_at"),
    supabase.from("lieu_submissions").select(select).neq("status", "pending").not("employee_id", "in", `(${me.self_approval_allowed ? "00000000-0000-0000-0000-000000000000" : me.id})`).order("updated_at", { ascending: false }).limit(25),
  ]);
  const contexts = await Promise.all((pending ?? []).map(async (s) => (await supabase.rpc("lieu_review_context", { submission_id: s.id }).single()).data));

  return (
    <>
      <PageHeader title="Lieu approvals" subtitle="Approve, adjust, or send back project lieu submissions. Every change is recorded."
        action={me.role === "people_admin" && <LinkButton href="/leadership/lieu/bulk">Bulk lieu entry</LinkButton>} />

      <div className="space-y-4">
        {pending?.length ? pending.map((s, i) => {
          const ctx = contexts[i] as { lieu_available: number; advance_days: { start_date: string; days: number; status: string; same_project: boolean }[] } | null;
          const entries = [...s.lieu_work_entries].sort((a, b) => a.work_date.localeCompare(b.work_date));
          return (
            <Card key={s.id} className="p-5">
              <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
                <div>
                  <h3 className="text-[17px] font-semibold">{s.employee?.full_name}</h3>
                  <p className="text-[15px] text-ink-soft">{s.project?.name}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.source === "bulk" && <Badge>Bulk entry</Badge>}
                    {s.needs_review && <Badge tone="warn">Needs review</Badge>}
                  </div>
                  <dl className="mt-3 space-y-1 text-sm">
                    <div><dt className="inline text-muted">Proposed: </dt><dd className="inline font-medium tabular text-lieu">{formatDays(s.total_proposed)}</dd></div>
                    <div><dt className="inline text-muted">Current lieu balance: </dt><dd className="inline tabular">{formatDays(ctx?.lieu_available)}</dd></div>
                    <div><dt className="inline text-muted">Submitted: </dt><dd className="inline">{formatDate(s.created_at.slice(0, 10))}</dd></div>
                  </dl>
                  {s.note && <p className="mt-3 rounded-xl bg-canvas px-3 py-2 text-sm text-ink-soft">“{s.note}”</p>}
                </div>
                <div className="space-y-3">
                  {!!ctx?.advance_days.length && (
                    <Alert tone="info">
                      <strong>Advance lieu already given:</strong>{" "}
                      {ctx.advance_days.map((a) => `${formatDate(a.start_date, { weekday: true, year: false })} (${formatDays(a.days)}${a.same_project ? ", this project" : ""}, ${a.status})`).join("; ")}.
                      {" "}It has already been deducted from their balance, so approve the full credit; the advance day nets it out. Banked lieu and vacation don&apos;t affect this credit.
                    </Alert>
                  )}
                  <LieuDecision id={s.id} entries={entries} />
                </div>
              </div>
            </Card>
          );
        }) : <Card><Empty title="No lieu submissions waiting" /></Card>}
      </div>

      <Card className="mt-6">
        <CardHeader title="Recently reviewed" />
        {recent?.length ? (
          <Table>
            <thead><tr><th className={th}>Employee</th><th className={th}>Project</th><th className={th}>Dates</th><th className={th}>Proposed</th><th className={th}>Approved</th><th className={th}>Status</th><th className={th}>Notes</th></tr></thead>
            <tbody>
              {recent.map((s) => (
                <tr key={s.id}>
                  <td className={td + " font-medium"}>{s.employee?.full_name}</td>
                  <td className={td}>{s.project?.name}</td>
                  <td className={td + " text-ink-soft"}>{[...s.lieu_work_entries].sort((a, b) => a.work_date.localeCompare(b.work_date)).map((e) => `${formatDate(e.work_date, { year: false })} (${e.hours}h)`).join(", ")}</td>
                  <td className={td + " tabular"}>{formatDays(s.total_proposed, { unit: false })}</td>
                  <td className={td + " tabular font-medium text-lieu"}>{s.total_approved != null ? formatDays(s.total_approved, { unit: false }) : "—"}</td>
                  <td className={td}><StatusBadge status={s.status} /></td>
                  <td className={td + " max-w-[220px] text-xs text-muted"}>{[s.adjustment_reason && `Adjusted: ${s.adjustment_reason}`, s.review_note].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <Empty title="Nothing yet" />}
      </Card>
    </>
  );
}
