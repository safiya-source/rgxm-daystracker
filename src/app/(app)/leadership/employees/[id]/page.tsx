import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getToday } from "@/lib/data";
import { Alert, Card, CardHeader, LinkButton, PageHeader, Table, td, th } from "@/components/ui";
import { ProfileView } from "@/components/profile-view";
import { Ledger } from "@/components/ledger";
import { AdjustForm, EntitlementForm, InviteButton, InviteLinkPanel, SelfApprovalToggle, StatusButton } from "@/components/admin-employee-panels";
import { formatDate } from "@/lib/rules/dates";
import { formatDays, ROLE_LABEL } from "@/lib/format";

export const metadata = { title: "Employee" };

export default async function EmployeeAdminPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const { saved } = await searchParams;
  await requireAdmin();
  const supabase = await createClient();
  const { data: p } = await supabase.from("employee_profiles").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  const today = await getToday();
  const [{ data: ents }, { data: history }, { data: vtx }, { data: ltx }, { data: approvers }] = await Promise.all([
    supabase.from("vacation_entitlements").select("*").eq("employee_id", id).order("effective_from", { ascending: false }),
    supabase.from("employment_records").select("*, manager:employee_profiles!employment_records_manager_id_fkey(full_name)").eq("employee_id", id).order("created_at", { ascending: false }),
    supabase.from("vacation_transactions").select("*").eq("employee_id", id).order("created_at", { ascending: false }).limit(60),
    supabase.from("lieu_transactions").select("*").eq("employee_id", id).order("created_at", { ascending: false }).limit(60),
    supabase.from("employee_profiles").select("full_name").in("id", [p.manager_id, p.backup_approver_id].filter(Boolean) as string[]),
  ]);
  const current = ents?.find((e) => e.effective_from <= today) ?? ents?.[ents.length - 1] ?? null;

  return (
    <>
      <PageHeader title={p.full_name} subtitle={`${p.job_title ?? ""}${p.department ? " · " + p.department : ""}`}
        action={<>
          <LinkButton href={`/leadership/employees/${id}/edit`} variant="secondary">Edit details</LinkButton>
          {p.status === "active" && <InviteButton id={id} hasLogin={!!p.user_id} invitedAt={p.invited_at} />}
          <StatusButton id={id} status={p.status} />
        </>} />
      {saved && <Alert tone="ok" className="mb-5">Saved.</Alert>}
      {p.status === "active" && !p.user_id && (
        <Alert tone="warn" className="mb-5">{p.invited_at ? `Invited ${formatDate(p.invited_at.slice(0, 10))}. They haven't signed in yet.` : "Not invited yet. Create an invite link below and send it to them."}</Alert>
      )}

      {p.status === "active" && <div className="mb-5"><InviteLinkPanel id={id} email={p.work_email} hasLogin={!!p.user_id} /></div>}

      <ProfileView p={p} approvers={(approvers ?? []).map((a) => a.full_name)} />

      <div className="mt-5"><SelfApprovalToggle id={id} allowed={p.self_approval_allowed} approvers={(approvers ?? []).map((a) => a.full_name)} /></div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <EntitlementForm id={id} current={current} today={today} />
        <AdjustForm id={id} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Entitlement history" />
          <Table>
            <thead><tr><th className={th}>Effective</th><th className={th}>Days / year</th><th className={th}>Year</th><th className={th}>Allocation</th><th className={th}>Note</th></tr></thead>
            <tbody>
              {(ents ?? []).map((e) => (
                <tr key={e.id}>
                  <td className={td + " whitespace-nowrap"}>{formatDate(e.effective_from)}</td>
                  <td className={td + " tabular font-medium"}>{formatDays(e.annual_days, { unit: false })}</td>
                  <td className={td}>{e.year_type === "calendar" ? "Calendar" : "Anniversary"}</td>
                  <td className={td}>{e.allocation_method === "upfront" ? "Upfront" : "Accrual"}</td>
                  <td className={td + " text-muted"}>{e.note}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Employment history" />
          <Table>
            <thead><tr><th className={th}>From</th><th className={th}>Title</th><th className={th}>Role</th><th className={th}>Manager</th><th className={th}>Status</th></tr></thead>
            <tbody>
              {(history ?? []).map((h) => (
                <tr key={h.id}>
                  <td className={td + " whitespace-nowrap"}>{formatDate(h.effective_from)}</td>
                  <td className={td}>{h.job_title ?? "—"}</td>
                  <td className={td}>{ROLE_LABEL[h.role]}</td>
                  <td className={td}>{h.manager?.full_name ?? "—"}</td>
                  <td className={td}>{h.status}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Ledger title="Vacation ledger" rows={vtx ?? []} color="text-vacation" />
        <Ledger title="Lieu ledger" rows={ltx ?? []} color="text-lieu" />
      </div>
    </>
  );
}
