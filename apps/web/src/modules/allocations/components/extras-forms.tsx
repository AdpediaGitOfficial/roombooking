"use client";

import { useActionState } from "react";
import { addWaitlistAction, allocateWaitlistAction, bulkAllocateAction, cancelWaitlistAction, decideProvisionalAction, emergencyCheckInAction, extendStayAction, setReadinessAction, swapBedsAction, type ActionState } from "../extras-actions";

const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";
const primary = "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink disabled:opacity-60";
const secondary = "rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-60";
const panel = "card p-4";

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p role="status" className="mt-2 text-sm text-green-700">{state.message}</p>;
  return null;
}

export function ReadinessForm({ bedId, ready }: { bedId: string; ready: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setReadinessAction, {});
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="bedId" value={bedId} />
      <input type="hidden" name="readiness" value={ready ? "NEEDS_CLEANING" : "READY"} />
      <span className={`chip ${ready ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>{ready ? "ready" : "needs cleaning"}</span>
      <button type="submit" disabled={pending} className="text-xs underline disabled:opacity-60">{ready ? "Mark needs cleaning" : "Mark ready"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function EmergencyCheckInForm({ staff, beds }: { staff: Array<{ id: string; label: string }>; beds: Array<{ id: string; label: string }> }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(emergencyCheckInAction, {});
  return (
    <form action={action} className={panel} noValidate>
      <h3 className="font-medium">Emergency check-in</h3>
      <p className="mt-1 text-xs text-zinc-500">For a resident who must be housed now. The stay is provisional: an Accommodation Admin approves it within 24 hours, or it becomes a move task.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Person<select name="staffId" className={input} defaultValue=""><option value="" disabled>Select…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label className="block text-sm">Bed<select name="bedId" className={input} defaultValue=""><option value="" disabled>Select…</option>{beds.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>
        <label className="block text-sm">Until (optional)<input type="date" name="endDate" className={input} /></label>
        <label className="block text-sm">Reason *<input name="reason" className={input} placeholder="e.g. flooding in dorm 2" /></label>
      </div>
      <button type="submit" disabled={pending} className={`${primary} mt-3`}>{pending ? "Checking in…" : "Check in now"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function ProvisionalDecisionForm({ allocationId }: { allocationId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(decideProvisionalAction, {});
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="allocationId" value={allocationId} />
      <input name="note" placeholder="Note (required to reject)" aria-label="Note" className={`${input} !mt-0 w-56`} />
      <button type="submit" name="decision" value="approve" disabled={pending} className={primary}>Approve stay</button>
      <button type="submit" name="decision" value="reject" disabled={pending} className={secondary}>Reject and create move task</button>
      <div className="basis-full"><Feedback state={state} /></div>
    </form>
  );
}

export function ExtendStayForm({ allocationId, currentEnd, maxDays }: { allocationId: string; currentEnd: string; maxDays: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(extendStayAction, {});
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="allocationId" value={allocationId} />
      <h3 className="font-medium">Extend stay</h3>
      <p className="mt-1 text-xs text-zinc-500">Currently ends {currentEnd}. Up to {maxDays} days more is within policy; longer needs an &quot;extension beyond policy&quot; request.</p>
      <label className="mt-2 block text-sm">New end date<input type="date" name="newEndDate" min={currentEnd} className={input} /></label>
      <label className="mt-2 block text-sm">Reason<input name="reason" className={input} /></label>
      <button type="submit" disabled={pending} className={`${secondary} mt-3`}>{pending ? "Saving…" : "Extend"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function SwapBedsForm({ allocationId, others }: { allocationId: string; others: Array<{ id: string; label: string }> }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(swapBedsAction, {});
  if (others.length === 0) return null;
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="allocationId" value={allocationId} />
      <h3 className="font-medium">Swap beds with another resident</h3>
      <p className="mt-1 text-xs text-zinc-500">Both move at once; gender policy and eligibility are checked for each.</p>
      <label className="mt-2 block text-sm">Swap with<select name="otherAllocationId" className={input} defaultValue=""><option value="" disabled>Select…</option>{others.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
      <label className="mt-2 block text-sm">Reason<input name="reason" className={input} /></label>
      <button type="submit" disabled={pending} className={`${secondary} mt-3`}>{pending ? "Swapping…" : "Swap beds"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function BulkAllocateForm({ staff, sites, buildings, canOverride }: { staff: Array<{ id: string; label: string }>; sites: Array<{ id: string; name: string }>; buildings: Array<{ id: string; name: string }>; canOverride: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(bulkAllocateAction, {});
  return (
    <form action={action} className={panel} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Start date<input type="date" name="startDate" className={input} /></label>
        <label className="block text-sm">End date (optional)<input type="date" name="endDate" className={input} /></label>
        <label className="block text-sm">Site<select name="siteId" className={input}><option value="">Any site</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="block text-sm">Building<select name="buildingId" className={input}><option value="">Any building</option>{buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="block text-sm sm:col-span-2">Reason<input name="reason" className={input} defaultValue="Bulk allocation" /></label>
        {canOverride && <label className="block text-sm sm:col-span-2">Eligibility override reason (only if some people fall outside their entitlement)<input name="eligibilityOverrideReason" className={input} /></label>}
      </div>
      <fieldset className="mt-3"><legend className="text-sm font-medium">People ({staff.length})</legend>
        <ul className="mt-2 max-h-72 divide-y divide-zinc-200 overflow-y-auto rounded-md border border-zinc-200 text-sm">
          {staff.map((s) => <li key={s.id}><label className="flex items-center gap-2 px-3 py-1.5"><input type="checkbox" name="staffIds" value={s.id} />{s.label}</label></li>)}
          {staff.length === 0 && <li className="px-3 py-3 text-zinc-500">Everyone eligible already has a bed.</li>}
        </ul>
      </fieldset>
      <button type="submit" disabled={pending} className={`${primary} mt-3`}>{pending ? "Placing…" : "Place selected people"}</button>
      <Feedback state={state} />
      {state.results && <ul className="mt-3 divide-y divide-zinc-200 rounded-md border border-zinc-200 text-sm" data-bulk-results>{state.results.map((r, i) => <li key={i} className="flex justify-between gap-3 px-3 py-1.5"><span>{r.name}</span><span className={r.ok ? "text-green-700" : "text-red-700"}>{r.ok ? `bed ${r.bed}` : r.error}</span></li>)}</ul>}
    </form>
  );
}

export function AddWaitlistForm({ staff, sites, roomTypes }: { staff: Array<{ id: string; label: string }>; sites: Array<{ id: string; name: string }>; roomTypes: Array<{ code: string; name: string }> }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addWaitlistAction, {});
  return (
    <form action={action} className={panel} noValidate>
      <h3 className="font-medium">Add to the waitlist</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Person<select name="staffId" className={input} defaultValue=""><option value="" disabled>Select…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label className="block text-sm">Needed from<input type="date" name="neededFrom" className={input} /></label>
        <label className="block text-sm">Site<select name="siteId" className={input}><option value="">Any</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="block text-sm">Room type<select name="roomType" className={input}><option value="">Any</option>{roomTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select></label>
        <label className="block text-sm">Priority (higher first)<input type="number" name="priority" defaultValue={0} className={input} /></label>
        <label className="block text-sm">Notes<input name="notes" className={input} /></label>
      </div>
      <button type="submit" disabled={pending} className={`${secondary} mt-3`}>{pending ? "Adding…" : "Add"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function WaitlistRowActions({ entryId, suggestions }: { entryId: string; suggestions: Array<{ bedId: string; label: string }> }) {
  const [as, aa, ap] = useActionState<ActionState, FormData>(allocateWaitlistAction, {});
  const [cs, ca, cp] = useActionState<ActionState, FormData>(cancelWaitlistAction, {});
  return (
    <div className="space-y-2">
      {suggestions.length > 0 ? (
        <form action={aa} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="entryId" value={entryId} />
          <select name="bedId" aria-label="Offer bed" className={`${input} !mt-0 w-auto max-w-xs`}>{suggestions.map((s) => <option key={s.bedId} value={s.bedId}>{s.label}</option>)}</select>
          <button type="submit" disabled={ap} className={secondary}>Allocate</button>
        </form>
      ) : <p className="text-xs text-zinc-500">No suitable bed is free right now.</p>}
      <form action={ca} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="entryId" value={entryId} />
        <input name="reason" placeholder="Reason to remove" aria-label="Reason" className={`${input} !mt-0 w-44`} />
        <button type="submit" disabled={cp} className="text-xs text-red-700 underline">Remove</button>
      </form>
      <Feedback state={as} /><Feedback state={cs} />
    </div>
  );
}
