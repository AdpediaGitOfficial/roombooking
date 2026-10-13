"use client";

import { useActionState } from "react";
import { retryAction, runWorkerAction, sendTestEmailAction, sendTestWhatsAppAction, setEmailPreferenceAction, setWhatsAppPreferenceAction, type ActionState } from "../actions";

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

export function SendTestWhatsAppButton() {
  const [state, action, pending] = useActionState<ActionState, FormData>(async () => sendTestWhatsAppAction(), {});
  return <form action={action}><button type="submit" disabled={pending} className={secondary} data-send-test-whatsapp>{pending ? "Sending…" : "Send me a test WhatsApp"}</button><Feedback state={state} /></form>;
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

export function WhatsAppPreferenceForm({ number, enabled, consentAt, suggestedNumber }: { number: string; enabled: boolean; consentAt: string | null; suggestedNumber?: string | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setWhatsAppPreferenceAction, {});
  // After a validation error the form is remounted with what was typed, so a correction does not start from scratch.
  const v = state.values;
  return (
    <form key={v ? JSON.stringify(v) : "initial"} action={action} data-whatsapp-preference>
      <label className="block text-sm">WhatsApp number<input name="whatsappNumber" type="tel" defaultValue={v ? v.whatsappNumber : number || suggestedNumber || ""} placeholder="+971 50 123 4567" className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" /></label>
      <label className="mt-3 flex items-start gap-3 text-sm">
        <input type="checkbox" name="whatsappNotifications" defaultChecked={v ? v.whatsappNotifications === "on" : enabled} className="mt-1 h-5 w-5" />
        <span>Send me WhatsApp messages about my accommodation (allocation, requests, maintenance, bookings, lost and found)</span>
      </label>
      <label className="mt-2 flex items-start gap-3 text-sm">
        <input type="checkbox" name="whatsappConsent" defaultChecked={v ? v.whatsappConsent === "on" : !!consentAt} className="mt-1 h-5 w-5" />
        <span>I agree to receive these messages on WhatsApp from the accommodation office. Messages contain no room numbers or personal details; open the portal for those. I can withdraw this at any time here.{consentAt && <span className="block text-xs text-zinc-500">Consent recorded {consentAt}</span>}</span>
      </label>
      <button type="submit" disabled={pending} className={`${secondary} mt-3`}>{pending ? "Saving…" : "Save WhatsApp settings"}</button>
      <Feedback state={state} />
    </form>
  );
}
