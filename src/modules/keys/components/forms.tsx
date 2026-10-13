"use client";

import { useActionState } from "react";
import { issueKeyAction, keyExceptionAction, registerKeyAction, replaceKeyAction, returnKeyAction, type ActionState, type FormState } from "../actions";

function Feedback({ state }: { state: ActionState | FormState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>;
  if ("message" in state && state.message) return <p role="status" className="mt-2 text-sm text-green-700">{state.message}</p>;
  return null;
}
const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";
const primary = "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink disabled:opacity-60";
const secondary = "rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-60";
const danger = "rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60";
const panel = "card p-4";

type Opt = { id: string; label: string };

export function RegisterKeyForm(props: { sites: Opt[]; rooms: Array<Opt & { siteId: string }>; facilities: Array<Opt & { siteId: string }> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(registerKeyAction, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form key={state.values ? JSON.stringify(state.values) : "initial"} action={action} className={panel} noValidate>
      <h3 className="font-medium">Register a key</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Site <span className="text-zinc-500">(when not linked to a room or facility)</span><select name="siteId" defaultValue={v.siteId ?? props.sites[0]?.id ?? ""} className={input}>{props.sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label className="block text-sm">Key code *<input name="code" defaultValue={v.code ?? ""} placeholder="e.g. K-A-01/2" className={input} />{e.code && <span role="alert" className="text-xs text-red-700">{e.code}</span>}</label>
        <label className="block text-sm">Label<input name="label" defaultValue={v.label ?? ""} placeholder="e.g. Room A-01 main door" className={input} /></label>
        <label className="block text-sm">Room<select name="roomId" defaultValue={v.roomId ?? ""} className={input}><option value="">None</option>{props.rooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>{e.roomId && <span role="alert" className="text-xs text-red-700">{e.roomId}</span>}</label>
        <label className="block text-sm">Facility<select name="facilityId" defaultValue={v.facilityId ?? ""} className={input}><option value="">None</option>{props.facilities.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
        <label className="block text-sm">Notes<input name="notes" defaultValue={v.notes ?? ""} className={input} /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="allowCopies" defaultChecked={v.allowCopies === "on"} /> Copies exist (register each copy with its own code)</label>
      </div>
      <button type="submit" disabled={pending} className={`${primary} mt-3`}>{pending ? "Saving…" : "Register"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function IssueKeyForm(props: { keyId: string; staff: Opt[]; defaultStaffId?: string | null; returnPath?: string; compact?: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(issueKeyAction, {});
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="keyId" value={props.keyId} />
      {props.returnPath && <input type="hidden" name="returnPath" value={props.returnPath} />}
      <h3 className="font-medium">Issue key</h3>
      <label className="mt-2 block text-sm">To resident<select name="holderStaffId" defaultValue={props.defaultStaffId ?? ""} className={input}><option value="">Not a resident (enter name below)</option>{props.staff.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      {!props.compact && <label className="mt-2 block text-sm">Or holder name<input name="holderName" placeholder="Contractor, visitor…" className={input} /></label>}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block text-sm">Condition<select name="condition" defaultValue="Good" className={input}><option>Good</option><option>Worn</option></select></label>
        <label className="block text-sm">Expected return<input type="date" name="expectedReturnAt" className={input} /></label>
      </div>
      {!props.compact && <label className="mt-2 block text-sm">Notes<input name="notes" className={input} /></label>}
      <button type="submit" disabled={pending} className={`${primary} mt-3`}>{pending ? "Saving…" : "Issue"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function ReturnKeyForm(props: { keyId: string; returnPath?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(returnKeyAction, {});
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="keyId" value={props.keyId} />
      {props.returnPath && <input type="hidden" name="returnPath" value={props.returnPath} />}
      <h3 className="font-medium">Return key</h3>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block text-sm">Condition<select name="condition" defaultValue="Good" className={input}><option>Good</option><option>Worn</option><option>Damaged</option></select></label>
        <label className="block text-sm">Notes<input name="notes" className={input} /></label>
      </div>
      <button type="submit" disabled={pending} className={`${primary} mt-3`}>{pending ? "Saving…" : "Record return"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function KeyExceptionForm(props: { keyId: string; kinds: Array<{ kind: string; label: string; danger?: boolean }>; withIncident?: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(keyExceptionAction, {});
  if (props.kinds.length === 0) return null;
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="keyId" value={props.keyId} />
      <h3 className="font-medium">Exceptions</h3>
      <label className="mt-2 block text-sm">Notes / incident details<textarea name="notes" rows={2} className={input} /></label>
      {props.withIncident && <label className="mt-2 block text-sm">Incident reference<input name="incidentRef" className={input} /></label>}
      <div className="mt-3 flex flex-wrap gap-2">
        {props.kinds.map((k) => <button key={k.kind} type="submit" name="kind" value={k.kind} disabled={pending} className={k.danger ? danger : secondary}>{k.label}</button>)}
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function ReplaceKeyForm({ keyId, suggestedCode }: { keyId: string; suggestedCode: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(replaceKeyAction, {});
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="keyId" value={keyId} />
      <h3 className="font-medium">Replace key</h3>
      <p className="mt-1 text-xs text-zinc-500">Retires this key, closes any open issue and registers the replacement.</p>
      <label className="mt-2 block text-sm">New key code<input name="newCode" defaultValue={suggestedCode} className={input} /></label>
      <label className="mt-2 block text-sm">Notes<input name="notes" className={input} /></label>
      <button type="submit" disabled={pending} className={`${primary} mt-3`}>{pending ? "Saving…" : "Replace"}</button>
      <Feedback state={state} />
    </form>
  );
}
