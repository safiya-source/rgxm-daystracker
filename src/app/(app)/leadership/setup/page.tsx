import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/data";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardHeader, LinkButton, PageHeader } from "@/components/ui";
import { AgencyForm, ApproverRow, ImportForm, InviteAllButton } from "@/components/settings-forms";
import { saveSettings } from "../actions";
import { cn } from "@/lib/format";

export const metadata = { title: "Setup" };

export default async function SetupPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [s, { data: people }] = await Promise.all([
    getSettings(),
    supabase.from("employee_profiles").select("id, full_name, role, manager_id, backup_approver_id, user_id, invited_at").eq("status", "active").order("full_name"),
  ]);
  const list = people ?? [];
  const notInvited = list.filter((p) => !p.user_id && !p.invited_at).length;
  const steps = [
    { n: 1, title: "Agency setup", done: s.updated_by != null },
    { n: 2, title: "Add employees", done: list.length > 1 },
    { n: 3, title: "Assign approvers", done: list.some((p) => p.manager_id) },
    { n: 4, title: "Invite employees", done: list.length > 1 && notInvited === 0 },
    { n: 5, title: "Launch", done: s.onboarding_completed },
  ];

  const Step = ({ n, title, children, id }: { n: number; title: string; children: React.ReactNode; id?: string }) => (
    <Card id={id} className="scroll-mt-6">
      <CardHeader title={`${n} · ${title}`} icon={steps[n - 1].done ? <CheckCircle2 className="size-5 text-ok" /> : <Circle className="size-5 text-line-strong" />} />
      <div className="px-5 pb-5">{children}</div>
    </Card>
  );

  return (
    <>
      <PageHeader title="Set up RGXM People" subtitle="Five steps to get the team onto their dashboards." />
      <ol className="mb-6 flex flex-wrap gap-2">
        {steps.map((st) => (
          <li key={st.n} className={cn("rounded-full px-3 py-1 text-sm", st.done ? "bg-ok-soft text-ok" : "bg-black/[0.05] text-muted")}>{st.n}. {st.title}</li>
        ))}
      </ol>
      <div className="space-y-5">
        <Step n={1} title="Agency setup"><AgencyForm s={s} /><p className="mt-3 text-sm text-muted">Vacation defaults, lieu rules and holidays are in <Link href="/leadership/settings" className="underline">Settings</Link>. Ontario&apos;s public holidays are already loaded.</p></Step>
        <Step n={2} title="Add employees" id="import">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2"><LinkButton href="/leadership/employees/new">Add an employee</LinkButton><LinkButton href="/leadership/employees" variant="secondary">View all ({list.length})</LinkButton></div>
            <div className="rounded-xl border border-line p-4">
              <p className="text-sm font-medium">Or import existing employees and balances from CSV</p>
              <p className="mb-3 text-sm text-muted">One row per person. <a href="/api/templates/employees" className="underline">Download the template</a>. Use “balances_as_of” for the date the opening balances apply.</p>
              <ImportForm />
            </div>
          </div>
        </Step>
        <Step n={3} title="Assign approvers">
          <div className="divide-y divide-line">{list.map((e) => <ApproverRow key={e.id} e={e} people={list} />)}</div>
        </Step>
        <Step n={4} title="Invite employees">
          <p className="mb-3 text-sm text-muted">Each person gets a secure, single-use link to set their password. You can also invite people one at a time from their profile.</p>
          <InviteAllButton count={notInvited} />
        </Step>
        <Step n={5} title="Launch">
          {s.onboarding_completed ? <p className="text-sm text-ok">You&apos;re live. 🎉</p> : (
            <ActionForm action={saveSettings}>
              <input type="hidden" name="onboarding_completed__present" value="1" />
              <input type="hidden" name="onboarding_completed" value="on" />
              <SubmitButton>Mark setup complete</SubmitButton>
            </ActionForm>
          )}
        </Step>
      </div>
    </>
  );
}
