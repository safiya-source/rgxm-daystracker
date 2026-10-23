import { Card, CardHeader, Empty } from "@/components/ui";
import { formatDate } from "@/lib/rules/dates";
import { formatDays } from "@/lib/format";

export function Ledger({ title, rows, color }: { title: string; rows: { id: string; txn_type: string; amount: number; effective_date: string; reason: string | null }[]; color: string }) {
  return (
    <Card>
      <CardHeader title={title} subtitle="Every change to your balance, newest first" />
      {rows.length ? (
        <ul className="divide-y divide-line px-5 pb-2 text-sm">
          {rows.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p>{t.reason ?? t.txn_type.replace(/_/g, " ")}</p>
                <p className="text-xs text-muted">{formatDate(t.effective_date)}</p>
              </div>
              <span className={`tabular font-medium ${Number(t.amount) < 0 ? "text-ink-soft" : color}`}>{formatDays(t.amount, { sign: true, unit: false })}</span>
            </li>
          ))}
        </ul>
      ) : <Empty title="No history yet" />}
    </Card>
  );
}
