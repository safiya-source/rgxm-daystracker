import { Palmtree, Sparkles } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";
import { formatDays } from "@/lib/format";
import { formatDate } from "@/lib/rules/dates";
import type { LieuBalance, VacationBalance } from "@/lib/data";

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className={strong ? "font-semibold tabular" : "tabular"}>{value}</span>
    </div>
  );
}

function Meter({ used, booked, total, color }: { used: number; booked: number; total: number; color: string }) {
  const t = Math.max(total, used + booked, 0.0001);
  return (
    <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-black/[0.06]" aria-hidden>
      <div className={color} style={{ width: `${(used / t) * 100}%` }} />
      <div className={color + " opacity-40"} style={{ width: `${(booked / t) * 100}%` }} />
    </div>
  );
}

export function VacationCard({ b, title = "Vacation" }: { b: VacationBalance | null; title?: string }) {
  if (!b || b.annual_entitlement == null) {
    return (
      <Card>
        <CardHeader title={title} icon={<Palmtree className="size-5 text-vacation" />} />
        <p className="px-5 pb-5 text-sm text-muted">No vacation entitlement has been set up yet.</p>
      </Card>
    );
  }
  const totalForYear = Number(b.carried_forward) + Number(b.opening) + Number(b.earned) + Number(b.adjustments);
  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={`${formatDate(b.period_start, { year: false })} – ${formatDate(b.period_end)} · ${b.allocation_method === "accrual" ? "accrues monthly" : "allocated upfront"}`}
        icon={<span className="grid size-9 place-items-center rounded-xl bg-vacation-soft"><Palmtree className="size-[18px] text-vacation" /></span>}
      />
      <div className="px-5 pb-5">
        <div className="flex items-end gap-2">
          <span className="text-4xl font-semibold tracking-tight tabular text-vacation">{formatDays(b.available, { unit: false })}</span>
          <span className="pb-1 text-sm text-muted">days available</span>
        </div>
        <Meter used={Number(b.used)} booked={Number(b.booked)} total={totalForYear} color="bg-vacation" />
        <div className="mt-3 divide-y divide-line">
          <Row label="Annual entitlement" value={formatDays(b.annual_entitlement)} />
          {Number(b.carried_forward) !== 0 && <Row label="Carried forward" value={formatDays(b.carried_forward)} />}
          <Row label="Used this year" value={formatDays(b.used)} />
          <Row label="Booked (approved, upcoming)" value={formatDays(b.booked)} />
          {Number(b.pending) > 0 && <Row label="Pending approval" value={formatDays(b.pending)} />}
          {Number(b.pending) > 0 && <Row label="Available after pending" value={formatDays(b.available_after_pending)} strong />}
        </div>
      </div>
    </Card>
  );
}

export function LieuCard({ disc, stat }: { disc?: LieuBalance; stat?: LieuBalance }) {
  const showStat = stat && (Number(stat.earned) || Number(stat.available) || Number(stat.pending_credits));
  return (
    <Card>
      <CardHeader
        title="Lieu time"
        subtitle="Earned from weekend & extended days"
        icon={<span className="grid size-9 place-items-center rounded-xl bg-lieu-soft"><Sparkles className="size-[18px] text-lieu" /></span>}
      />
      <div className="px-5 pb-5">
        <div className="flex items-end gap-2">
          <span className="text-4xl font-semibold tracking-tight tabular text-lieu">{formatDays(disc?.available, { unit: false })}</span>
          <span className="pb-1 text-sm text-muted">days available</span>
        </div>
        <Meter used={Number(disc?.used ?? 0)} booked={Number(disc?.booked ?? 0)} total={Number(disc?.earned ?? 0) + Math.max(0, Number(disc?.adjustments ?? 0))} color="bg-lieu" />
        <div className="mt-3 divide-y divide-line">
          <Row label="Total earned" value={formatDays(disc?.earned)} />
          <Row label="Total used" value={formatDays(Number(disc?.used ?? 0) + Number(disc?.booked ?? 0))} />
          {Number(disc?.adjustments ?? 0) !== 0 && <Row label="Adjustments" value={formatDays(disc?.adjustments, { sign: true })} />}
          <Row label="Pending credits" value={formatDays(disc?.pending_credits)} />
          {Number(disc?.pending_usage ?? 0) > 0 && <Row label="Pending time-off requests" value={formatDays(disc?.pending_usage)} />}
          {showStat ? <Row label="Statutory (public holiday) time" value={`${formatDays(stat!.available)} available`} strong /> : null}
        </div>
      </div>
    </Card>
  );
}
