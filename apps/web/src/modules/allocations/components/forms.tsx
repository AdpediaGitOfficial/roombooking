"use client";

import { useActionState } from "react";
import { allocateAction, cancelAction, checkInAction, checkOutAction, transferAction, type ActionState } from "../actions";
import type { ClearanceBlocker } from "@sam/core/modules/allocations/service";

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p role="status" className="mt-2 text-sm text-green-700">{state.message}</p>;
  return null;
}

const input = "rounded-md border border-zinc-300 px-3 py-2 text-sm";
const button = "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink disabled:opacity-60";
const panel = "card p-4";

export function AllocateForm(props: { bedId: string; staffId: string; startDate: string; endDate: string; reason: string; label?: string; eligibility?: { ok: boolean; reasons: string[] }; canOverride?: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(allocateAction, {});
  const blocked = props.eligibility && !props.eligibility.ok;
  return (
    <form action={action}>
      {blocked && (
        <div className="mb-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900" data-eligibility>
          <b>Not eligible for this room.</b>
          <ul className="mt-1 list-disc pl-5">{props.eligibility!.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          {props.canOverride ? (
            <label className="mt-2 block text-xs">Override reason (flagged and reported to the approvers)<input name="eligibilityOverrideReason" className={`${input} mt-1 w-full`} /></label>
          ) : <p className="mt-2 text-xs">Choose another bed, or ask an Accommodation Admin with the Eligibility override grant.</p>}
        </div>
      )}
      <select name="stayType" defaultValue="PERMANENT" aria-label="Stay type" className={`${input} mb-3 w-full`}>
        <option value="PERMANENT">Permanent stay</option><option value="TEMPORARY">Temporary</option><option value="VISITING">Visiting</option><option value="TRAINING">Training</option>
      </select>
      <input type="hidden" name="bedId" value={props.bedId} />
      <input type="hidden" name="staffId" value={props.staffId} />
      <input type="hidden" name="startDate" value={props.startDate} />
      <input type="hidden" name="endDate" value={props.endDate} />
      <input type="hidden" name="reason" value={props.reason} />
      <button type="submit" disabled={pending || (!!blocked && !props.canOverride)} className={`${button} ${props.label ? "w-full" : ""}`}>{pending ? "Allocating…" : (props.label ?? "Allocate")}</button>
      <Feedback state={state} />
    </form>
  );
}

export type ChecklistItem = { id: string; label: string };

function Checklist({ items }: { items: ChecklistItem[] }) {
  if (items.length === 0) return null;
  return (
    <fieldset className="mt-2">
      <legend className="text-sm font-medium">Checklist</legend>
      <ul className="mt-1 space-y-1">
        {items.map((i) => <li key={i.id}><label className="flex items-start gap-2 text-sm"><input type="checkbox" name={`check_${i.id}`} className="mt-1" />{i.label}</label></li>)}
      </ul>
    </fieldset>
  );
}

export function CheckInForm({ allocationId, items = [], notReady = false }: { allocationId: string; items?: ChecklistItem[]; notReady?: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(checkInAction, {});
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="allocationId" value={allocationId} />
      <h3 className="font-medium">Check in</h3>
      {notReady && (
        <p className="mt-2 rounded-md bg-yellow-50 p-3 text-sm text-yellow-900">This bed is marked as needing cleaning. <label className="mt-1 flex items-center gap-2"><input type="checkbox" name="acceptNotReady" />Hand it over as it is</label></p>
      )}
      <Checklist items={items} />
      <label htmlFor="checkin-notes" className="mt-2 block text-sm">Arrival notes / handover checklist</label>
      <textarea id="checkin-notes" name="notes" rows={2} className={`${input} mt-1 w-full`} placeholder="Keys handed over, room condition…" />
      <button type="submit" disabled={pending} className={`${button} mt-3`}>{pending ? "Saving…" : "Confirm arrival"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function CheckOutForm({ allocationId, blockers, canOverride, items = [] }: { allocationId: string; blockers: ClearanceBlocker[]; canOverride: boolean; items?: ChecklistItem[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(checkOutAction, {});
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="allocationId" value={allocationId} />
      <h3 className="font-medium">Check out</h3>
      {blockers.length > 0 && (
        <div className="mt-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-medium">Clearance blockers</div>
          <ul className="mt-1 list-disc pl-5">
            {blockers.map((b) => <li key={b.label}>{b.label}</li>)}
          </ul>
          {canOverride ? (
            <label className="mt-2 block">
              <span className="text-xs">Override reason (administrator)</span>
              <input name="overrideReason" className={`${input} mt-1 w-full`} placeholder="e.g. key reported lost, incident #…" />
            </label>
          ) : (
            <p className="mt-2 text-xs">Items must be returned, or an accommodation administrator must override.</p>
          )}
        </div>
      )}
      <Checklist items={items} />
      <label htmlFor="checkout-notes" className="mt-2 block text-sm">Departure notes / condition</label>
      <textarea id="checkout-notes" name="notes" rows={2} className={`${input} mt-1 w-full`} />
      <button type="submit" disabled={pending} className={`${button} mt-3`}>{pending ? "Saving…" : "Confirm departure"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function CancelForm({ allocationId }: { allocationId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(cancelAction, {});
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="allocationId" value={allocationId} />
      <h3 className="font-medium">Cancel allocation</h3>
      <label htmlFor="cancel-reason" className="mt-2 block text-sm">Reason</label>
      <input id="cancel-reason" name="reason" required className={`${input} mt-1 w-full`} />
      <button type="submit" disabled={pending} className="mt-3 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60">
        {pending ? "Cancelling…" : "Cancel allocation"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function TransferForm(props: { allocationId: string; toBedId: string; effectiveDate: string; reason: string; requestId?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(transferAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="allocationId" value={props.allocationId} />
      <input type="hidden" name="toBedId" value={props.toBedId} />
      <input type="hidden" name="effectiveDate" value={props.effectiveDate} />
      <input type="hidden" name="reason" value={props.reason} />
      {props.requestId && <input type="hidden" name="requestId" value={props.requestId} />}
      <button type="submit" disabled={pending} className={button}>{pending ? "Transferring…" : "Transfer here"}</button>
      <Feedback state={state} />
    </form>
  );
}
