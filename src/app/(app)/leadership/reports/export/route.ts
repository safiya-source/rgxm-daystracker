import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { LIEU_COLUMNS, PROJECT_COLUMNS, VACATION_COLUMNS, loadReport } from "@/lib/reports";

export async function GET(req: NextRequest) {
  const me = await getProfile();
  if (!me || me.role !== "people_admin") return new NextResponse("Forbidden", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type") ?? "vacation";
  const rows = await loadReport(type, { from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined, project: sp.get("project") ?? undefined });
  const cols = type === "lieu" ? LIEU_COLUMNS : type === "project" ? PROJECT_COLUMNS : VACATION_COLUMNS;
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
  return new NextResponse("﻿" + toCsv(rows as Record<string, unknown>[], cols), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="rgxm-${type}-report-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
