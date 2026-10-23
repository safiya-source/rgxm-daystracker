import { Sidebar, type NavItem } from "@/components/sidebar";
import { isLeader, requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/format";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireProfile();
  const supabase = await createClient();
  const leader = await isLeader(me);
  const admin = me.role === "people_admin";

  const [{ count: unread }, queue] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    leader ? supabase.rpc("approval_queue_counts").single() : Promise.resolve({ data: null }),
  ]);
  const q = queue.data as { pending_vacation: number; pending_lieu_submissions: number; pending_lieu_usage: number } | null;

  const personal: NavItem[] = [
    { href: "/dashboard", label: "My Dashboard", icon: "Home" },
    { href: "/time-off", label: "My Time Off", icon: "Plane", exact: true },
    { href: "/time-off/request", label: "Request Time Off", icon: "PlusCircle" },
    { href: "/lieu/new", label: "Add Lieu Time", icon: "Clock" },
    { href: "/calendar", label: "Team Calendar", icon: "CalendarDays" },
    { href: "/profile", label: "My Profile", icon: "User" },
  ];
  const leadership: NavItem[] = !leader ? [] : [
    { href: "/leadership", label: "Overview", icon: "LayoutDashboard", exact: true },
    ...(admin ? [{ href: "/leadership/employees", label: "Employees", icon: "Users" } as NavItem] : []),
    { href: "/leadership/requests", label: "Time-Off Requests", icon: "ClipboardCheck", badge: Number(q?.pending_vacation ?? 0) + Number(q?.pending_lieu_usage ?? 0) },
    { href: "/leadership/lieu", label: "Lieu Approvals", icon: "Sparkles", badge: Number(q?.pending_lieu_submissions ?? 0) },
    ...(admin ? [
      { href: "/leadership/reports", label: "Reports", icon: "FileBarChart" } as NavItem,
      { href: "/leadership/settings", label: "Settings", icon: "Settings" } as NavItem,
    ] : []),
  ];

  return (
    <div className="min-h-dvh">
      <Sidebar personal={personal} leadership={leadership} name={me.full_name} roleLabel={ROLE_LABEL[me.role]} unread={unread ?? 0} />
      <main className="lg:pl-[272px]">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</div>
      </main>
    </div>
  );
}
