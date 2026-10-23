"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { saveEmployee } from "@/app/(app)/leadership/actions";
import { yearsOfService, nextAnniversary, formatDate } from "@/lib/rules/dates";
import { statutoryMinimumDays } from "@/lib/rules/leave";
import type { Profile } from "@/lib/auth";

export function EmployeeForm({ employee, people, today, defaults }: {
  employee?: Profile; people: { id: string; full_name: string }[]; today: string;
  defaults: { year_type: string; allocation_method: string };
}) {
  const isNew = !employee;
  const [start, setStart] = useState(employee?.start_date ?? "");
  const [days, setDays] = useState("10");
  const [asOf, setAsOf] = useState("");
  const yos = start ? yearsOfService(start, today) : 0;
  const min = statutoryMinimumDays(yos);
  const fiveYearsSoon = start && yos === 4 ? nextAnniversary(start, today) : null;
  const yearStart = today.slice(0, 4) + "-01-01";
  const defaultAsOf = start ? (start >= yearStart ? start : today) : "";
  const newHire = !!start && start >= (asOf || defaultAsOf);
  const others = people.filter((p) => p.id !== employee?.id);

  return (
    <ActionForm action={saveEmployee} className="space-y-5">
      {employee && <input type="hidden" name="id" value={employee.id} />}
      <Card>
        <CardHeader title="Personal & employment" />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
          <Field label="Full name"><Input name="full_name" required defaultValue={employee?.full_name} maxLength={120} /></Field>
          <Field label="Work email" hint="They'll sign in with this address."><Input name="work_email" type="email" required defaultValue={employee?.work_email} /></Field>
          <Field label="Job title"><Input name="job_title" defaultValue={employee?.job_title ?? ""} /></Field>
          <Field label="Department (optional)"><Input name="department" defaultValue={employee?.department ?? ""} /></Field>
          <Field label="Employment start date"><Input name="start_date" type="date" required value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          {!isNew && (
            <Field label="Employment status">
              <Select name="status" defaultValue={employee.status}><option value="active">Active</option><option value="inactive">Inactive</option></Select>
            </Field>
          )}
          <Field label="User role" hint="People Admins see everyone's balances and settings.">
            <Select name="role" defaultValue={employee?.role ?? "employee"}>
              <option value="employee">Employee</option><option value="manager">Manager</option><option value="people_admin">People Admin</option>
            </Select>
          </Field>
          <Field label="Standard workday hours (optional)" hint="Leave blank to use the agency default.">
            <Input name="standard_day_hours" type="number" step="0.25" min="1" max="24" defaultValue={employee?.standard_day_hours ?? ""} />
          </Field>
          <Field label="Assigned manager (approver)">
            <Select name="manager_id" defaultValue={employee?.manager_id ?? ""}>
              <option value="">People Admins approve</option>
              {others.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Backup approver (optional)">
            <Select name="backup_approver_id" defaultValue={employee?.backup_approver_id ?? ""}>
              <option value="">None</option>
              {others.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      {isNew && (
        <Card>
          <CardHeader title="Vacation & lieu" subtitle="Their contractual entitlement and the balances they're starting with." />
          <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
            <Field label="Annual vacation entitlement (days)">
              <Input name="annual_days" type="number" step="0.5" min="0" max="60" required value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
            <Field label="Balances as of / entitlement effective date" hint={newHire ? "New hire: their first year is prorated from the start date." : "Existing employee: enter the balances they have on this date."}>
              <Input name="entitlement_effective_from" type="date" value={asOf || defaultAsOf} onChange={(e) => setAsOf(e.target.value)} />
            </Field>
            <Field label="Vacation year">
              <Select name="year_type" defaultValue={defaults.year_type}><option value="calendar">Calendar year (Jan–Dec)</option><option value="anniversary">Employment anniversary</option></Select>
            </Field>
            <Field label="Vacation allocation">
              <Select name="allocation_method" defaultValue={defaults.allocation_method}><option value="upfront">Annual upfront</option><option value="accrual">Progressive monthly accrual</option></Select>
            </Field>
            {!newHire && <>
              <Field label="Opening vacation balance (days)" hint="Days available for the current year on the date above."><Input name="opening_vacation" type="number" step="0.25" defaultValue="0" /></Field>
              <Field label="Carryover from previous year (days)"><Input name="opening_carryover" type="number" step="0.25" defaultValue="0" /></Field>
            </>}
            <Field label="Opening lieu balance (days)"><Input name="opening_lieu" type="number" step="0.5" defaultValue="0" /></Field>
          </div>
          {start && Number(days) < min && (
            <Alert tone="warn" className="mx-5 mb-5">Below the Ontario ESA minimum of {min} days for someone with {yos} year{yos === 1 ? "" : "s"} of service (2 weeks under 5 years, 3 weeks from 5 years).</Alert>
          )}
          {fiveYearsSoon && Number(days) < 15 && (
            <Alert tone="info" className="mx-5 mb-5">They reach 5 years on {formatDate(fiveYearsSoon)}, when the ESA minimum rises to 3 weeks.</Alert>
          )}
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <SubmitButton size="lg">{isNew ? "Add employee" : "Save changes"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
