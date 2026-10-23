import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getToday } from "@/lib/data";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { EmployeeTable, type EmployeeRow } from "@/components/employee-table";

export const metadata = { title: "Employees" };

export default async function EmployeesPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data }, today] = await Promise.all([supabase.rpc("admin_employee_table"), getToday()]);
  return (
    <>
      <PageHeader title="Employees" subtitle="Profiles, contractual entitlements and balances. Visible to People Admins only."
        action={<><LinkButton href="/leadership/employees/new">Add employee</LinkButton><LinkButton href="/leadership/setup#import" variant="secondary">Import CSV</LinkButton></>} />
      <Card><EmployeeTable rows={(data ?? []) as EmployeeRow[]} today={today} /></Card>
    </>
  );
}
