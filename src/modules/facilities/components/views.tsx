import Link from "next/link";
import type { BookingStatus } from "@prisma/client";
import { zonedDateTime } from "@/lib/time";
import { describeBookingStatus, type BookingRecord, type Slot } from "../service";

const STATUS_CLASS: Record<BookingStatus, string> = {
  PENDING_APPROVAL: "bg-amber-100 text-amber-900",
  CONFIRMED: "bg-green-100 text-green-900",
  CHECKED_IN: "bg-blue-100 text-blue-900",
  COMPLETED: "bg-zinc-100 text-zinc-700",
  CANCELLED: "bg-zinc-100 text-zinc-700",
  REJECTED: "bg-red-100 text-red-900",
  EXPIRED: "bg-zinc-100 text-zinc-700",
  NO_SHOW: "bg-red-100 text-red-900",
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <span data-status={status} className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}>{describeBookingStatus(status)}</span>;
}

/** Local date, start and end of a booking in the facility's site zone. */
export function bookingWhen(b: Pick<BookingRecord, "startsAt" | "endsAt" | "facility">) {
  const tz = b.facility.site.timezone;
  const s = zonedDateTime(b.startsAt, tz);
  const e = zonedDateTime(b.endsAt, tz);
  return { date: s.date, start: s.time, end: e.time, text: `${s.date} ${s.time}–${e.time}` };
}

export function bookerName(b: BookingRecord): string {
  const p = b.user.staffProfile;
  return p ? `${p.firstName} ${p.lastName} (${p.employeeId})` : b.user.name;
}

/** Availability strip for a day: one cell per slot with remaining places. */
export function SlotGrid({ slots, capacity, date, closed }: { slots: Slot[]; capacity: number; date: string; closed: boolean }) {
  if (closed) return <p data-slots="closed" className="rounded-lg border border-dashed border-zinc-300 p-3 text-sm text-zinc-600">Closed on {date}.</p>;
  return (
    <ol data-slots={date} className="grid grid-cols-4 gap-1 sm:grid-cols-8" aria-label={`Availability on ${date}`}>
      {slots.map((s) => {
        const full = s.remaining === 0;
        const tone = s.past ? "border-zinc-200 text-zinc-400" : full ? "border-red-200 bg-red-50 text-red-900" : s.booked > 0 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-green-200 bg-green-50 text-green-900";
        return (
          <li key={s.label} data-slot={s.label} data-remaining={s.remaining} className={`rounded border px-1 py-1 text-center text-xs tabular-nums ${tone}`} title={s.past ? "Past" : full ? "Full" : `${s.remaining} of ${capacity} free`}>
            <div className="font-medium">{s.label}</div>
            <div>{s.past ? "—" : full ? "full" : `${s.remaining}/${capacity}`}</div>
          </li>
        );
      })}
    </ol>
  );
}

export function BookingCard({ b, href, children }: { b: BookingRecord; href?: string; children?: React.ReactNode }) {
  const when = bookingWhen(b);
  return (
    <li data-booking={b.id} className="card p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">{href ? <Link href={href} className="underline">{b.facility.name}</Link> : b.facility.name}</div>
        <BookingStatusBadge status={b.status} />
      </div>
      <div className="mt-1 text-zinc-600">{when.date} · {when.start}–{when.end} · {b.headcount} {b.headcount === 1 ? "person" : "people"}</div>
      {b.purpose && <div className="mt-1 text-xs text-zinc-500">{b.purpose}</div>}
      {b.status === "REJECTED" && b.decisionNote && <div className="mt-1 text-xs text-red-700">Declined: {b.decisionNote}</div>}
      {b.status === "CANCELLED" && b.cancelReason && <div className="mt-1 text-xs text-zinc-500">{b.cancelReason}</div>}
      {children && <div className="mt-2">{children}</div>}
    </li>
  );
}

/** Links to move between days plus a date picker (plain GET form, no JavaScript needed). */
export function DayNav({ base, date, prev, next, today }: { base: string; date: string; prev: string; next: string; today: string }) {
  const link = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm";
  return (
    <form method="get" action={base} className="flex flex-wrap items-center gap-2">
      <Link href={`${base}?date=${prev}`} className={link} aria-label="Previous day">‹</Link>
      <input type="date" name="date" defaultValue={date} min={today} className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm" aria-label="Date" />
      <button type="submit" className={link}>Go</button>
      <Link href={`${base}?date=${next}`} className={link} aria-label="Next day">›</Link>
      {date !== today && <Link href={base} className="text-sm underline">Today</Link>}
    </form>
  );
}
