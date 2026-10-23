"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import {
  addHoliday, deleteHoliday, generateHolidays, inviteAllPending, runMaintenance, saveLieuRules, saveSettings, setApprover, updateProject, importEmployees,
} from "@/app/(app)/leadership/actions";
import type { Settings } from "@/lib/data";
import type { LieuRules } from "@/lib/rules/lieu";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Toggle({ name, label, hint, defaultChecked }: { name: string; label: string; hint?: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-line p-3">
      <input type="hidden" name={name + "__present"} value="1" />
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 accent-[var(--color-ink)]" />
      <span className="text-sm"><span className="font-medium">{label}</span>{hint && <span className="block text-muted">{hint}</span>}</span>
    </label>
  );
}

export function AgencyForm({ s }: { s: Settings }) {
  return (
    <ActionForm action={saveSettings} className="grid gap-4 sm:grid-cols-2">
      <Field label="Agency name"><Input name="agency_name" defaultValue={s.agency_name} required /></Field>
      <Field label="Time zone">
        <Select name="timezone" defaultValue={s.timezone}>
          {["America/Toronto", "America/Vancouver", "America/Edmonton", "America/Winnipeg", "America/Halifax", "America/New_York"].map((z) => <option key={z}>{z}</option>)}
        </Select>
      </Field>
      <Field label="Default working days" className="sm:col-span-2">
        <input type="hidden" name="working_days__present" value="1" />
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <label key={d} className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-line-strong px-3 py-1.5 text-sm has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white">
              <input type="checkbox" name="working_days" value={i + 1} defaultChecked={s.working_days.includes(i + 1)} className="sr-only" />{d}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Standard hours per workday"><Input name="standard_day_hours" type="number" step="0.25" min="1" max="24" defaultValue={s.standard_day_hours} /></Field>
      <Field label="Coverage warning" hint="Warn leadership when this many people are away on the same day."><Input name="coverage_warning_threshold" type="number" min="1" max="50" defaultValue={s.coverage_warning_threshold} /></Field>
      <Field label="Anniversary reminders (days before)" hint="Comma-separated, 0 = on the day."><Input name="anniversary_reminder_days" defaultValue={s.anniversary_reminder_days.join(", ")} /></Field>
      <Field label="Remind approvers of upcoming absences (days before)"><Input name="absence_reminder_days" type="number" min="0" max="30" defaultValue={s.absence_reminder_days} /></Field>
      <div className="sm:col-span-2"><Toggle name="email_notifications_enabled" label="Email notifications" hint="Also send notifications by email (requires RESEND_API_KEY on the server)." defaultChecked={s.email_notifications_enabled} /></div>
      <div className="sm:col-span-2"><SubmitButton>Save agency settings</SubmitButton></div>
    </ActionForm>
  );
}

export function VacationSettingsForm({ s }: { s: Settings }) {
  return (
    <ActionForm action={saveSettings} className="grid gap-4 sm:grid-cols-2">
      <Field label="Default vacation year" hint="Used for new employees; each person's contract can differ.">
        <Select name="default_vacation_year" defaultValue={s.default_vacation_year}><option value="calendar">Calendar year</option><option value="anniversary">Employment anniversary</option></Select>
      </Field>
      <Field label="Default accrual method">
        <Select name="default_allocation" defaultValue={s.default_allocation}><option value="upfront">Annual upfront</option><option value="accrual">Progressive monthly accrual</option></Select>
      </Field>
      <Field label="Carryover cap (days)" hint="Leave blank for unlimited. Ontario requires vacation to be taken within 10 months of the year it's earned in.">
        <Input name="carryover_cap_days" type="number" step="0.5" min="0" defaultValue={s.carryover_cap_days ?? ""} />
      </Field>
      <div />
      <Toggle name="allow_half_days" label="Allow half-day requests" defaultChecked={s.allow_half_days} />
      <Toggle name="allow_negative_vacation" label="Allow negative vacation balances" hint="Approvers can approve vacation beyond the available balance." defaultChecked={s.allow_negative_vacation} />
      <div className="sm:col-span-2"><SubmitButton>Save vacation settings</SubmitButton></div>
    </ActionForm>
  );
}

export function LieuRulesForm({ r, s, today }: { r: LieuRules; s: Settings; today: string }) {
  const n = (name: keyof LieuRules, label: string, step = "0.5") => (
    <Field label={label}><Input name={name} type="number" step={step} min="0" max="24" required defaultValue={r[name]} /></Field>
  );
  return (
    <div className="space-y-6">
      <ActionForm action={saveLieuRules} className="grid gap-4 sm:grid-cols-3">
        <p className="text-sm font-medium sm:col-span-3">Weekend / non-working days</p>
        {n("weekend_half_min_hours", "Half-day credit from (hrs)", "0.25")}
        {n("weekend_half_credit", "Half-day credit (days)")}
        <div />
        {n("weekend_full_min_hours", "Full-day credit from (hrs)", "0.25")}
        {n("weekend_full_credit", "Full-day credit (days)")}
        <div />
        <p className="text-sm font-medium sm:col-span-3">Extended workdays (total hours that day)</p>
        {n("weekday_min_hours", "Credit from (hrs)", "0.25")}
        {n("weekday_credit", "Credit (days)")}
        {n("weekday_review_above_hours", "Leadership review above (hrs)", "0.25")}
        <Field label="Rules take effect from" hint="Work dates before this keep the previous rules."><Input name="effective_from" type="date" defaultValue={today} min={today} /></Field>
        <div className="flex items-end sm:col-span-2"><SubmitButton>Save new rule version</SubmitButton></div>
      </ActionForm>
      <ActionForm action={saveSettings} className="grid gap-4 border-t border-line pt-5 sm:grid-cols-3">
        <Field label="Lieu expiry (months)" hint="Blank = never. Unused discretionary lieu expires oldest-first."><Input name="lieu_expiry_months" type="number" min="1" max="60" defaultValue={s.lieu_expiry_months ?? ""} /></Field>
        <div className="flex items-end"><SubmitButton variant="secondary">Save expiry</SubmitButton></div>
      </ActionForm>
    </div>
  );
}

