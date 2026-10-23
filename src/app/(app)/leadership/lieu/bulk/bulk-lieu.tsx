"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, X, Check } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, LinkButton, Select } from "@/components/ui";
import { calcLieuCredit, type LieuRules } from "@/lib/rules/lieu";
import { addDays, formatDate, isoWeekday } from "@/lib/rules/dates";
import { cn, formatDays } from "@/lib/format";
import { commitBulk, createProject, previewBulk, type BulkPreviewRow } from "../../actions";

type Person = { id: string; full_name: string; job_title: string | null };

export function BulkLieu({ people, projects: initialProjects, rules, holidays, workingDays, today }: {
  people: Person[]; projects: { id: string; name: string }[]; rules: LieuRules; holidays: string[]; workingDays: number[]; today: string;
}) {
  const [projects, setProjects] = useState(initialProjects);
  const [project, setProject] = useState("");
  const [newName, setNewName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [dates, setDates] = useState<string[]>(() => { let d = today; while (isoWeekday(d) !== 6) d = addDays(d, -1); return [d, addDays(d, 1)]; });
  const [hours, setHours] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<BulkPreviewRow[] | null>(null);
  const [result, setResult] = useState<{ employee_id: string; status: string; total: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ctx = useMemo(() => ({ holidays: new Set(holidays), workingDays }), [holidays, workingDays]);
  const name = (id: string) => people.find((p) => p.id === id)?.full_name ?? "";
  const key = (e: string, d: string) => `${e}|${d}`;

  const rows = selected.flatMap((e) => dates.filter(Boolean).map((d) => ({ employee_id: e, work_date: d, hours: Number(hours[key(e, d)] || 0) }))).filter((r) => r.hours > 0);
  const credit = (e: string, d: string) => {
    const h = Number(hours[key(e, d)] || 0);
    return h > 0 && d ? calcLieuCredit(d, h, rules, ctx) : null;
  };
  const totalFor = (e: string) => dates.reduce((s, d) => s + (credit(e, d)?.credit ?? 0), 0);
  const invalidate = () => { setPreview(null); setError(null); };

  const review = () => start(async () => {
    setError(null);
    let pid = project;
    if (project === "__new") {
      const r = await createProject(newName);
      if (r.error || !r.id) return setError(r.error ?? "Couldn't create project");
      pid = r.id; setProjects((ps) => [{ id: r.id!, name: newName }, ...ps]); setProject(r.id);
    }
    const res = await previewBulk(pid, rows);
    if (res.error) return setError(res.error);
    setPreview(res.rows);
  });
  const commit = () => start(async () => {
    const res = await commitBulk(project, rows, note);
    if (res.error) return setError(res.error);
    setResult(res.result);
  });

  if (result) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-full bg-ok-soft text-ok"><Check className="size-5" /></span>
          <h2 className="text-lg font-semibold">Lieu credits saved</h2></div>
        <ul className="mt-4 divide-y divide-line text-sm">
          {result.map((r) => (
            <li key={r.employee_id} className="flex justify-between py-2.5">
              <span>{name(r.employee_id)}</span>
              <span className="flex items-center gap-2 tabular">{formatDays(r.total)}<Badge tone={r.status === "approved" ? "ok" : "warn"}>{r.status === "approved" ? "Credited" : "Waiting for review"}</Badge></span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">Flagged days (public holidays, very long workdays) and your own credits wait in Lieu Approvals for a second look.</p>
        <div className="mt-5 flex gap-2"><LinkButton href="/leadership/lieu">Go to Lieu Approvals</LinkButton><Button variant="secondary" onClick={() => location.reload()}>Enter another project</Button></div>
      </Card>
    );
  }

  const conflicts = preview?.filter((r) => r.conflict) ?? [];
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="1 · Project">
            <Select value={project} onChange={(e) => { setProject(e.target.value); invalidate(); }}>
              <option value="" disabled>Choose a project…</option>
              <option value="__new">+ New project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          {project === "__new" && <Field label="New project name"><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Client – Activation" /></Field>}
        </div>
        <div className="mt-5">
          <p className="mb-2 text-[13px] font-medium text-ink-soft">2 · Who worked?</p>
          <div className="flex flex-wrap gap-2">
            {people.map((p) => {
              const on = selected.includes(p.id);
              return (
                <button key={p.id} type="button" onClick={() => { setSelected((s) => (on ? s.filter((x) => x !== p.id) : [...s, p.id])); invalidate(); }}
                  className={cn("rounded-full border px-3 py-1.5 text-sm transition", on ? "border-ink bg-ink text-white" : "border-line-strong hover:bg-canvas")}>
                  {p.full_name}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {selected.length > 0 && (
        <Card>
          <CardHeader title="3 · Dates and hours" subtitle="Leave a cell empty if they didn't work that day. Credits are calculated per day." />
          <div className="overflow-x-auto px-5 pb-5">
            <table className="text-sm">
              <thead>
                <tr>
                  <th className="pb-2 pr-3 text-left font-medium text-muted">Employee</th>
                  {dates.map((d, i) => (
                    <th key={i} className="px-1 pb-2 align-bottom">
                      <div className="flex items-center gap-1">
                        <Input type="date" value={d} max={today} onChange={(e) => { setDates((ds) => ds.map((x, j) => (j === i ? e.target.value : x))); invalidate(); }} className="h-8 w-[150px] text-sm" />
                        {dates.length > 1 && <button type="button" onClick={() => { setDates((ds) => ds.filter((_, j) => j !== i)); invalidate(); }} className="text-muted hover:text-danger" aria-label="Remove date"><X className="size-4" /></button>}
                      </div>
                      <p className="mt-0.5 text-left text-[11px] font-normal text-muted">{d && formatDate(d, { weekday: true, year: false })}</p>
                    </th>
                  ))}
                  <th className="px-2 pb-2"><button type="button" onClick={() => setDates((ds) => [...ds, ds[ds.length - 1] && addDays(ds[ds.length - 1], 1) <= today ? addDays(ds[ds.length - 1], 1) : ""])} className="inline-flex items-center gap-1 text-sm font-medium text-lieu"><Plus className="size-4" />Date</button></th>
                  <th className="pb-2 pl-3 text-right font-medium text-muted">Proposed</th>
                </tr>
              </thead>
              <tbody>
                {selected.map((e) => (
                  <tr key={e} className="border-t border-line">
                    <td className="py-2 pr-3 font-medium whitespace-nowrap">{name(e)}</td>
                    {dates.map((d, i) => {
                      const c = credit(e, d);
                      return (
                        <td key={i} className="px-1 py-2">
                          <div className="flex items-center gap-2">
                            <Input type="number" min={0} max={24} step={0.25} inputMode="decimal" placeholder="hrs" value={hours[key(e, d)] ?? ""}
                              onChange={(ev) => { setHours((h) => ({ ...h, [key(e, d)]: ev.target.value })); invalidate(); }} className="h-8 w-20 text-sm" />
                            <span className={cn("w-10 text-xs tabular", c?.needsReview ? "text-warn" : "text-lieu")}>{c ? formatDays(c.credit, { unit: false }) + (c.needsReview ? "*" : "") : ""}</span>
                          </div>
                        </td>
                      );
                    })}
                    <td />
                    <td className="py-2 pl-3 text-right font-semibold tabular text-lieu">{formatDays(totalFor(e))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">* Needs review (public holiday or over {rules.weekday_review_above_hours} hours on a workday). Saved as pending.</p>
          </div>
          <div className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional), e.g. weekend activation" className="sm:max-w-sm" />
            <div className="flex-1" />
            {!preview ? (
              <Button onClick={review} disabled={pending || !rows.length || !project || (project === "__new" && !newName)}>{pending ? "Checking…" : "4 · Review credits"}</Button>
            ) : (
              <Button variant="success" onClick={commit} disabled={pending || conflicts.length > 0}>{pending ? "Saving…" : `5 · Approve ${formatDays(rows.reduce((s, r) => s + (credit(r.employee_id, r.work_date)?.credit ?? 0), 0))}`}</Button>
            )}
          </div>
          {error && <Alert tone="danger" className="mx-5 mb-5">{error}</Alert>}
          {conflicts.length > 0 && (
            <Alert tone="danger" className="mx-5 mb-5">
              Already credited: {conflicts.map((c) => `${c.full_name} on ${formatDate(c.work_date, { year: false })}`).join(", ")}. Remove those hours to continue.
            </Alert>
          )}
          {preview && !conflicts.length && <Alert tone="ok" className="mx-5 mb-5">No duplicates found. Ready to approve {preview.length} day(s) of work.</Alert>}
        </Card>
      )}
    </div>
  );
}
