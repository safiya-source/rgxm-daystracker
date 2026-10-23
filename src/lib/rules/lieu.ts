// Client-side mirror of public.calc_lieu_credit for instant form previews.
// The database function is authoritative; a parity test keeps them in sync.
import { isoWeekday, type ISODate } from "./dates";

export type LieuRules = {
  weekend_half_min_hours: number;
  weekend_half_credit: number;
  weekend_full_min_hours: number;
  weekend_full_credit: number;
  weekday_min_hours: number;
  weekday_credit: number;
  weekday_review_above_hours: number;
};

export const DEFAULT_LIEU_RULES: LieuRules = {
  weekend_half_min_hours: 2,
  weekend_half_credit: 0.5,
  weekend_full_min_hours: 4,
  weekend_full_credit: 1,
  weekday_min_hours: 10,
  weekday_credit: 0.5,
  weekday_review_above_hours: 12,
};

export type LieuCalc = {
  dayType: "weekend" | "weekday" | "holiday";
  credit: number;
  category: "discretionary" | "statutory";
  needsReview: boolean;
  reason?: string;
};

export function calcLieuCredit(
  date: ISODate,
  hours: number,
  rules: LieuRules,
  ctx: { holidays: Set<string>; workingDays: number[] },
): LieuCalc {
  if (ctx.holidays.has(date)) {
    return {
      dayType: "holiday", credit: 1, category: "statutory", needsReview: true,
      reason: "Public holiday worked: statutory entitlement. People Admin to confirm.",
    };
  }
  if (!ctx.workingDays.includes(isoWeekday(date))) {
    const credit = hours >= rules.weekend_full_min_hours ? rules.weekend_full_credit
      : hours >= rules.weekend_half_min_hours ? rules.weekend_half_credit : 0;
    return { dayType: "weekend", credit, category: "discretionary", needsReview: false };
  }
  if (hours > rules.weekday_review_above_hours) {
    return {
      dayType: "weekday", credit: rules.weekday_credit, category: "discretionary", needsReview: true,
      reason: `Over ${rules.weekday_review_above_hours} hours on a workday: leadership review`,
    };
  }
  return {
    dayType: "weekday", credit: hours >= rules.weekday_min_hours ? rules.weekday_credit : 0,
    category: "discretionary", needsReview: false,
  };
}