export function HolidayRow({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState(deleteHoliday, null);
  return (
    <form action={action} className="flex items-center justify-between gap-3 py-2 text-sm">
      <input type="hidden" name="id" value={id} />
      <span>{label}</span>
      <button disabled={pending} aria-label="Remove holiday" className="rounded-lg p-1.5 text-muted hover:bg-danger-soft hover:text-danger"><Trash2 className="size-4" /></button>
      {state?.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}

export function HolidayForms({ year }: { year: number }) {
  return (
    <div className="space-y-4">
      <ActionForm action={addHoliday} resetOnSuccess className="grid gap-2 sm:grid-cols-[150px_1fr_160px_auto]">
        <Input type="date" name="date" required />
        <Input name="name" placeholder="e.g. Holiday office closure" required />
        <Select name="kind" defaultValue="closure"><option value="closure">Office closure</option><option value="statutory">Public holiday</option></Select>
        <SubmitButton variant="secondary">Add</SubmitButton>
      </ActionForm>
      <ActionForm action={generateHolidays} className="flex flex-wrap items-center gap-2">
        <Input type="number" name="year" defaultValue={year} className="w-28" />
        <SubmitButton variant="ghost" size="sm">Add Ontario’s 9 public holidays for this year</SubmitButton>
      </ActionForm>
    </div>
  );
}

export function ProjectRow({ p }: { p: { id: string; name: string; client: string | null; is_active: boolean } }) {
  return (
    <ActionForm action={updateProject} className="grid items-center gap-2 py-2 sm:grid-cols-[1fr_200px_110px_auto]">
      <input type="hidden" name="id" value={p.id} />
      <Input name="name" defaultValue={p.name} required />
      <Input name="client" defaultValue={p.client ?? ""} placeholder="Client" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={p.is_active} className="size-4" /> Active</label>
      <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
    </ActionForm>
  );
}

export function ApproverRow({ e, people }: { e: { id: string; full_name: string; role: string; manager_id: string | null; backup_approver_id: string | null }; people: { id: string; full_name: string }[] }) {
  const [state, action, pending] = useActionState(setApprover, null);
  const others = people.filter((p) => p.id !== e.id);
  return (
    <form action={action} className="grid items-center gap-2 py-2.5 sm:grid-cols-[1fr_200px_200px_auto]">
      <input type="hidden" name="id" value={e.id} />
      <span className="text-sm font-medium">{e.full_name}{e.role === "people_admin" && <span className="ml-1.5 text-xs font-normal text-muted">People Admin</span>}</span>
      <Select name="manager_id" defaultValue={e.manager_id ?? ""} className="h-9 text-sm">
        <option value="">{e.role === "people_admin" ? "Any other People Admin" : "People Admins"}</option>
        {others.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
      </Select>
      <Select name="backup_approver_id" defaultValue={e.backup_approver_id ?? ""} className="h-9 text-sm">
        <option value="">No backup</option>
        {others.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
      </Select>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={pending}>{pending ? "…" : "Save"}</Button>
        {state?.message && <span className="text-xs text-ok">✓</span>}
        {state?.error && <span className="text-xs text-danger">{state.error}</span>}
      </div>
    </form>
  );
}

export function MaintenanceButton() {
  const [state, action, pending] = useActionState(runMaintenance, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" disabled={pending}>{pending ? "Running…" : "Recalculate balances & send reminders now"}</Button>
      {state?.message && <span className="text-sm text-ok">{state.message}</span>}
      {state?.error && <span className="text-sm text-danger">{state.error}</span>}
    </form>
  );
}

export function InviteAllButton({ count }: { count: number }) {
  const [state, action, pending] = useActionState(inviteAllPending, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button disabled={pending || !count}>{pending ? "Sending…" : `Invite ${count} employee${count === 1 ? "" : "s"}`}</Button>
      {state?.message && <span className="text-sm text-ok">{state.message}</span>}
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
    </form>
  );
}

export function ImportForm() {
  return (
    <ActionForm action={importEmployees} className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Input type="file" name="file" accept=".csv,text/csv" required className="py-1.5" />
      <SubmitButton variant="secondary" pendingText="Importing…">Import employees</SubmitButton>
    </ActionForm>
  );
}
