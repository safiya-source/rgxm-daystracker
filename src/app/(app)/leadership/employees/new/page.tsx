import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSettings, getToday } from "@/lib/data";
import { PageHeader } from "@/components/ui";
import { EmployeeForm } from "@/components/employee-form";

export const metadata = { title: "Add Employee" };

export default async function NewEmployeePage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: people }, settings, today] = await Promise.all([
    supabase.from("employee_profiles").select("id, full_name").eq("status", "active").order("full_name"), getSettings(), getToday(),
  ]);
  return (
    <>
      <PageHeader title="Add employee" subtitle="You can invite them to sign in once they're added." />
      <EmployeeForm people={people ?? []} today={today} defaults={{ year_type: settings.default_vacation_year, allocation_method: settings.default_allocation }} />
    </>
  );
}
