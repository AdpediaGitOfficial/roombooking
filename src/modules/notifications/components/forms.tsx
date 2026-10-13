"use client";

import { useActionState } from "react";
import { retryAction, runWorkerAction, sendTestEmailAction, setEmailPreferenceAction, type ActionState } from "../actions";

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{state.error}</p>;
  if (state.message) return <p role="status" className="mt-2 text-sm text-green-700 dark:text-green-300">{state.message}</p>;
  return null;
}
const secondary = "rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-60 dark:border-zinc-700";

export function RunWorkerButton() {
  const [state, action, pending] = useActionState<ActionState, FormData>(async () => runWorkerAction(), {});
  return <form action={action}><button type="submit" disabled={pending} className={secondary} data-run-worker>{pending ? "Running…" : "Run delivery now"}</button><Feedback state={state} /></form>;
}

export function SendTestEmailButton() {
  const [state, action, pending] = useActionState<ActionState, FormData>(async () => sendTestEmailAction(), {});
  return <form action={action}><button type="submit" disabled={pending} className={secondary} data-send-test>{pending ? "Sending…" : "Send me a test email"}</button><Feedback state={state} /></form>;
}

export function RetryButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(retryAction, {});
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="text-xs underline disabled:opacity-60">Retry</button>
      {state.error && <span role="alert" className="ml-2 text-xs text-red-700 dark:text-red-300">{state.error}</span>}
    </form>
  );
}

export function EmailPreferenceForm({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setEmailPreferenceAction, {});
  return (
    <form action={action}>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="emailNotifications" defaultChecked={enabled} className="mt-1 h-5 w-5" />
        <span>Email me a copy of notifications (allocation, requests, maintenance, keys)</span>
      </label>
      <button type="submit" disabled={pending} className={`${secondary} mt-3`}>{pending ? "Saving…" : "Save preference"}</button>
      <Feedback state={state} />
    </form>
  );
}
