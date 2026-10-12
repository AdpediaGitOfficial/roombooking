"use client";

import { useActionState } from "react";
import type { BedStatus, RoomStatus } from "@prisma/client";
import { addBeds, setBedStatus, setRoomStatus, type ActionState } from "../actions";

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{state.error}</p>;
  if (state.message) return <p role="status" className="mt-2 text-sm text-green-700 dark:text-green-300">{state.message}</p>;
  return null;
}

const input = "rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const button = "rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-60 dark:border-zinc-700";

export function AddBedsForm({ roomId }: { roomId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addBeds, {});
  return (
    <form action={action} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <input type="hidden" name="roomId" value={roomId} />
      <label htmlFor="count" className="block text-sm font-medium">Add beds</label>
      <div className="mt-2 flex items-center gap-2">
        <input id="count" name="count" type="number" min={1} max={20} defaultValue={1} inputMode="numeric" className={`${input} w-24`} />
        <button type="submit" disabled={pending} className={button}>{pending ? "Adding…" : "Add"}</button>
      </div>
      <p className="mt-1 text-xs text-zinc-500">Bed codes continue the room&apos;s numbering.</p>
      <Feedback state={state} />
    </form>
  );
}

export function BedStatusForm({ bedId, current }: { bedId: string; current: BedStatus }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setBedStatus, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="bedId" value={bedId} />
      <select name="status" defaultValue={current} aria-label="Bed status" className={input}>
        <option value="ACTIVE">In service</option>
        <option value="BLOCKED">Blocked</option>
        <option value="RETIRED">Retired</option>
      </select>
      <input name="reason" placeholder="Reason (required to block)" aria-label="Reason" className={`${input} w-44`} />
      <button type="submit" disabled={pending} className={button}>{pending ? "Saving…" : "Apply"}</button>
      <div className="basis-full"><Feedback state={state} /></div>
    </form>
  );
}

export function RoomStatusForm({ roomId, current }: { roomId: string; current: RoomStatus }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setRoomStatus, {});
  return (
    <form action={action} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <input type="hidden" name="roomId" value={roomId} />
      <label htmlFor="room-status" className="block text-sm font-medium">Room status</label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select id="room-status" name="status" defaultValue={current} className={input}>
          <option value="ACTIVE">Active</option>
          <option value="BLOCKED">Blocked</option>
          <option value="INACTIVE">Inactive</option>
        </select>
        <input name="reason" placeholder="Reason (required unless active)" aria-label="Reason" className={`${input} w-56`} />
        <button type="submit" disabled={pending} className={button}>{pending ? "Saving…" : "Apply"}</button>
      </div>
      <p className="mt-1 text-xs text-zinc-500">Blocking a room marks all its unoccupied beds as blocked.</p>
      <Feedback state={state} />
    </form>
  );
}
