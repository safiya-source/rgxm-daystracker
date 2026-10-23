import { Empty } from "@/components/ui";
import { formatDays } from "@/lib/format";

type Row = { occurred_at: string; ledger: string; description: string; amount: number | null };

export function ActivityList({ rows }: { rows: Row[] }) {
  if (!rows.length) return <Empty title="No activity yet" />;
  return (
    <ul className="divide-y divide-line px-5 pb-2">
      {rows.map((r, i) => (
        <li key={i} className="flex items-start justify-between gap-4 py-3 text-sm">
          <div className="flex min-w-0 gap-3">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${r.ledger === "vacation" ? "bg-vacation" : r.ledger === "lieu" ? "bg-lieu" : "bg-line-strong"}`} />
            <div className="min-w-0">
              <p className="text-ink">{r.description}</p>
              <p className="text-xs text-muted">
                {new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date(r.occurred_at))}
              </p>
            </div>
          </div>
          {r.amount != null && (
            <span className={`shrink-0 tabular font-medium ${Number(r.amount) < 0 ? "text-ink-soft" : r.ledger === "lieu" ? "text-lieu" : "text-vacation"}`}>
              {formatDays(r.amount, { sign: true })}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
