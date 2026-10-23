import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageHeader } from "@/components/ui";
import { cn } from "@/lib/format";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(100);
  // Viewing the list marks everything read.
  if (data?.some((n) => !n.read_at)) await supabase.rpc("mark_notifications_read", {});
  return (
    <>
      <PageHeader title="Notifications" subtitle="Updates on your requests, and anything waiting for you." />
      <Card>
        {data?.length ? (
          <ul className="divide-y divide-line">
            {data.map((n) => {
              const inner = (
                <div className="flex gap-3 px-5 py-4">
                  <span className={cn("mt-2 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-[15px]", !n.read_at && "font-medium")}>{n.title}</p>
                    {n.body && <p className="text-sm text-muted">{n.body}</p>}
                    <p className="mt-1 text-xs text-muted">
                      {new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date(n.created_at))}
                    </p>
                  </div>
                </div>
              );
              return <li key={n.id}>{n.link ? <Link href={n.link} className="block hover:bg-canvas/70">{inner}</Link> : inner}</li>;
            })}
          </ul>
        ) : <Empty title="You're all caught up" />}
      </Card>
    </>
  );
}
