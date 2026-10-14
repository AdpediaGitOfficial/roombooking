// Pure report definitions: date ranges, metric definitions and shared constants.
// No database access, so the web app and the API can both import this file.
import { addDaysIso } from "../../lib/time";

/** Days ahead the dashboard watches for arrivals. */
export const ARRIVAL_WINDOW_DAYS = 14;

export type Range = { from: string; to: string };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function defaultRange(now: Date = new Date(), days = 30): Range {
  const to = now.toISOString().slice(0, 10);
  return { from: addDaysIso(to, -(days - 1)), to };
}

export function parseRange(from?: string | null, to?: string | null, now: Date = new Date()): Range {
  const d = defaultRange(now);
  const f = from && ISO.test(from) ? from : d.from;
  let t = to && ISO.test(to) ? to : d.to;
  if (t < f) t = f;
  return { from: f, to: t };
}

export const DEFINITIONS = {
  movements: [
    "Rows: allocations that overlap the range (start date on or before the last day, end date empty or on or after the first day), optionally narrowed by status.",
    "Arrivals: check-ins recorded within the range. Departures: check-outs recorded within the range. Transfers: allocations in the range that continue an earlier allocation.",
    "Dates are calendar dates in the site's time zone; check-in and check-out times are shown in UTC.",
  ],
  maintenance: [
    "Backlog: tickets open right now (new, triaged, assigned, in progress, waiting, reopened), regardless of the range. Overdue: open tickets past their SLA due time.",
    "Resolution time: hours from creation to the latest resolution, for tickets resolved or closed within the range. Mean and median are over those tickets. SLA met: resolved on or before the SLA due time.",
    "Workload: open tickets per assignee or vendor now, and tickets they resolved within the range.",
    "The range covers midnight to midnight in the selected site's time zone (UTC when all sites are shown).",
  ],
  facilities: [
    "Bookings: bookings starting within the range, by status. Attended: marked used or completed. No-shows: confirmed bookings marked as not used.",
    "Open hours: the facility's opening hours summed over the days in the range. Utilisation: booked person-hours of confirmed, used and completed bookings divided by capacity × open hours.",
    "Days are the facility site's calendar days.",
  ],
  keys: [
    "Register counts are the state of each key right now. Outstanding: keys issued and not yet returned; overdue: outstanding keys past their expected return date.",
    "Transactions: key events recorded within the range (issues, returns, lost, damaged, repairs, replacements, retirements).",
    "The range covers midnight to midnight in the selected site's time zone (UTC when all sites are shown).",
  ],
};
