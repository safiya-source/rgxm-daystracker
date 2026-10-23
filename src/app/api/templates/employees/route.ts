import { NextResponse } from "next/server";

// Template for CSV import of existing employees and balances (fictional example row).
const CSV = [
  "full_name,work_email,job_title,department,start_date,role,manager_email,annual_vacation_days,vacation_year,allocation,balances_as_of,opening_vacation,carryover,opening_lieu",
  "Example Person,example.person@rgxm.com,Producer,Production,2022-03-01,employee,manager@rgxm.com,15,calendar,upfront,2026-11-01,6.5,2,1.5",
].join("\r\n") + "\r\n";

export function GET() {
  return new NextResponse(CSV, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="rgxm-employee-import-template.csv"' } });
}
