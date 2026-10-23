"use client";

import { useActionState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Button, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { adjustBalance, changeEntitlement, inviteEmployee, setEmployeeStatus } from "@/app/(app)/leadership/actions";

export function InviteButton({ id, hasLogin, invitedAt }: { id: string; hasLogin: boolean; invitedAt: string | null }) {
  const [state, action, pending] = useActionState(inviteEmployee, null);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button variant="secondary" disabled={pending}>{pending ? "Sending…" : hasLogin ? "Send password reset" : invitedAt ? "Resend invitation" : "Send invitation"}</Button>
      {state?.message && <span className="text-sm text-ok">{state.message}</span>}
      {state?.error && <span className="text-sm text-danger">{state.error}</span>}
    </form>
  );
}

export function StatusButton({ id, status }: { id: string; status: "active" | "inactive" }) {
  const [state, action, pending] = useActionState(setEmployeeStatus, null);
  const next = status === "active" ? "inactive" : "active";
  return (
    <form action={action} className="inline-flex items-center gap-2"
      onSubmit={(e) => { if (next === "inactive" && !confirm("Deactivate this employee? Their sign-in is disabled, open requests are withdrawn, and their history is kept.")) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={next} />
      <Button variant={next === "inactive" ? "danger" : "secondary"} disabled={pending}>{next === "inactive" ? "Deactivate" : "Reactivate"}</Button>
      {state?.error && <span className="text-sm text-danger">{state.error}</span>}
    </form>
  );
}

export function EntitlementForm({ id, current, today }: { id: string; current: { annual_days: number; year_type: string; allocation_method: string } | null; today: string }) {
  return (
    <Card>
      <CardHeader title="Change entitlement" subtitle="Effective-dated. Upfront allocations are trued-up for the rest of the year." />
      <ActionForm action={changeEntitlement} resetOnSuccess className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
        <input type="hidden" name="id" value={id} />
        <Field label="Annual days"><Input name="annual_days" type="number" step="0.5" min="0" max="60" required defaultValue={current?.annual_days} /></Field>
        <Field label="Effective from"><Input name="effective_from" type="date" required defaultValue={today} /></Field>
        <Field label="Vacation year">
          <Select name="year_type" defaultValue={current?.year_type ?? "calendar"}><option value="calendar">Calendar year</option><option value="anniversary">Employment anniversary</option></Select>
        </Field>
        <Field label="Allocation">
          <Select name="allocation_method" defaultValue={current?.allocation_method ?? "upfront"}><option value="upfront">Annual upfront</option><option value="accrual">Monthly accrual</option></Select>
        </Field>
        <Field label="Reason" className="sm:col-span-2"><Input name="note" required placeholder="e.g. 5-year anniversary, new contract" /></Field>
        <div className="sm:col-span-2"><SubmitButton variant="secondary">Save entitlement</SubmitButton></div>
      </ActionForm>
    </Card>
  );
}

export function AdjustForm({ id }: { id: string }) {
  return (
    <Card>
      <CardHeader title="Adjust a balance" subtitle="Every adjustment needs a reason and is visible to the employee." />
      <ActionForm action={adjustBalance} resetOnSuccess className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
        <input type="hidden" name="id" value={id} />
        <Field label="Balance">
          <Select name="ledger" defaultValue="vacation"><option value="vacation">Vacation</option><option value="lieu">Lieu</option></Select>
        </Field>
        <Field label="Lieu category (lieu only)">
          <Select name="category" defaultValue="discretionary"><option value="discretionary">Lieu</option><option value="statutory">Statutory (public holiday)</option></Select>
        </Field>
        <Field label="Add or remove">
          <Select name="direction" defaultValue="add"><option value="add">Add days</option><option value="remove">Remove days</option></Select>
        </Field>
        <Field label="Days"><Input name="amount" type="number" step="0.25" min="0.25" required /></Field>
        <Field label="Reason" className="sm:col-span-2"><Input name="reason" required placeholder="e.g. Correction to opening balance" /></Field>
        <div className="sm:col-span-2"><SubmitButton variant="secondary">Record adjustment</SubmitButton></div>
      </ActionForm>
    </Card>
  );
}

export function SavedNotice() {
  return <Alert tone="ok" className="mb-5">Saved.</Alert>;
}
