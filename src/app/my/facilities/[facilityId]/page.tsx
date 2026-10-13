import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/authorize";
import { addDaysIso, zonedDateTime } from "@/lib/time";
import { availabilityForDay, facilityConfig, getBooking, getFacility } from "@/modules/facilities/service";
import { describeHours } from "@/modules/facilities/rules";
import { DayNav, SlotGrid, bookingWhen } from "@/modules/facilities/components/views";
import { BookingForm } from "@/modules/facilities/components/forms";

type Params = Promise<{ facilityId: string }>;
type Search = Promise<{ date?: string; amend?: string }>;

async function Content({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { facilityId } = await params;
  const { date: rawDate, amend } = await searchParams;
  const user = await requireUser(`/my/facilities/${facilityId}`);
  const facility = await getFacility(facilityId);
  if (!facility || facility.status !== "ACTIVE") notFound();
  const now = new Date();
  const tz = facility.site.timezone;
  const today = zonedDateTime(now, tz).date;
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate >= today ? rawDate : today;
  const { hours, rules } = facilityConfig(facility);
  const slots = await availabilityForDay(facility, date, now);
  const amending = amend ? await getBooking(amend) : null;
  const amendProps = amending && amending.userId === user.id && ["CONFIRMED", "PENDING_APPROVAL"].includes(amending.status) && amending.facilityId === facility.id
    ? { bookingId: amending.id, startTime: bookingWhen(amending).start, durationMinutes: (amending.endsAt.getTime() - amending.startsAt.getTime()) / 60000, headcount: amending.headcount }
    : undefined;
  const base = `/my/facilities/${facility.id}`;
  const lastDay = addDaysIso(today, rules.advanceDays);
  return (
    <>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{facility.site.name}{facility.location ? ` · ${facility.location}` : ""} · holds {facility.capacity}</p>
      {facility.description && <p className="mt-2 text-sm">{facility.description}</p>}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-600 dark:text-zinc-400">
        <div><dt className="uppercase tracking-wide text-zinc-500">Open</dt><dd>{describeHours(hours)}</dd></div>
        <div><dt className="uppercase tracking-wide text-zinc-500">Rules</dt><dd>{rules.minDurationMinutes}–{rules.maxDurationMinutes} min · up to {rules.advanceDays} days ahead{rules.maxPerDayPerUser ? ` · ${rules.maxPerDayPerUser}/day` : ""}{rules.cancellationCutoffMinutes ? ` · cancel ≥ ${rules.cancellationCutoffMinutes} min before` : ""}{facility.requiresApproval ? " · needs approval" : ""}</dd></div>
      </dl>
      <section className="mt-5">
        <DayNav base={base} date={date} prev={addDaysIso(date, -1) >= today ? addDaysIso(date, -1) : today} next={addDaysIso(date, 1) <= lastDay ? addDaysIso(date, 1) : date} today={today} />
        <div className="mt-3"><SlotGrid slots={slots} capacity={facility.capacity} date={date} closed={slots.length === 0} /></div>
        {date > lastDay && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">Bookings open {rules.advanceDays} days ahead; this day is not bookable yet.</p>}
      </section>
      <section className="mt-5">
        {slots.length > 0 && date <= lastDay && (
          <BookingForm facilityId={facility.id} facilityName={facility.name} date={date} capacity={facility.capacity} rules={rules} returnPath={`${base}?date=${date}`} amend={amendProps}
            slots={slots.map((s) => ({ label: s.label, remaining: s.remaining, past: s.past }))} />
        )}
        {amend && !amendProps && <p className="text-sm text-zinc-500">That booking can no longer be changed.</p>}
      </section>
      <p className="mt-6 text-sm"><Link href="/my/facilities" className="underline">← All facilities and my bookings</Link></p>
    </>
  );
}

export default function FacilityPage({ params, searchParams }: PageProps<"/my/facilities/[facilityId]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Title params={params as Params} />
        <Content params={params as Params} searchParams={searchParams as Search} />
      </Suspense>
    </main>
  );
}

async function Title({ params }: { params: Params }) {
  const { facilityId } = await params;
  const facility = await getFacility(facilityId);
  return <h1 className="text-2xl font-semibold">{facility?.name ?? "Facility"}</h1>;
}
