// Pure date helpers on ISO "YYYY-MM-DD" strings (no time zones involved).
// Mirrors the SQL functions anniversary_in_year / next_anniversary / years_of_service.

export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (y: number, m: number, d: number): ISODate => `${y}-${pad(m)}-${pad(d)}`;
export const parts = (d: ISODate) => d.split("-").map(Number) as [number, number, number];

export const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Today's date in the agency time zone. */
export function todayIn(timeZone = "America/Toronto"): ISODate {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDays(d: ISODate, n: number): ISODate {
  const [y, m, dd] = parts(d);
  const t = new Date(Date.UTC(y, m - 1, dd + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function diffDays(a: ISODate, b: ISODate): number {
  const [y1, m1, d1] = parts(a);
  const [y2, m2, d2] = parts(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(d: ISODate): number {
  const [y, m, dd] = parts(d);
  const w = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Anniversary of `start` in `year`; Feb 29 starts fall on Feb 28 in common years. */
export function anniversaryInYear(start: ISODate, year: number): ISODate {
  const [, m, d] = parts(start);
  if (m === 2 && d === 29 && !isLeapYear(year)) return iso(year, 2, 28);
  return iso(year, m, d);
}

/** Next work anniversary on or after `asOf` (first one is a year after the start date). */
export function nextAnniversary(start: ISODate, asOf: ISODate): ISODate {
  const year = Math.max(parts(asOf)[0], parts(start)[0] + 1);
  const a = anniversaryInYear(start, year);
  return a >= asOf ? a : anniversaryInYear(start, year + 1);
}

export function yearsOfService(start: ISODate, asOf: ISODate): number {
  if (asOf < start) return 0;
  const y = parts(asOf)[0];
  return y - parts(start)[0] - (anniversaryInYear(start, y) > asOf ? 1 : 0);
}

/** Completed months of service; a month-end date completes a month that started on a later day (e.g. Jan 31 → Feb 28). */
export function monthsOfService(start: ISODate, asOf: ISODate): number {
  if (asOf < start) return 0;
  const [y1, m1, d1] = parts(start);
  const [y2, m2, d2] = parts(asOf);
  const isMonthEnd = d2 === daysInMonth(y2, m2);
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 && !isMonthEnd ? 1 : 0);
}

export function tenure(start: ISODate, asOf: ISODate) {
  const months = monthsOfService(start, asOf);
  return { years: Math.floor(months / 12), months: months % 12 };
}

export function formatTenure(start: ISODate, asOf: ISODate): string {
  if (asOf < start) return "Starts " + formatDate(start);
  const { years, months } = tenure(start, asOf);
  const y = years ? `${years} year${years === 1 ? "" : "s"}` : "";
  const m = months || !years ? `${months} month${months === 1 ? "" : "s"}` : "";
  return [y, m].filter(Boolean).join(", ");
}

export function anniversaryInfo(start: ISODate, asOf: ISODate) {
  const next = nextAnniversary(start, asOf);
  return { date: next, years: yearsOfService(start, next), daysUntil: diffDays(asOf, next) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function formatDate(d: ISODate | null | undefined, opts: { weekday?: boolean; year?: boolean; long?: boolean } = {}): string {
  if (!d) return "—";
  const [y, m, dd] = parts(d);
  const month = (opts.long ? MONTHS_LONG : MONTHS)[m - 1];
  const wd = opts.weekday ? DAYS[isoWeekday(d) - 1] + ", " : "";
  return `${wd}${month} ${dd}${opts.year === false ? "" : `, ${y}`}`;
}

export function formatRange(a: ISODate, b: ISODate): string {
  if (a === b) return formatDate(a, { weekday: true });
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  return `${formatDate(a, { year: !sameYear })} – ${formatDate(b)}`;
}

export const monthName = (m: number) => MONTHS_LONG[m - 1];
