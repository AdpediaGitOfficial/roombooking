import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canSeeSite } from "@/lib/auth/scope";
import { hasRole, requireRole } from "@/lib/auth/authorize";
import { addDaysIso, zonedDateTime } from "@sam/core/lib/time";
import { FACILITY_MANAGE_ROLES, FACILITY_OPERATE_ROLES, FACILITY_VIEW_ROLES } from "@sam/core/modules/facilities/access";
import { availabilityForDay, bookingsForDay, facilityConfig, getFacility } from "@sam/core/modules/facilities/service";
import { bookableUsers } from "@/modules/facilities/context";
import { BookingStatusBadge, DayNav, SlotGrid, bookerName, bookingWhen } from "@/modules/facilities/components/views";
import { AttendanceForm, BookingForm, CancelBookingForm, DecideBookingForm, FacilityConfigForm } from "@/modules/facilities/components/forms";

type Params = Promise<{ facilityId: string }>;
type Search = Promise<{ date?: string }>;

async function Content({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { facilityId } = await params;
  const { date: rawDate } = await searchParams;
  const user = await requireRole(FACILITY_VIEW_ROLES, `/facilities/${facilityId}`);
  const canManage = hasRole(user, ...FACILITY_MANAGE_ROLES);
  const canOperate = hasRole(user, ...FACILITY_OPERATE_ROLES);
  const facility = await getFacility(facilityId);
  if (!facility) notFound();
  if (!(await canSeeSite(user, "fac.view", facility.siteId))) notFound();
  const now = new Date();
  const tz = facility.site.timezone;
  const today = zonedDateTime(now, tz).date;
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : today;
  const { hours, rules } = facilityConfig(facility);
  const [slots, bookings, users] = await Promise.all([availabilityForDay(facility, date, now), bookingsForDay(facility, date), canOperate ? bookableUsers() : null]);
  const base = `/facilities/${facility.id}`;
  const returnPath = `${base}?date=${date}`;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title">{facility.name}</h1>
        <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs">{facility.status === "ACTIVE" ? "Active" : "Inactive"}</span>
        {facility.requiresApproval && <span className="rounded-full border border-amber-300 px-2 py-0.5 text-xs text-amber-800">Approval required</span>}
      </div>
      <p className="mt-1 text-sm text-zinc-600">{facility.site.name}{facility.location ? ` · ${facility.location}` : ""} · {facility.code} · holds {facility.capacity} · {tz}</p>

      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="section-title">Schedule · {date}</h2>
          <DayNav base={base} date={date} prev={addDaysIso(date, -1)} next={addDaysIso(date, 1)} today={today} />
        </div>
        <div className="mt-3"><SlotGrid slots={slots} capacity={facility.capacity} date={date} closed={slots.length === 0} /></div>
        <div className="mt-4 overflow-x-auto card">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Booked by</th><th className="px-3 py-2">People</th><th className="px-3 py-2">Status</th>{canOperate && <th className="px-3 py-2">Actions</th>}</tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {bookings.map((b) => {
                const when = bookingWhen(b);
                const started = b.startsAt <= now;
                const upcoming = ["CONFIRMED", "PENDING_APPROVAL"].includes(b.status);
                return (
                  <tr key={b.id} data-booking={b.id} data-status={b.status}>
                    <td className="px-3 py-3 tabular-nums">{when.start}–{when.end}</td>
                    <td className="px-3 py-3">{bookerName(b)}{b.purpose && <div className="text-xs text-zinc-500">{b.purpose}</div>}{b.createdById !== b.userId && <div className="text-xs text-zinc-500">booked on their behalf</div>}</td>
                    <td className="px-3 py-3 tabular-nums">{b.headcount}</td>
                    <td className="px-3 py-3"><BookingStatusBadge status={b.status} />{b.decisionNote && <div className="text-xs text-zinc-500">{b.decisionNote}</div>}{b.cancelReason && <div className="text-xs text-zinc-500">{b.cancelReason}</div>}</td>
                    {canOperate && (
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-2">
                          {b.status === "PENDING_APPROVAL" && canManage && !started && <DecideBookingForm bookingId={b.id} facilityId={facility.id} />}
                          {b.status === "CONFIRMED" && started && <AttendanceForm bookingId={b.id} facilityId={facility.id} />}
                          {upcoming && canManage && <CancelBookingForm bookingId={b.id} facilityId={facility.id} requireReason returnPath={returnPath} label="Cancel" />}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {bookings.length === 0 && <tr><td colSpan={canOperate ? 5 : 4} className="px-3 py-6 text-center text-zinc-500">No bookings on {date}.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {users && facility.status === "ACTIVE" && slots.length > 0 && (
        <section className="mt-6">
          <h2 className="section-title">Book on behalf</h2>
          <div className="mt-2">
            <BookingForm facilityId={facility.id} facilityName={facility.name} date={date} capacity={facility.capacity} rules={rules} users={users} returnPath={returnPath}
              slots={slots.map((s) => ({ label: s.label, remaining: s.remaining, past: s.past }))} />
          </div>
        </section>
      )}

      {canManage && (
        <section className="mt-6">
          <h2 className="section-title">Settings</h2>
          <div className="mt-2"><FacilityConfigForm facility={{ id: facility.id, name: facility.name, location: facility.location, description: facility.description, capacity: facility.capacity, requiresApproval: facility.requiresApproval, status: facility.status }} hours={hours} rules={rules} /></div>
        </section>
      )}
      <p className="mt-6 text-sm"><Link href="/facilities" className="underline">← All facilities</Link></p>
    </>
  );
}

export default function FacilityDetailPage({ params, searchParams }: PageProps<"/facilities/[facilityId]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content params={params as Params} searchParams={searchParams as Search} />
      </Suspense>
    </main>
  );
}
