"use client";

import { useActionState, useEffect, useRef } from "react";
import { amendBookingAction, attendanceAction, cancelBookingAction, createBookingAction, createFacilityAction, decideBookingAction, updateFacilityAction, type ActionState, type FormState } from "../actions";
import { DAY_KEYS, type DayKey } from "@/lib/time";
import type { BookingRules, OpeningHours } from "../rules";

function Feedback({ state }: { state: ActionState | FormState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p role="status" className="mt-2 text-sm text-green-700">{state.message}</p>;
  return null;
}
const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";
const primary = "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink disabled:opacity-60";
const secondary = "rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-60";
const danger = "rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60";
const panel = "card p-4";
const err = (m?: string) => (m ? <span role="alert" className="text-xs text-red-700">{m}</span> : null);

export type SlotOption = { label: string; remaining: number; past: boolean };
type Opt = { id: string; label: string };

export function BookingForm(props: {
  facilityId: string; facilityName: string; date: string; slots: SlotOption[]; rules: Pick<BookingRules, "slotMinutes" | "minDurationMinutes" | "maxDurationMinutes">; capacity: number;
  users?: Opt[]; returnPath?: string; amend?: { bookingId: string; startTime: string; durationMinutes: number; headcount: number };
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(props.amend ? amendBookingAction : createBookingAction, {});
  // One idempotency key per attempt: a retried submission of the same attempt is a no-op on the server.
  const keyRef = useRef<string | null>(null);
  useEffect(() => { keyRef.current = null; }, [state]);
  const submit = (fd: FormData) => { keyRef.current ??= crypto.randomUUID(); fd.set("idempotencyKey", keyRef.current); action(fd); };
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const open = props.slots.filter((s) => !s.past && s.remaining > 0);
  const durations: number[] = [];
  for (let d = props.rules.minDurationMinutes; d <= props.rules.maxDurationMinutes; d += props.rules.slotMinutes) durations.push(d);
  const defaultStart = v.startTime ?? props.amend?.startTime ?? open[0]?.label ?? "";
  const defaultDuration = v.durationMinutes ?? String(props.amend?.durationMinutes ?? durations[0] ?? props.rules.minDurationMinutes);
  if (open.length === 0 && !props.amend) return <div className={`${panel} text-sm text-zinc-600`} data-booking-form="closed">No places left to book on {props.date}. Try another day.</div>;
  return (
    <form key={state.values ? JSON.stringify(state.values) : "initial"} action={submit} className={panel} noValidate data-booking-form={props.amend ? "amend" : "create"}>
      <input type="hidden" name="facilityId" value={props.facilityId} />
      <input type="hidden" name="date" value={props.date} />
      {props.amend && <input type="hidden" name="bookingId" value={props.amend.bookingId} />}
      {props.returnPath && <input type="hidden" name="returnPath" value={props.returnPath} />}
      <h3 className="font-medium">{props.amend ? "Change booking" : `Book ${props.facilityName}`} · {props.date}</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Start time
          <select name="startTime" defaultValue={defaultStart} className={input}>
            {open.map((s) => <option key={s.label} value={s.label}>{s.label} ({s.remaining} of {props.capacity} free)</option>)}
            {props.amend && !open.some((s) => s.label === props.amend?.startTime) && <option value={props.amend.startTime}>{props.amend.startTime} (current)</option>}
          </select>
          {err(e.startTime)}
        </label>
        <label className="block text-sm">Duration
          <select name="durationMinutes" defaultValue={defaultDuration} className={input}>
            {durations.map((d) => <option key={d} value={d}>{d >= 60 ? `${Math.floor(d / 60)} h${d % 60 ? ` ${d % 60} min` : ""}` : `${d} min`}</option>)}
          </select>
          {err(e.durationMinutes)}
        </label>
        <label className="block text-sm">People<input type="number" name="headcount" min={1} max={props.capacity} defaultValue={v.headcount ?? String(props.amend?.headcount ?? 1)} className={input} />{err(e.headcount)}</label>
        {props.users && !props.amend && (
          <label className="block text-sm">For<select name="userId" defaultValue={v.userId ?? ""} className={input}><option value="">Myself</option>{props.users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</select></label>
        )}
        {!props.amend && <label className="block text-sm sm:col-span-2">Purpose <span className="text-zinc-500">(optional)</span><input name="purpose" defaultValue={v.purpose ?? ""} maxLength={200} className={input} /></label>}
      </div>
      {err(e.date)}
      <button type="submit" disabled={pending} className={`${primary} mt-3`}>{pending ? "Saving…" : props.amend ? "Save changes" : "Book"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function CancelBookingForm(props: { bookingId: string; facilityId: string; requireReason?: boolean; returnPath?: string; label?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(cancelBookingAction, {});
  return (
    <form action={action} className="inline-block" data-cancel={props.bookingId}>
      <input type="hidden" name="bookingId" value={props.bookingId} />
      <input type="hidden" name="facilityId" value={props.facilityId} />
      {props.returnPath && <input type="hidden" name="returnPath" value={props.returnPath} />}
      <div className="flex flex-wrap items-end gap-2">
        {props.requireReason && <label className="block text-sm">Reason for the booker<input name="reason" required className={input} /></label>}
        <button type="submit" disabled={pending} className={danger}>{pending ? "Cancelling…" : props.label ?? "Cancel booking"}</button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function DecideBookingForm(props: { bookingId: string; facilityId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(decideBookingAction, {});
  return (
    <form action={action} data-decide={props.bookingId}>
      <input type="hidden" name="bookingId" value={props.bookingId} />
      <input type="hidden" name="facilityId" value={props.facilityId} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-sm">Note <span className="text-zinc-500">(required to decline)</span><input name="note" className={input} /></label>
        <button type="submit" name="decision" value="approve" disabled={pending} className={primary}>Approve</button>
        <button type="submit" name="decision" value="reject" disabled={pending} className={danger}>Decline</button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function AttendanceForm(props: { bookingId: string; facilityId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(attendanceAction, {});
  return (
    <form action={action} className="inline-block" data-attendance={props.bookingId}>
      <input type="hidden" name="bookingId" value={props.bookingId} />
      <input type="hidden" name="facilityId" value={props.facilityId} />
      <div className="flex gap-2">
        <button type="submit" name="attended" value="yes" disabled={pending} className={secondary}>Mark used</button>
        <button type="submit" name="attended" value="no" disabled={pending} className={danger}>No-show</button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

const DAY_LABEL: Record<DayKey, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const RULE_FIELDS: Array<[keyof BookingRules, string, string]> = [
  ["slotMinutes", "Slot length (min)", "Start times and durations are multiples of this."],
  ["minDurationMinutes", "Minimum booking (min)", ""],
  ["maxDurationMinutes", "Maximum booking (min)", ""],
  ["advanceDays", "Book up to (days ahead)", ""],
  ["bufferMinutes", "Buffer between bookings (min)", "Kept free before and after each booking."],
  ["cancellationCutoffMinutes", "Cancellation cut-off (min before start)", "After this, only a facility manager can cancel."],
  ["maxActivePerUser", "Max upcoming bookings per person", "0 = unlimited."],
  ["maxPerDayPerUser", "Max bookings per person per day", "0 = unlimited."],
];

export function FacilityConfigForm(props: { facility: { id: string; name: string; location: string | null; description: string | null; capacity: number; requiresApproval: boolean; status: string }; hours: OpeningHours; rules: BookingRules }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateFacilityAction, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const f = props.facility;
  return (
    <form key={state.values ? JSON.stringify(state.values) : "initial"} action={action} className={panel} noValidate data-facility-config>
      <input type="hidden" name="facilityId" value={f.id} />
      <h3 className="font-medium">Facility settings</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Name *<input name="name" defaultValue={v.name ?? f.name} className={input} />{err(e.name)}</label>
        <label className="block text-sm">Location<input name="location" defaultValue={v.location ?? f.location ?? ""} className={input} /></label>
        <label className="block text-sm sm:col-span-2">Description<input name="description" defaultValue={v.description ?? f.description ?? ""} className={input} /></label>
        <label className="block text-sm">Capacity (people at once) *<input type="number" name="capacity" min={1} defaultValue={v.capacity ?? String(f.capacity)} className={input} />{err(e.capacity)}</label>
        <label className="block text-sm">Status<select name="status" defaultValue={v.status ?? f.status} className={input}><option value="ACTIVE">Active (bookable)</option><option value="INACTIVE">Inactive (hidden from staff)</option></select></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="requiresApproval" defaultChecked={v.requiresApproval ? v.requiresApproval === "on" : f.requiresApproval} /> Bookings need a facility manager&apos;s approval</label>
      </div>
      <h4 className="mt-4 text-sm font-medium">Opening hours</h4>
      <div className="mt-1 grid gap-2">
        {DAY_KEYS.map((day) => {
          const h = props.hours[day];
          const closed = v[`${day}_closed`] !== undefined ? v[`${day}_closed`] === "on" : h === null;
          return (
            <div key={day} className="grid grid-cols-[7rem_1fr_1fr_auto] items-center gap-2 text-sm">
              <span>{DAY_LABEL[day]}</span>
              <input type="time" name={`${day}_open`} defaultValue={v[`${day}_open`] ?? h?.open ?? "08:00"} className={input} aria-label={`${DAY_LABEL[day]} opens`} />
              <input type="time" name={`${day}_close`} defaultValue={v[`${day}_close`] ?? h?.close ?? "22:00"} className={input} aria-label={`${DAY_LABEL[day]} closes`} />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" name={`${day}_closed`} defaultChecked={closed} /> Closed</label>
              {e[day] && <span className="col-span-4">{err(e[day])}</span>}
            </div>
          );
        })}
      </div>
      <h4 className="mt-4 text-sm font-medium">Booking rules</h4>
      <div className="mt-1 grid gap-3 sm:grid-cols-2">
        {RULE_FIELDS.map(([key, label, hint]) => (
          <label key={key} className="block text-sm">{label}<input type="number" name={key} min={0} defaultValue={v[key] ?? String(props.rules[key])} className={input} />{hint && <span className="text-xs text-zinc-500">{hint}</span>}{err(e[key])}</label>
        ))}
      </div>
      <button type="submit" disabled={pending} className={`${primary} mt-4`}>{pending ? "Saving…" : "Save settings"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function CreateFacilityForm(props: { sites: Opt[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createFacilityAction, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form key={state.values ? JSON.stringify(state.values) : "initial"} action={action} className={panel} noValidate>
      <h3 className="font-medium">Add a facility</h3>
      <p className="mt-1 text-xs text-zinc-500">Opening hours and booking rules can be set on the facility page afterwards.</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-4">
        <label className="block text-sm">Site<select name="siteId" defaultValue={v.siteId ?? props.sites[0]?.id ?? ""} className={input}>{props.sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label className="block text-sm">Code *<input name="code" defaultValue={v.code ?? ""} placeholder="e.g. HALL" className={input} />{err(e.code)}</label>
        <label className="block text-sm">Name *<input name="name" defaultValue={v.name ?? ""} placeholder="e.g. Community hall" className={input} /></label>
        <label className="block text-sm">Capacity *<input type="number" name="capacity" min={1} defaultValue={v.capacity ?? "1"} className={input} /></label>
      </div>
      <button type="submit" disabled={pending} className={`${primary} mt-3`}>{pending ? "Saving…" : "Add facility"}</button>
      <Feedback state={state} />
    </form>
  );
}
