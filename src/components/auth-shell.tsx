import type { ReactNode } from "react";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div aria-hidden className="bg-silver fixed inset-x-0 top-0 h-[3px]" />
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex items-center gap-2.5">
          <Logo />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[15px] text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="bg-silver grid size-8 place-items-center rounded-[10px] p-px shadow-card">
        <span className="grid size-full place-items-center rounded-[9px] bg-ink text-[11px] font-bold tracking-[0.08em] text-white">RG</span>
      </span>
      {!compact && (
        <span className="flex items-baseline gap-1.5 leading-none">
          <span className="text-[15px] font-bold tracking-[0.18em] text-ink">RGXM</span>
          <span className="text-silver text-[11px] font-semibold uppercase tracking-[0.22em]">People</span>
        </span>
      )}
    </span>
  );
}
