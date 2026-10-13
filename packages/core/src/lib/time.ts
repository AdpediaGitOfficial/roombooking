// Timezone helpers without a library: convert between a site's local wall
// clock and UTC instants using Intl (handles DST correctly).

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: DayKey };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Local wall-clock parts of a UTC instant in the given zone. */
export function zonedParts(instant: Date, timeZone: string): Parts {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(instant).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour) % 24, minute: Number(parts.minute), second: Number(parts.second),
    weekday: parts.weekday.slice(0, 3).toLowerCase() as DayKey,
  };
}

/** "YYYY-MM-DD" and "HH:MM" of an instant in the zone. */
export function zonedDateTime(instant: Date, timeZone: string): { date: string; time: string; weekday: DayKey } {
  const p = zonedParts(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}`, weekday: p.weekday };
}

/** The UTC instant for a local date and time in the zone (DST-aware; ambiguous times resolve to the earlier offset). */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wanted = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  // Start from the wall clock read as UTC, then shift by the zone offset observed
  // at that guess; one correction handles DST transitions.
  let guess = new Date(wanted);
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(guess, timeZone);
    const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = localAsUtc - wanted;
    if (diff === 0) break;
    guess = new Date(guess.getTime() - diff);
  }
  return guess;
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60000);
}

export function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function minutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
