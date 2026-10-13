import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/authorize";
import { zonedDateTime } from "@/lib/time";
import { facilityConfig, listFacilities, myBookings } from "@/modules/facilities/service";
import { describeHours } from "@/modules/facilities/rules";
import { BookingCard } from "@/modules/facilities/components/views";
import { CancelBookingForm } from "@/modules/facilities/components/forms";

async function Content() {
  const user = await requireUser("/my/facilities");
  const now = new Date();
  const [facilities, mine] = await Promise.all([listFacilities(), myBookings(user.id, now)]);
  return (
    <>
      <section className="mt-6">
        <h2 className="text-lg font-semibold">Book a facility</h2>
        <ul className="mt-2 space-y-2">
          {facilities.map((f) => {
            const { hours, rules } = facilityConfig(f);
            return (
              <li key={f.id} data-facility={f.code} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <Link href={`/my/facilities/${f.id}`} className="font-medium underline">{f.name}</Link>
                <div className="mt-1 text-zinc-600 dark:text-zinc-400">{f.site.name}{f.location ? ` · ${f.location}` : ""} · holds {f.capacity}</div>
                <div className="mt-1 text-xs text-zinc-500">{describeHours(hours)} · up to {rules.maxDurationMinutes} min{f.requiresApproval ? " · needs approval" : ""}</div>
              </li>
            );
          })}
          {facilities.length === 0 && <li className="text-sm text-zinc-500">No facilities are open for booking.</li>}
        </ul>
      </section>
      <section className="mt-6">
        <h2 className="text-lg font-semibold">My upcoming bookings</h2>
        <ul className="mt-2 space-y-2">
          {mine.upcoming.map((b) => {
            const local = zonedDateTime(b.startsAt, b.facility.site.timezone);
            const canChange = b.status !== "CHECKED_IN" && b.startsAt > now;
            return (
              <BookingCard key={b.id} b={b} href={`/my/facilities/${b.facilityId}?date=${local.date}`}>
                {canChange && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/my/facilities/${b.facilityId}?date=${local.date}&amend=${b.id}`} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-700">Change</Link>
                    <CancelBookingForm bookingId={b.id} facilityId={b.facilityId} returnPath="/my/facilities" />
                  </div>
                )}
              </BookingCard>
            );
          })}
          {mine.upcoming.length === 0 && <li className="text-sm text-zinc-500">Nothing booked yet.</li>}
        </ul>
      </section>
      {mine.past.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">History</h2>
          <ul className="mt-2 space-y-2">{mine.past.map((b) => <BookingCard key={b.id} b={b} />)}</ul>
        </section>
      )}
    </>
  );
}

export default function MyFacilitiesPage() {
  return (
    <main>
      <h1 className="text-2xl font-semibold">Facilities</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Gym, hall and other shared spaces.</p>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Loading…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
