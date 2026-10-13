"use client";

import { useActionState, useState } from "react";
import { movementAction, type FormState } from "../actions";

const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";

/** Pick an item from the register and issue it to a fixed target (used on the allocation page). */
export function IssuePicker({ items, target, returnPath }: { items: Array<{ id: string; label: string; serialised: boolean; unit: string }>; target: string; returnPath: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(movementAction, {});
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const item = items.find((i) => i.id === itemId);
  return (
    <form action={action} className="mt-2" data-issue-picker>
      <input type="hidden" name="kind" value="ISSUE" />
      <input type="hidden" name="target" value={target} />
      <input type="hidden" name="returnPath" value={returnPath} />
      <input type="hidden" name="itemId" value={itemId} />
      <div className="grid gap-2 sm:grid-cols-[1fr_6rem_auto] sm:items-end">
        <label className="block text-sm">Item<select value={itemId} onChange={(e) => setItemId(e.target.value)} className={input}>{items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select></label>
        {item && !item.serialised ? <label className="block text-sm">Qty<input type="number" name="quantity" min={1} defaultValue={1} className={input} /></label> : <span />}
        <button type="submit" disabled={pending || !itemId} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink disabled:opacity-60">{pending ? "Issuing…" : "Issue"}</button>
      </div>
      {state.error && <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>}
      {state.message && <p role="status" className="mt-2 text-sm text-green-700">{state.message}</p>}
    </form>
  );
}
