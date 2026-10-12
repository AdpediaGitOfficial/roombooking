"use client";

import { useActionState } from "react";
import { decideRequestAction, withdrawRequestAction, type ActionState } from "../actions";

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{state.error}</p>;
  if (state.message) return <p role="status" className="mt-2 text-sm text-green-700 dark:text-green-300">{state.message}</p>;
  return null;
}

const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const panel = "rounded-lg border border-zinc-200 p-4 dark:border-zinc-800";

export function DecisionForm({ requestId, requireComment, stepName }: { requestId: string; requireComment: boolean; stepName: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(decideRequestAction, {});
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="requestId" value={requestId} />
      <h3 className="font-medium">Your decision · {stepName}</h3>
      <label htmlFor="decision-comment" className="mt-2 block text-sm">Comment{requireComment ? " (required)" : " (required to reject or return)"}</label>
      <textarea id="decision-comment" name="comment" rows={2} className={input} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" name="action" value="APPROVE" disabled={pending} className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900">Approve</button>
        <button type="submit" name="action" value="REQUEST_CHANGES" disabled={pending} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-60 dark:border-zinc-700">Request changes</button>
        <button type="submit" name="action" value="REJECT" disabled={pending} className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60 dark:border-red-800 dark:text-red-300">Reject</button>
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
      <button type="submit" disabled={pending} className="mt-3 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60 dark:border-red-800 dark:text-red-300">
        {pending ? "Withdrawing…" : "Withdraw"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
