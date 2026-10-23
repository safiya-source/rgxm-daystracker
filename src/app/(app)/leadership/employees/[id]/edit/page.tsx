import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSettings, getToday } from "@/lib/data";
import { PageHeader } from "@/components/ui";
import { EmployeeForm } from "@/components/employee-form";

export const metadata = { title: "Edit Employee" };

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: employee }, { data: people }, settings, today] = await Promise.all([
    supabase.from("employee_profiles").select("*").eq("id", id).maybeSingle(),
    supabase.from("employee_profiles").select("id, full_name").eq("status", "active").order("full_name"), getSettings(), getToday(),
  ]);
  if (!employee) notFound();
  return (
    <>
      <PageHeader title={`Edit ${employee.full_name}`} subtitle="Entitlement and balance changes are made from the profile page so they're dated and documented." />
      <EmployeeForm employee={employee} people={people ?? []} today={today} defaults={{ year_type: settings.default_vacation_year, allocation_method: settings.default_allocation }} />
    </>
  );
}
