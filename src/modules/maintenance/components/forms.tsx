"use client";

import { useActionState } from "react";
import type { WorkOrderStatus } from "@prisma/client";
import { assignAction, createWorkOrderAction, noteAction, statusAction, triageAction, type ActionState, type FormState } from "../actions";

function Feedback({ state }: { state: ActionState | FormState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{state.error}</p>;
  if ("message" in state && state.message) return <p role="status" className="mt-2 text-sm text-green-700 dark:text-green-300">{state.message}</p>;
  return null;
}

const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900";
const inputSm = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const primary = "rounded-md bg-zinc-900 px-4 py-3 text-base font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900";
const secondary = "rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-60 dark:border-zinc-700";
const panel = "rounded-lg border border-zinc-200 p-4 dark:border-zinc-800";

type LocationOption = { id: string; label: string };

export function NewWorkOrderForm(props: {
  categories: readonly string[];
  rooms: LocationOption[];
  defaultRoomId?: string | null;
  buildings: LocationOption[];
  returnTo: "my" | "ops";
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createWorkOrderAction, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const key = state.values ? JSON.stringify(state.values) : "initial";
  return (
    <form key={key} action={action} encType="multipart/form-data" noValidate className="space-y-5">
      <input type="hidden" name="returnTo" value={props.returnTo} />

      <div>
        <label htmlFor="roomId" className="block text-sm font-medium">Where is the problem?</label>
        <select id="roomId" name="roomId" defaultValue={v.roomId ?? props.defaultRoomId ?? ""} className={input}>
          <option value="">Somewhere else (describe below)</option>
          {props.rooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        {props.buildings.length > 0 && (
          <select id="buildingId" name="buildingId" aria-label="Building" defaultValue={v.buildingId ?? ""} className={`${input} mt-2`}>
            <option value="">Building (optional)</option>
            {props.buildings.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        )}
        <input id="locationNote" name="locationNote" defaultValue={v.locationNote ?? ""} placeholder="Location details, e.g. kitchen on floor 2" className={`${input} mt-2`} />
        {e.locationNote && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-300">{e.locationNote}</p>}
      </div>

      <div>
        <label htmlFor="category" className="block text-sm font-medium">Category *</label>
        <select id="category" name="category" defaultValue={v.category ?? ""} className={input}>
          <option value="">Select…</option>
          {props.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {e.category && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-300">{e.category}</p>}
      </div>

      <div>
        <label htmlFor="priority" className="block text-sm font-medium">Urgency *</label>
        <select id="priority" name="priority" defaultValue={v.priority ?? "MEDIUM"} className={input}>
          <option value="LOW">Low · can wait a week</option>
          <option value="MEDIUM">Medium · within 3 days</option>
          <option value="HIGH">High · within a day</option>
          <option value="URGENT">Urgent · safety or no water/power</option>
        </select>
        <p className="mt-1 text-xs text-zinc-500">For emergencies that put anyone at risk, also call security immediately.</p>
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium">What is wrong? *</label>
        <textarea id="description" name="description" rows={4} defaultValue={v.description ?? ""} className={input} />
        {e.description && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-300">{e.description}</p>}
      </div>

      <div>
        <label htmlFor="photo" className="block text-sm font-medium">Photo (optional)</label>
        <input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="mt-1 block w-full text-sm" />
        {e.photo && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-300">{e.photo}</p>}
      </div>

      <div>
        <label htmlFor="preferredContact" className="block text-sm font-medium">How should we contact you?</label>
        <input id="preferredContact" name="preferredContact" defaultValue={v.preferredContact ?? ""} placeholder="e.g. WhatsApp 050 123 4567, after 6pm" className={input} />
      </div>

      {state.error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{state.error}</p>}
      <button type="submit" disabled={pending} className={`${primary} w-full`}>{pending ? "Submitting…" : "Submit request"}</button>
    </form>
  );
}

export function AssignForm(props: { workOrderId: string; engineers: LocationOption[]; vendors: LocationOption[]; current?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(assignAction, {});
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="workOrderId" value={props.workOrderId} />
      <h3 className="font-medium">Assign</h3>
      <select name="target" aria-label="Assign to" defaultValue={props.current ?? ""} className={inputSm}>
        <option value="" disabled>Choose…</option>
        {props.engineers.length > 0 && <optgroup label="Maintenance team">{props.engineers.map((u) => <option key={u.id} value={`user:${u.id}`}>{u.label}</option>)}</optgroup>}
        {props.vendors.length > 0 && <optgroup label="Vendors / contractors">{props.vendors.map((v) => <option key={v.id} value={`vendor:${v.id}`}>{v.label}</option>)}</optgroup>}
      </select>
      <input name="note" placeholder="Instruction (optional)" aria-label="Instruction" className={inputSm} />
      <button type="submit" disabled={pending} className={`${secondary} mt-3`}>{pending ? "Saving…" : "Assign"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function TriageForm(props: { workOrderId: string; categories: readonly string[]; category: string; priority: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(triageAction, {});
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="workOrderId" value={props.workOrderId} />
      <h3 className="font-medium">Triage</h3>
      <div className="grid grid-cols-2 gap-2">
        <select name="category" aria-label="Category" defaultValue={props.category} className={inputSm}>{props.categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select name="priority" aria-label="Priority" defaultValue={props.priority} className={inputSm}>
          <option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="URGENT">Urgent</option>
        </select>
      </div>
      <button type="submit" disabled={pending} className={`${secondary} mt-3`}>{pending ? "Saving…" : "Save triage"}</button>
      <Feedback state={state} />
    </form>
  );
}

const STATUS_LABEL: Partial<Record<WorkOrderStatus, string>> = {
  TRIAGED: "Mark triaged", IN_PROGRESS: "Start work", WAITING_STAFF: "Waiting for resident", WAITING_PARTS: "Waiting for parts",
  WAITING_ACCESS: "Waiting for access", RESOLVED: "Mark resolved", CLOSED: "Confirm and close", REOPENED: "Reopen", CANCELLED: "Cancel ticket",
};

export function StatusForm(props: { workOrderId: string; options: WorkOrderStatus[]; noteLabel?: string; compact?: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(statusAction, {});
  if (props.options.length === 0) return null;
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="workOrderId" value={props.workOrderId} />
      <h3 className="font-medium">Update status</h3>
      <label htmlFor={`status-note-${props.workOrderId}`} className="mt-2 block text-sm">{props.noteLabel ?? "Note (required to resolve, reopen or cancel)"}</label>
      <textarea id={`status-note-${props.workOrderId}`} name="note" rows={2} className={inputSm} />
      <div className="mt-3 flex flex-wrap gap-2">
        {props.options.map((s) => (
          <button key={s} type="submit" name="status" value={s} disabled={pending} className={s === "CANCELLED" || s === "REOPENED" ? "rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60 dark:border-red-800 dark:text-red-300" : s === "RESOLVED" || s === "CLOSED" ? "rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900" : secondary}>
            {STATUS_LABEL[s] ?? s}
          </button>
        ))}
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function NoteForm(props: { workOrderId: string; allowInternal: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(noteAction, {});
  return (
    <form action={action} encType="multipart/form-data" className={panel}>
      <input type="hidden" name="workOrderId" value={props.workOrderId} />
      <h3 className="font-medium">Add a note</h3>
      <textarea name="note" aria-label="Note" rows={2} className={inputSm} placeholder="Progress, questions, parts used…" />
      <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Photo" className="mt-2 block w-full text-sm" />
      {props.allowInternal && (
        <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" name="internal" /> Internal note (hidden from the requester and vendors)</label>
      )}
      <button type="submit" disabled={pending} className={`${secondary} mt-3`}>{pending ? "Posting…" : "Post note"}</button>
      <Feedback state={state} />
    </form>
  );
}
