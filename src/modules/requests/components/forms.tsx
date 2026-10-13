"use client";

import { useActionState } from "react";
import { decideRequestAction, withdrawRequestAction, type ActionState, reassignStepAction } from "../actions";
import type { Role } from "@prisma/client";

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p role="status" className="mt-2 text-sm text-green-700">{state.message}</p>;
  return null;
}

const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";
const panel = "card p-4";

export function DecisionForm({ requestId, requireComment, stepName }: { requestId: string; requireComment: boolean; stepName: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(decideRequestAction, {});
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="requestId" value={requestId} />
      <h3 className="font-medium">Your decision · {stepName}</h3>
      <label htmlFor="decision-comment" className="mt-2 block text-sm">Comment{requireComment ? " (required)" : " (required to reject or return)"}</label>
      <textarea id="decision-comment" name="comment" rows={2} className={input} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" name="action" value="APPROVE" disabled={pending} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink disabled:opacity-60">Approve</button>
        <button type="submit" name="action" value="REQUEST_CHANGES" disabled={pending} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-60">Request changes</button>
        <button type="submit" name="action" value="REJECT" disabled={pending} className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60">Reject</button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function WithdrawForm({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(withdrawRequestAction, {});
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="requestId" value={requestId} />
      <h3 className="font-medium">Withdraw this request</h3>
      <label htmlFor="withdraw-reason" className="mt-2 block text-sm">Reason (optional)</label>
      <input id="withdraw-reason" name="reason" className={input} />
      <button type="submit" disabled={pending} className="mt-3 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60">
        {pending ? "Withdrawing…" : "Withdraw"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function ReassignForm({ requestId, currentRole, roles }: { requestId: string; currentRole: Role; roles: Role[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reassignStepAction, {});
  return (
    <form action={action} className="card p-4" data-reassign>
      <input type="hidden" name="requestId" value={requestId} />
      <h3 className="font-medium">Reassign this step</h3>
      <p className="mt-1 text-xs text-zinc-500">Currently with the {currentRole.toLowerCase().replaceAll("_", " ")}. Use this when the usual approver is unavailable; the new role&apos;s holders are notified.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <label className="block text-sm">To role<select name="role" defaultValue="" className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"><option value="">Choose…</option>{roles.filter((r) => r !== currentRole).map((r) => <option key={r} value={r}>{r.toLowerCase().replaceAll("_", " ")}</option>)}</select></label>
        <label className="block text-sm">Reason *<input name="reason" className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" /></label>
        <button type="submit" disabled={pending} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-60">{pending ? "Saving…" : "Reassign"}</button>
      </div>
      {state.error && <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>}
      {state.message && <p role="status" className="mt-2 text-sm text-green-700">{state.message}</p>}
    </form>
  );
}
