"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, Info } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { calcLieuCredit, type LieuRules } from "@/lib/rules/lieu";
import { addDays, formatDate, isoWeekday } from "@/lib/rules/dates";
import { formatDays } from "@/lib/format";
import { submitLieu } from "../../time-off/actions";

type Row = { key: number; date: string; hours: string };

export function LieuForm({ today, rules, holidays, workingDays, projects, existing }: {
  today: string; rules: LieuRules; holidays: string[]; workingDays: number[];
  projects: { id: string; name: string }[];
  existing: { id: string; project_id: string; entries: { work_date: string; hours: number }[] } | null;
}) {
  const [project, setProject] = useState(existing?.project_id ?? (projects.length ? "" : "__new"));
  const [rows, setRows] = useState<Row[]>(
    existing?.entries.map((e, i) => ({ key: i, date: e.work_date, hours: String(e.hours) })) ?? [{ key: 0, date: lastWeekend(today), hours: "" }],
  );
  const [showNote, setShowNote] = useState(false);
  const ctx = useMemo(() => ({ holidays: new Set(holidays), workingDays }), [holidays, workingDays]);

  const calcs = rows.map((r) => (r.date && Number(r.hours) > 0 ? calcLieuCredit(r.date, Number(r.hours), rules, ctx) : null));
  const total = calcs.reduce((s, c) => s + (c?.credit ?? 0), 0);
  const dupDates = new Set(rows.map((r) => r.date).filter((d, i, a) => d && a.indexOf(d) !== i));
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => {
    const last = rows[rows.length - 1]?.date;
    setRows((rs) => [...rs, { key: Date.now(), date: last && addDays(last, 1) <= today ? addDays(last, 1) : "", hours: "" }]);
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card className="min-w-0 p-5 sm:p-6">
        <ActionForm action={submitLieu} className="space-y-5">
          {existing && <input type="hidden" name="resubmit_id" value={existing.id} />}
          <Field label="1 · Project">
            <Select name="project_id" value={project} onChange={(e) => setProject(e.target.value)} required autoFocus={!existing}>
              <option value="" disabled>Choose a project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="__new">+ New project…</option>
            </Select>
          </Field>
          {project === "__new" && (
            <Field label="New project name" hint="e.g. Taco Bell – Diablo Maple">
              <Input name="new_project" required maxLength={120} placeholder="Client – Activation" />
            </Field>
          )}

          <div>
            <div className="mb-1.5 grid grid-cols-[minmax(0,1fr)_84px_52px_32px] gap-2 text-[13px] font-medium text-ink-soft sm:grid-cols-[minmax(0,1fr)_110px_110px_36px]">
              <span>2 · Date worked</span><span>3 · Hours</span><span className="text-right">Lieu</span><span />
            </div>
            <div className="space-y-2">
              {rows.map((r, i) => {
                const c = calcs[i];
                const weekend = r.date && !workingDays.includes(isoWeekday(r.date));
                return (
                  <div key={r.key}>
                    <div className="grid grid-cols-[minmax(0,1fr)_84px_52px_32px] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_110px_110px_36px]">
                      <Input type="date" name="work_date" value={r.date} max={today} required onChange={(e) => update(r.key, { date: e.target.value })}
                        className={dupDates.has(r.date) ? "border-danger" : ""} />
                      <Input type="number" name="hours" inputMode="decimal" min={0.25} max={24} step={0.25} placeholder="hrs" required
                        value={r.hours} onChange={(e) => update(r.key, { hours: e.target.value })} />
                      <div className="text-right">
                        <span className="text-[15px] font-semibold tabular text-lieu">{c ? formatDays(c.credit, { unit: false }) : "—"}</span>
                        {c && <span className="block text-[11px] text-muted">{c.dayType === "holiday" ? "holiday" : weekend ? "weekend" : "weekday"}</span>}
                      </div>
                      <button type="button" aria-label="Remove date" disabled={rows.length === 1}
                        onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                        className="grid size-8 place-items-center rounded-lg text-muted hover:bg-black/5 hover:text-danger disabled:opacity-30">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    {r.date && <p className="mt-0.5 text-xs text-muted">{formatDate(r.date, { weekday: true })}{c?.needsReview && <span className="ml-2 text-warn">· {c.reason}</span>}</p>}
                    {dupDates.has(r.date) && <p className="text-xs text-danger">This date is listed twice.</p>}
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={addRow} className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-lieu hover:bg-lieu-soft">
              <Plus className="size-4" /> Add another date
            </button>
          </div>

          {showNote ? (
            <Field label="Note (optional)"><Textarea name="note" rows={2} maxLength={500} /></Field>
          ) : (
            <button type="button" onClick={() => setShowNote(true)} className="text-sm text-muted hover:text-ink">+ Add a note</button>
          )}

          <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[15px]">Total proposed lieu: <span className="text-xl font-semibold tabular text-lieu">{formatDays(total)}</span></p>
            <SubmitButton size="lg" disabled={!project || dupDates.size > 0} pendingText="Submitting…">
              {existing ? "Resubmit for approval" : "Submit for approval"}
            </SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card className="h-fit p-5 text-sm">
        <p className="flex items-center gap-2 font-medium"><Info className="size-4 text-lieu" /> How lieu is calculated</p>
        <div className="mt-3 space-y-3 text-ink-soft">
          <div>
            <p className="font-medium text-ink">Weekend days</p>
            <ul className="mt-1 space-y-0.5 text-[13px]">
              <li className="flex justify-between"><span>Under {rules.weekend_half_min_hours} hrs</span><Badge>0</Badge></li>
              <li className="flex justify-between"><span>{rules.weekend_half_min_hours} to under {rules.weekend_full_min_hours} hrs</span><Badge tone="lieu">{rules.weekend_half_credit}</Badge></li>
              <li className="flex justify-between"><span>{rules.weekend_full_min_hours}+ hrs</span><Badge tone="lieu">{rules.weekend_full_credit}</Badge></li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-ink">Extended workdays (total hours)</p>
            <ul className="mt-1 space-y-0.5 text-[13px]">
              <li className="flex justify-between"><span>Under {rules.weekday_min_hours} hrs</span><Badge>0</Badge></li>
              <li className="flex justify-between"><span>{rules.weekday_min_hours}–{rules.weekday_review_above_hours} hrs</span><Badge tone="lieu">{rules.weekday_credit}</Badge></li>
              <li className="flex justify-between"><span>Over {rules.weekday_review_above_hours} hrs</span><Badge tone="warn">review</Badge></li>
            </ul>
          </div>
          <p className="text-xs text-muted">Each date is calculated on its own. Public holidays go to a People Admin as statutory time. These are RGXM&apos;s internal guidelines, not a statutory overtime calculation.</p>
        </div>
      </Card>
    </div>
  );
}

function lastWeekend(today: string) {
  // Default the first row to the most recent Saturday (common case: weekend activation).
  let d = today;
  for (let i = 0; i < 7 && isoWeekday(d) !== 6; i++) d = addDays(d, -1);
  return d;
}
