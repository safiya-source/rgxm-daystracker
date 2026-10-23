import { addDays, isoWeekday, type ISODate } from "./dates";

/** Working days in a range (mirror of public.leave_days for previews). */
export function countLeaveDays(
  start: ISODate, end: ISODate, portion: "full" | "am" | "pm",
  ctx: { holidays: Set<string>; workingDays: number[] },
): { days: number; dates: ISODate[] } {
  if (!start || !end || end < start) return { days: 0, dates: [] };
  if (portion !== "full" && start !== end) return { days: 0, dates: [] };
  const dates: ISODate[] = [];
  for (let d = start, i = 0; d <= end && i <= 366; d = addDays(d, 1), i++) {
    if (ctx.workingDays.includes(isoWeekday(d)) && !ctx.holidays.has(d)) dates.push(d);
  }
  return { days: dates.length * (portion === "full" ? 1 : 0.5), dates };
}

/** Ontario ESA minimum vacation: 2 weeks under 5 years of service, 3 weeks at 5+. */
export function statutoryMinimumDays(yearsOfService: number): number {
  return yearsOfService >= 5 ? 15 : 10;
}
