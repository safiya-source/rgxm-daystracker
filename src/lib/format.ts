export function formatDays(n: number | null | undefined, opts: { sign?: boolean; unit?: boolean } = {}): string {
  const v = Number(n ?? 0);
  const rounded = Math.round(v * 100) / 100;
  const s = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "");
  const signed = opts.sign && rounded > 0 ? "+" + s : s;
  if (opts.unit === false) return signed;
  return `${signed} ${Math.abs(rounded) === 1 ? "day" : "days"}`;
}

export const ROLE_LABEL = { employee: "Employee", manager: "Manager", people_admin: "People Admin" } as const;

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function errorMessage(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  return msg.replace(/^.*?ERROR:\s*/, "");
}
