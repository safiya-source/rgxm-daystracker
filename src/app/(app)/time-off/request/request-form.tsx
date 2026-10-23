"use client";

import { useMemo, useState } from "react";
import { Palmtree, Sparkles } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { countLeaveDays } from "@/lib/rules/leave";
import { formatDate } from "@/lib/rules/dates";
import { cn, formatDays } from "@/lib/format";
import { submitTimeOff } from "../actions";

type Props = {
  initialKind: "vacation" | "lieu";
  today: string;
  vacationAvailable: number;
  lieuAvailable: number;
  statutoryAvailable: number;
  holidays: { date: string; name: string }[];
  workingDays: number[];
  allowHalfDays: boolean;
  allowNegative: boolean;
  projects: { id: string; name: string }[];
};

export function RequestForm(p: Props) {
  const [kind, setKind] = useState(p.initialKind);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [portion, setPortion] = useState<"full" | "am" | "pm">("full");
  const [category, setCategory] = useState<"discretionary" | "statutory">("discretionary");
  const [advance, setAdvance] = useState(false);

  const holidaySet = useMemo(() => new Set(p.holidays.map((h) => h.date)), [p.holidays]);
  const effEnd = portion === "full" ? end || start : start;
  const preview = countLeaveDays(start, effEnd, portion, { holidays: holidaySet, workingDays: p.workingDays });
  const skippedHolidays = p.holidays.filter((h) => start && h.date >= start && h.date <= effEnd);
  const singleDay = !!start && (!end || end === start);

  const available = kind === "vacation" ? p.vacationAvailable : category === "statutory" ? p.statutoryAvailable : p.lieuAvailable;
  const after = available - preview.days;
  const insufficient = start && preview.days > 0 && after < 0 && !(kind === "lieu" && advance);
  const blocked = insufficient && kind === "lieu";

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="min-w-0 p-5 sm:p-6">
        <ActionForm action={submitTimeOff} className="space-y-5">
          <input type="hidden" name="kind" value={kind} />
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-canvas p-1.5">
            {(["vacation", "lieu"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={cn("flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition",
                  kind === k ? "bg-surface shadow-card" : "text-muted hover:text-ink")}>
                {k === "vacation" ? <Palmtree className="size-4 text-vacation" /> : <Sparkles className="size-4 text-lieu" />}
                {k === "vacation" ? "Vacation" : "Lieu time"}
              </button>
            ))}
          </div>

          {kind === "lieu" && (
            <div className="space-y-3">
              {p.statutoryAvailable > 0 && (
                <Field label="Use from">
                  <Select name="lieu_category" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
                    <option value="discretionary">Lieu balance ({formatDays(p.lieuAvailable)})</option>
                    <option value="statutory">Public-holiday substitute time ({formatDays(p.statutoryAvailable)})</option>
                  </Select>
                </Field>
              )}
              <label className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm">
                <input type="checkbox" name="is_advance" checked={advance} onChange={(e) => setAdvance(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-lieu)]" />
                <span>
                  <span className="font-medium">This is an advance lieu day</span>
                  <span className="block text-muted">Taken before a big project (e.g. &ldquo;rest up before the weekend install&rdquo;). It&apos;s deducted now and offsets the lieu you log for that project.</span>
                </span>
              </label>
              {advance && (
                <Field label="Project">
                  <Select name="project_id" required defaultValue="">
                    <option value="" disabled>Choose the project…</option>
                    {p.projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                  </Select>
                </Field>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date">
              <Input type="date" name="start_date" required value={start} onChange={(e) => { setStart(e.target.value); if (!end || end < e.target.value) setEnd(e.target.value); }} />
            </Field>
            <Field label="End date">
              <Input type="date" name="end_date" required min={start} value={end} disabled={portion !== "full"}
                onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>

          {p.allowHalfDays && (
            <Field label="Length" hint={!singleDay ? "Half days are available for single-day requests." : undefined}>
              <div className="grid grid-cols-3 gap-2">
                {([["full", "Full day(s)"], ["am", "Half · morning"], ["pm", "Half · afternoon"]] as const).map(([v, l]) => (
                  <label key={v} className={cn("cursor-pointer rounded-xl border px-3 py-2 text-center text-sm transition",
                    portion === v ? "border-ink bg-ink text-white" : "border-line-strong hover:bg-canvas",
                    v !== "full" && !singleDay && "pointer-events-none opacity-40")}>
                    <input type="radio" name="portion" value={v} className="sr-only" checked={portion === v}
                      onChange={() => { setPortion(v); if (v !== "full") setEnd(start); }} disabled={v !== "full" && !singleDay} />
                    {l}
                  </label>
                ))}
              </div>
            </Field>
          )}

          <Field label="Note (optional)" hint="Visible to you and your approver only, never to colleagues.">
            <Textarea name="note" rows={2} maxLength={500} placeholder="Anything your approver should know" />
          </Field>

          {blocked && <Alert tone="danger">You don&apos;t have enough lieu time for this request.</Alert>}
          {insufficient && !blocked && (
            <Alert tone="warn">
              This is more vacation than you have available ({formatDays(available)}).{" "}
              {p.allowNegative ? "Leadership allows negative balances, so it can still be approved." : "You can still send it, but it can only be approved if your balance allows."}
            </Alert>
          )}
          <SubmitButton size="lg" className="w-full sm:w-auto" disabled={!start || preview.days === 0 || !!blocked} pendingText="Submitting…">
            Submit request{preview.days ? ` · ${formatDays(preview.days)}` : ""}
          </SubmitButton>
        </ActionForm>
      </Card>

      <Card className="h-fit p-5">
        <p className="text-[13px] text-muted">You&apos;re requesting</p>
        <p className={cn("text-4xl font-semibold tracking-tight tabular", kind === "vacation" ? "text-vacation" : "text-lieu")}>
          {formatDays(preview.days, { unit: false })}<span className="ml-1.5 text-base font-normal text-muted">{preview.days === 1 ? "day" : "days"}</span>
        </p>
        {start && preview.days === 0 && <p className="mt-2 text-sm text-warn">No working days in this range.</p>}
        <div className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
          <div className="flex justify-between"><span className="text-muted">Available now</span><span className="tabular">{formatDays(available)}</span></div>
          {!(kind === "lieu" && advance) && <div className="flex justify-between font-medium"><span>After this request</span><span className={cn("tabular", after < 0 && "text-danger")}>{formatDays(after)}</span></div>}
        </div>
        {skippedHolidays.length > 0 && (
          <div className="mt-4 rounded-xl bg-holiday-soft p-3 text-sm text-holiday">
            <p className="font-medium">Holidays not counted</p>
            <ul className="mt-1 text-[13px]">{skippedHolidays.map((h) => <li key={h.date}>{formatDate(h.date, { year: false })} · {h.name}</li>)}</ul>
          </div>
        )}
        <p className="mt-4 text-xs text-muted">Weekends and public holidays are excluded automatically. Pending requests don&apos;t reduce your balance until approved.</p>
      </Card>
    </div>
  );
}
