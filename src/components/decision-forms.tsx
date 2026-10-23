"use client";

import { useActionState, useRef, useState } from "react";
import { Alert, Button, Input, Select, Textarea } from "@/components/ui";
import { reviewRequest, leaderCancelRequest, reviewLieu, recordAdvanceDay } from "@/app/(app)/leadership/actions";
import { cn, formatDays } from "@/lib/format";
import { formatDate } from "@/lib/rules/dates";
import { ActionForm, SubmitButton } from "@/components/forms";

export function RequestDecision({ id, blocked }: { id: string; blocked?: string }) {
  const [state, action, pending] = useActionState(reviewRequest, null);
  const decision = useRef<HTMLInputElement>(null);
  const choose = (v: string) => () => { if (decision.current) decision.current.value = v; };
  if (state?.message) return <Alert tone="ok">{state.message}</Alert>;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="decision" ref={decision} />
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      <Input name="note" placeholder="Optional note to the employee" maxLength={300} />
      <div className="flex gap-2">
        <Button name="decision" value="approved" onClick={choose("approved")} variant="success" size="sm" disabled={pending || !!blocked} title={blocked}>Approve</Button>
        <Button name="decision" value="declined" onClick={choose("declined")} variant="danger" size="sm" disabled={pending}>Decline</Button>
      </div>
    </form>
  );
}

export function LeaderCancel({ id }: { id: string }) {
  const [state, action, pending] = useActionState(leaderCancelRequest, null);
  const [open, setOpen] = useState(false);
  if (state?.message) return <span className="text-xs text-ok">{state.message}</span>;
  if (!open) return <button onClick={() => setOpen(true)} className="text-sm text-muted hover:text-danger">Cancel…</button>;
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="reason" placeholder="Reason" required className="h-8 w-40 text-sm" />
      <Button size="sm" variant="danger" disabled={pending}>Confirm</Button>
      {state?.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}

type Entry = { id: string; work_date: string; hours: number; day_type: string; proposed_credit: number; category: string; needs_review: boolean; review_reason: string | null };

export function LieuDecision({ id, entries }: { id: string; entries: Entry[] }) {
  const [state, action, pending] = useActionState(reviewLieu, null);
  const [credits, setCredits] = useState(() => Object.fromEntries(entries.map((e) => [e.id, String(e.proposed_credit)])));
  const [cats, setCats] = useState(() => Object.fromEntries(entries.map((e) => [e.id, e.category])));
  const changed = entries.some((e) => Number(credits[e.id]) !== Number(e.proposed_credit) || cats[e.id] !== e.category);
  const total = entries.reduce((s, e) => s + Number(credits[e.id]), 0);
  // React's form action doesn't include the clicked button, so record the choice in a hidden field
  // (the button's own name/value still covers a native submit before hydration).
  const decision = useRef<HTMLInputElement>(null);
  const choose = (v: string) => () => { if (decision.current) decision.current.value = v; };
  if (state?.message) return <Alert tone="ok">{state.message}</Alert>;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="decision" ref={decision} />
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-canvas/60 text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-3 py-2 text-left font-medium">Date worked</th><th className="px-3 py-2 text-right font-medium">Hours</th><th className="px-3 py-2 text-right font-medium">Proposed</th><th className="px-3 py-2 text-right font-medium">Credit</th><th className="px-3 py-2 text-left font-medium">Type</th></tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className={cn("border-t border-line", e.needs_review && "bg-warn-soft/50")}>
                <td className="px-3 py-2">
                  {formatDate(e.work_date, { weekday: true })}
                  <span className="ml-1.5 text-xs text-muted">{e.day_type}</span>
                  {e.review_reason && <p className="text-xs text-warn">{e.review_reason}</p>}
                </td>
                <td className="px-3 py-2 text-right tabular">{e.hours}</td>
                <td className="px-3 py-2 text-right tabular text-muted">{formatDays(e.proposed_credit, { unit: false })}</td>
                <td className="px-3 py-2 text-right">
                  <input type="hidden" name="entry_id" value={e.id} />
                  <Select name="approved_credit" value={credits[e.id]} onChange={(ev) => setCredits({ ...credits, [e.id]: ev.target.value })} className="h-8 w-20 text-sm">
                    {["0", "0.5", "1", "1.5", "2"].map((v) => <option key={v} value={v}>{v}</option>)}
                  </Select>
                </td>
                <td className="px-3 py-2">
                  <Select name="category" value={cats[e.id]} onChange={(ev) => setCats({ ...cats, [e.id]: ev.target.value })} className="h-8 w-36 text-sm">
                    <option value="discretionary">Lieu</option><option value="statutory">Statutory</option>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm">Total credit: <strong className="tabular text-lieu">{formatDays(total)}</strong></p>
      {changed && <Input name="adjustment_reason" placeholder="Reason for adjusting (required)" required maxLength={300} />}
      <Textarea name="note" rows={1} placeholder="Note to the employee (required when requesting changes)" maxLength={300} />
      <div className="flex flex-wrap gap-2">
        <Button name="decision" value="approved" onClick={choose("approved")} variant="success" size="sm" disabled={pending}>Approve {formatDays(total)}</Button>
        <Button name="decision" value="changes_requested" onClick={choose("changes_requested")} variant="secondary" size="sm" disabled={pending} formNoValidate>Request changes</Button>
        <Button name="decision" value="declined" onClick={choose("declined")} variant="danger" size="sm" disabled={pending} formNoValidate>Decline</Button>
      </div>
    </form>
  );
}

export function AdvanceDayForm({ people, projects }: { people: { id: string; full_name: string }[]; projects: { id: string; name: string }[] }) {
  return (
    <ActionForm action={recordAdvanceDay} resetOnSuccess className="grid gap-2 sm:grid-cols-2">
      <Select name="employee_id" required defaultValue=""><option value="" disabled>Employee…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</Select>
      <Select name="project_id" required defaultValue=""><option value="" disabled>For project…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
      <Input type="date" name="date" required />
      <Select name="portion" defaultValue="full"><option value="full">Full day</option><option value="am">Half day (AM)</option><option value="pm">Half day (PM)</option></Select>
      <Input name="note" placeholder="Note (optional)" className="sm:col-span-2" />
      <SubmitButton size="sm" variant="secondary" className="sm:col-span-2">Record advance day</SubmitButton>
    </ActionForm>
  );
}
