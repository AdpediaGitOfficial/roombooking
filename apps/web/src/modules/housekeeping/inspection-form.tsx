"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import { Feedback } from "@/components/forms/action-form";

/** Pass / fail per checklist item; a failed item needs a note and becomes a work order. */
export function InspectionForm({ action, inspectionId, items }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; inspectionId: string; items: Array<{ id: string; label: string }> }) {
  const [state, run, pending] = useActionState<ActionState, FormData>(action, {});
  return (
    <form action={run} className="card p-4">
      <input type="hidden" name="inspectionId" value={inspectionId} />
      <ul className="divide-y divide-zinc-100">
        {items.map((i) => (
          <li key={i.id} className="py-3 text-sm">
            <input type="hidden" name="item" value={i.id} />
            <div className="font-medium">{i.label}</div>
            <div className="mt-1 flex gap-4"><label className="flex items-center gap-1"><input type="radio" name={`ok:${i.id}`} value="ok" defaultChecked /> Pass</label><label className="flex items-center gap-1"><input type="radio" name={`ok:${i.id}`} value="fail" /> Fail</label></div>
            <input name={`note:${i.id}`} placeholder="Note (required if failed)" className="mt-2 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
          </li>
        ))}
      </ul>
      <label className="mt-3 block text-sm">Overall notes<textarea name="notes" rows={2} className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" /></label>
      <button type="submit" disabled={pending} className="mt-3 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink disabled:opacity-60">{pending ? "Saving…" : "Submit inspection"}</button>
      <Feedback state={state} />
    </form>
  );
}
