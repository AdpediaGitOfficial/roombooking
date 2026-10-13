// Facility configuration shapes stored as JSON on Facility (FAC-01, FAC-05).
import { DAY_KEYS, type DayKey } from "../../lib/time";

export type DayHours = { open: string; close: string } | null;
export type OpeningHours = Record<DayKey, DayHours>;

export type BookingRules = {
  slotMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  advanceDays: number;
  bufferMinutes: number;
  cancellationCutoffMinutes: number;
  maxActivePerUser: number;
  maxPerDayPerUser: number;
};

export const DEFAULT_RULES: BookingRules = {
  slotMinutes: 30,
  minDurationMinutes: 30,
  maxDurationMinutes: 120,
  advanceDays: 14,
  bufferMinutes: 0,
  cancellationCutoffMinutes: 60,
  maxActivePerUser: 3,
  maxPerDayPerUser: 1,
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseOpeningHours(raw: unknown): OpeningHours {
  const obj = (raw ?? {}) as Record<string, unknown>;
  // Legacy seed shape: { mon_sun: ["06:00", "22:00"] }
  const legacy = Array.isArray(obj.mon_sun) ? { open: String(obj.mon_sun[0]), close: String(obj.mon_sun[1]) } : null;
  const out = {} as OpeningHours;
  for (const day of DAY_KEYS) {
    const v = obj[day];
    if (v === null) { out[day] = null; continue; }
    if (v && typeof v === "object" && TIME.test(String((v as DayHours)?.open)) && TIME.test(String((v as DayHours)?.close))) {
      out[day] = { open: String((v as { open: string }).open), close: String((v as { close: string }).close) };
    } else {
      out[day] = legacy ?? { open: "06:00", close: "22:00" };
    }
  }
  return out;
}

export function parseRules(raw: unknown): BookingRules {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const num = (key: keyof BookingRules) => {
    const v = Number(obj[key]);
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_RULES[key];
  };
  const rules: BookingRules = {
    slotMinutes: Math.max(5, num("slotMinutes")),
    minDurationMinutes: num("minDurationMinutes"),
    maxDurationMinutes: num("maxDurationMinutes"),
    advanceDays: num("advanceDays"),
    bufferMinutes: num("bufferMinutes"),
    cancellationCutoffMinutes: num("cancellationCutoffMinutes"),
    maxActivePerUser: num("maxActivePerUser"),
    maxPerDayPerUser: num("maxPerDayPerUser"),
  };
  if (rules.minDurationMinutes > rules.maxDurationMinutes) rules.minDurationMinutes = rules.maxDurationMinutes;
  return rules;
}

export function validateRulesInput(raw: Record<string, string>): { rules: BookingRules; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const parsed: Record<string, number> = {};
  for (const key of Object.keys(DEFAULT_RULES) as (keyof BookingRules)[]) {
    const v = raw[key];
    if (v === undefined || v === "") { parsed[key] = DEFAULT_RULES[key]; continue; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) errors[key] = "Enter a whole number of zero or more.";
    else parsed[key] = n;
  }
  if (parsed.slotMinutes !== undefined && parsed.slotMinutes < 5) errors.slotMinutes = "Slots must be at least 5 minutes.";
  if (parsed.minDurationMinutes > parsed.maxDurationMinutes) errors.maxDurationMinutes = "Maximum must be at least the minimum.";
  return { rules: parseRules(parsed), errors };
}

export function validateHoursInput(raw: Record<string, string>): { hours: OpeningHours; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const hours = {} as OpeningHours;
  for (const day of DAY_KEYS) {
    if (raw[`${day}_closed`] === "on") { hours[day] = null; continue; }
    const open = raw[`${day}_open`] ?? "";
    const close = raw[`${day}_close`] ?? "";
    if (!TIME.test(open) || !TIME.test(close)) errors[day] = "Enter opening and closing times as HH:MM.";
    else if (close <= open) errors[day] = "Closing time must be after opening time.";
    else hours[day] = { open, close };
  }
  return { hours, errors };
}

export function describeHours(hours: OpeningHours): string {
  const groups: string[] = [];
  let i = 0;
  while (i < DAY_KEYS.length) {
    const d = DAY_KEYS[i];
    const label = (h: DayHours) => (h ? `${h.open}–${h.close}` : "closed");
    let j = i;
    while (j + 1 < DAY_KEYS.length && label(hours[DAY_KEYS[j + 1]]) === label(hours[d])) j++;
    groups.push(`${i === j ? cap(d) : `${cap(d)}–${cap(DAY_KEYS[j])}`} ${label(hours[d])}`);
    i = j + 1;
  }
  return groups.join(", ");
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
