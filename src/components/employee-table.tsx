"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { Badge, Input, Select, Table, td, th } from "@/components/ui";
import { formatDate, formatRange, formatTenure } from "@/lib/rules/dates";
import { cn, formatDays, ROLE_LABEL } from "@/lib/format";

export type EmployeeRow = {
  id: string; full_name: string; work_email: string; job_title: string | null; department: string | null; start_date: string;
  status: "active" | "inactive"; role: "employee" | "manager" | "people_admin"; manager_name: string | null;
  annual_days: number | null; vacation_available: number; lieu_available: number;
  next_leave_start: string | null; next_leave_end: string | null; has_login: boolean; invited_at: string | null;
};

type Key = "full_name" | "job_title" | "start_date" | "annual_days" | "vacation_available" | "lieu_available" | "next_leave_start";

export function EmployeeTable({ rows, today, compact }: { rows: EmployeeRow[]; today: string; compact?: boolean }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  const [dept, setDept] = useState("");
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "full_name", dir: 1 });
  const depts = [...new Set(rows.map((r) => r.department).filter(Boolean))] as string[];

  const shown = useMemo(() => {
    const needle = q.toLowerCase();
    return rows
      .filter((r) => (status ? r.status === status : true) && (dept ? r.department === dept : true))
      .filter((r) => !needle || [r.full_name, r.work_email, r.job_title, r.department].some((v) => v?.toLowerCase().includes(needle)))
      .sort((a, b) => {
        const av = a[sort.key] ?? (sort.key === "next_leave_start" ? "9999" : ""), bv = b[sort.key] ?? (sort.key === "next_leave_start" ? "9999" : "");
        return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
      });
  }, [rows, q, status, dept, sort]);

  const H = ({ k, children, right }: { k: Key; children: React.ReactNode; right?: boolean }) => (
    <th className={cn(th, right && "text-right")}>
      <button onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (-s.dir as 1 | -1) : 1 }))} className="inline-flex items-center gap-1 uppercase hover:text-ink">
        {children}{sort.key === k && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );

  return (
    <div>
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, title, email…" className="pl-9" />
        </div>
        {depts.length > 0 && (
          <Select value={dept} onChange={(e) => setDept(e.target.value)} className="sm:w-44">
            <option value="">All departments</option>
            {depts.map((d) => <option key={d}>{d}</option>)}
          </Select>
        )}
        {!compact && (
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-36">
            <option value="active">Active</option><option value="inactive">Inactive</option><option value="">All</option>
          </Select>
        )}
      </div>
      <Table>
        <thead>
          <tr>
            <H k="full_name">Employee</H><H k="job_title">Job title</H><H k="start_date">Start · tenure</H>
            <H k="annual_days" right>Entitlement</H><H k="vacation_available" right>Vacation</H><H k="lieu_available" right>Lieu</H>
            <H k="next_leave_start">Upcoming leave</H>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id} className="group">
              <td className={td}>
                <Link href={`/leadership/employees/${r.id}`} className="font-medium group-hover:text-accent">{r.full_name}</Link>
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  {r.role !== "employee" && <span>{ROLE_LABEL[r.role]}</span>}
                  {r.status === "inactive" && <Badge>Inactive</Badge>}
                  {!r.has_login && r.status === "active" && <Badge tone="warn">{r.invited_at ? "Invited" : "Not invited"}</Badge>}
                </div>
              </td>
              <td className={td + " text-ink-soft"}>{r.job_title ?? "—"}</td>
              <td className={td + " whitespace-nowrap"}>{formatDate(r.start_date)}<div className="text-xs text-muted">{formatTenure(r.start_date, today)}</div></td>
              <td className={td + " text-right tabular"}>{r.annual_days != null ? formatDays(r.annual_days, { unit: false }) : "—"}</td>
              <td className={cn(td, "text-right tabular font-medium", r.vacation_available < 0 ? "text-danger" : "text-vacation")}>{formatDays(r.vacation_available, { unit: false })}</td>
              <td className={cn(td, "text-right tabular font-medium text-lieu")}>{formatDays(r.lieu_available, { unit: false })}</td>
              <td className={td + " whitespace-nowrap text-ink-soft"}>{r.next_leave_start ? formatRange(r.next_leave_start, r.next_leave_end!) : "—"}</td>
            </tr>
          ))}
          {!shown.length && <tr><td colSpan={7} className={td + " py-8 text-center text-muted"}>No matching employees.</td></tr>}
        </tbody>
      </Table>
    </div>
  );
}
