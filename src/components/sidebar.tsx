"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  Bell, CalendarDays, ClipboardCheck, FileBarChart, Home, LayoutDashboard, LogOut, Menu, Plane, PlusCircle,
  Settings, Sparkles, User, Users, X, Clock,
} from "lucide-react";
import { Logo } from "@/components/auth-shell";
import { cn } from "@/lib/format";

const ICONS = { Home, Plane, PlusCircle, Clock, CalendarDays, User, LayoutDashboard, Users, ClipboardCheck, Sparkles, FileBarChart, Settings };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number; exact?: boolean };

export function Sidebar({
  personal, leadership, name, roleLabel, unread,
}: { personal: NavItem[]; leadership: NavItem[]; name: string; roleLabel: string; unread: number }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  const isActive = (i: NavItem) => (i.exact ? path === i.href : path === i.href || path.startsWith(i.href + "/"));
  // Pick the most specific match so /time-off/request doesn't also light up /time-off.
  const all = [...personal, ...leadership];
  const active = all.filter(isActive).sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const link = (i: NavItem) => {
    const Icon = ICONS[i.icon];
    const on = active === i.href;
    return (
      <Link key={i.href} href={i.href}
        className={cn("group flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] transition-colors",
          on ? "bg-ink text-white" : "text-ink-soft hover:bg-black/[0.04]")}>
        <Icon className={cn("size-[18px]", on ? "text-white" : "text-muted group-hover:text-ink-soft")} strokeWidth={1.8} />
        <span className="flex-1">{i.label}</span>
        {!!i.badge && <span className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular", on ? "bg-white/20" : "bg-accent text-white")}>{i.badge}</span>}
      </Link>
    );
  };

  const nav = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
      <div className="px-2"><Logo /></div>
      <div className="space-y-0.5">
        <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Me</p>
        {personal.map(link)}
      </div>
      {leadership.length > 0 && (
        <div className="space-y-0.5">
          <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Leadership</p>
          {leadership.map(link)}
        </div>
      )}
      <div className="mt-auto space-y-1 border-t border-line pt-4">
        <div className="px-3 pb-2">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-xs text-muted">{roleLabel}</p>
        </div>
        <form action="/auth/signout" method="post">
          <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[14px] text-ink-soft hover:bg-black/[0.04]">
            <LogOut className="size-[18px] text-muted" strokeWidth={1.8} /> Sign out
          </button>
        </form>
      </div>
    </nav>
  );

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="-ml-2 rounded-lg p-2 hover:bg-black/5"><Menu className="size-5" /></button>
        <Logo compact />
        <BellLink unread={unread} />
      </header>
      {open && <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={cn("fixed inset-y-0 left-0 z-50 w-[272px] border-r border-line bg-canvas transition-transform lg:translate-x-0",
        open ? "translate-x-0 shadow-pop" : "-translate-x-full")}>
        <button onClick={() => setOpen(false)} aria-label="Close menu" className="absolute right-3 top-4 rounded-lg p-2 hover:bg-black/5 lg:hidden"><X className="size-5" /></button>
        {nav}
      </aside>
      {/* Desktop bell */}
      <div className="fixed right-6 top-5 z-20 hidden lg:block"><BellLink unread={unread} /></div>
    </>
  );
}

function BellLink({ unread }: { unread: number }) {
  return (
    <Link href="/notifications" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
      className="relative grid size-10 place-items-center rounded-xl border border-line bg-surface shadow-card hover:bg-canvas">
      <Bell className="size-[18px]" strokeWidth={1.8} />
      {unread > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-accent px-1 text-center text-[11px] font-semibold leading-5 text-white">{unread > 9 ? "9+" : unread}</span>}
    </Link>
  );
}
