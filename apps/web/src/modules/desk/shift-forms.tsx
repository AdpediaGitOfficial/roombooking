"use client";

import { useActionState } from "react";
import { endShiftAction, startShiftAction, type ActionState } from "./actions";

const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";
function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p role="status" className="mt-2 text-sm text-green-700">{state.message}</p>;
  return null;
}

export function ShiftControls({ open, sites }: { open: { startedAt: string } | null; sites: Array<{ id: string; name: string }> }) {
  const [ss, sa, sp] = useActionState<ActionState, FormData>(startShiftAction, {});
  const [es, ea, ep] = useActionState<ActionState, FormData>(endShiftAction, {});
  if (open) {
    return (
      <form action={ea} className="card p-4">
        <h3 className="font-medium">Shift in progress</h3>
        <p className="mt-1 text-sm text-zinc-600">Started {open.startedAt.replace("T", " ").slice(0, 16)} UTC. The summary of what you did is added automatically.</p>
        <label className="mt-2 block text-sm">Handover notes<textarea name="notes" rows={3} className={input} placeholder="Anything the next shift should know" /></label>
        <button type="submit" disabled={ep} className="mt-3 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink disabled:opacity-60">End shift</button>
        <Feedback state={es} />
      </form>
    );
  }
  return (
    <form action={sa} className="card p-4">
      <h3 className="font-medium">Start a shift</h3>
      {sites.length > 1 && <label className="mt-2 block text-sm">Site<select name="siteId" className={input}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      {sites.length === 1 && <input type="hidden" name="siteId" value={sites[0].id} />}
      <button type="submit" disabled={sp} className="mt-3 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink disabled:opacity-60">Start shift</button>
      <Feedback state={ss} />
    </form>
  );
}
