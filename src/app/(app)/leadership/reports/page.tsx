import Link from "next/link";
import { Download } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getProjects } from "@/lib/data";
import { LIEU_COLUMNS, PROJECT_COLUMNS, VACATION_COLUMNS, loadReport } from "@/lib/reports";
import { Button, Card, Empty, Input, PageHeader, Select, StatusBadge, Table, buttonClass, td, th } from "@/components/ui";
import { formatDate } from "@/lib/rules/dates";
import { cn, formatDays } from "@/lib/format";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string; from?: string; to?: string; project?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const tab = sp.tab === "lieu" || sp.tab === "project" ? sp.tab : "vacation";
  const projects = await getProjects();
  const rows = (await loadReport(tab, sp)) as Record<string, unknown>[];
  const cols = tab === "lieu" ? LIEU_COLUMNS : tab === "project" ? PROJECT_COLUMNS : VACATION_COLUMNS;
  const qs = new URLSearchParams({ type: tab, ...(sp.from && { from: sp.from }), ...(sp.to && { to: sp.to }), ...(sp.project && { project: sp.project }) });
  const fmt = (k: string, v: unknown) => {
    if (v == null) return "—";
    if (k === "status") return <StatusBadge status={String(v)} />;
    if (/date|period_/.test(k)) return formatDate(String(v));
    if (typeof v === "number" && k !== "hours") return formatDays(v, { unit: false });
    return String(v);
  };
  const totals = tab === "project" ? rows.reduce((s, r) => s + Number(r.approved_credit ?? 0), 0) : null;

  return (
    <>
      <PageHeader title="Reports" subtitle="People Admin only. Export to CSV for payroll or year-end."
        action={<a href={`/leadership/reports/export?${qs}`} className={buttonClass("primary")}><Download className="size-4" /> Export CSV</a>} />
      <div className="mb-4 flex gap-1 rounded-2xl bg-black/[0.04] p-1 sm:w-fit">
        {[["vacation", "Vacation"], ["lieu", "Lieu"], ["project", "Project"]].map(([k, l]) => (
          <Link key={k} href={`/leadership/reports?tab=${k}`} className={cn("flex-1 rounded-xl px-4 py-1.5 text-center text-sm", tab === k ? "bg-surface font-medium shadow-card" : "text-muted hover:text-ink")}>{l}</Link>
        ))}
      </div>
      {tab !== "vacation" && (
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value={tab} />
          {tab === "project" ? (
            <Select name="project" defaultValue={sp.project ?? ""} className="w-72"><option value="" disabled>Choose a project…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          ) : (<>
            <label className="text-sm text-muted">From <Input type="date" name="from" defaultValue={sp.from} className="mt-1 w-44" /></label>
            <label className="text-sm text-muted">To <Input type="date" name="to" defaultValue={sp.to} className="mt-1 w-44" /></label>
          </>)}
          <Button variant="secondary">Apply</Button>
        </form>
      )}
      <Card>
        {rows.length ? (
          <Table>
            <thead><tr>{cols.map((c) => <th key={c.key} className={th}>{c.label}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.key} className={cn(td, "whitespace-nowrap tabular", c.key === "full_name" && "font-medium")}>{fmt(c.key, r[c.key])}</td>)}</tr>)}</tbody>
            {totals != null && <tfoot><tr><td className={td + " font-semibold"} colSpan={5}>Total approved lieu ({new Set(rows.map((r) => r.employee_id)).size} people)</td><td className={td + " font-semibold tabular text-lieu"}>{formatDays(totals)}</td><td className={td} /></tr></tfoot>}
          </Table>
        ) : <Empty title={tab === "project" && !sp.project ? "Choose a project" : "No data for this report"} />}
      </Card>
    </>
  );
}
