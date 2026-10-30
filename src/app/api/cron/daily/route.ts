import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Daily job (Vercel Cron or any scheduler): recalculates accruals/rollovers,
// sends reminders, and delivers email notifications if enabled.
// pg_cron already runs the maintenance in Supabase; running it twice is harmless.
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const db = createAdminClient();
  const { error } = await db.rpc("cron_daily_maintenance");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  let emailed = 0;
  const key = process.env.RESEND_API_KEY;
  if (key) {
    const { data: pending } = await db.rpc("pending_email_notifications", { max_rows: 200 });
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
    const sent: string[] = [];
    for (const n of pending ?? []) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM ?? "RGXM Daystracker <people@rgxm.com>",
          to: n.email,
          subject: n.title,
          text: `Hi ${n.full_name.split(" ")[0]},\n\n${n.title}${n.body ? `\n${n.body}` : ""}\n\n${n.link ? site + n.link : site}\n\n— RGXM Daystracker`,
        }),
      });
      if (res.ok) sent.push(n.id);
    }
    if (sent.length) await db.rpc("mark_notifications_emailed", { ids: sent });
    emailed = sent.length;
  }
  return NextResponse.json({ ok: true, emailed });
}
