"use client";

import { useActionState } from "react";
import { cancelAction, composeAction, sendAction, type FormState } from "../actions";

function Feedback({ state }: { state: FormState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p role="status" className="mt-2 text-sm text-green-700">{state.message}</p>;
  return null;
}
const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";
const primary = "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink disabled:opacity-60";
const secondary = "rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-60";
const danger = "rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60";
const panel = "card p-4";
const err = (m?: string) => (m ? <span role="alert" className="text-xs text-red-700">{m}</span> : null);
type Opt = { id: string; label: string; hint?: string; siteId?: string };

export type ComposeDefaults = { broadcastId?: string; title: string; body: string; roles: string[]; siteIds: string[]; buildingIds: string[]; emailCopy: boolean; whatsappCopy: boolean };

export function ComposeForm({ options, defaults }: { options: { sites: Opt[]; buildings: Opt[]; roles: Opt[] }; defaults: ComposeDefaults }) {
  const [state, action, pending] = useActionState<FormState, FormData>(composeAction, {});
  const v = state.values;
  const e = state.fieldErrors ?? {};
  const roles = v ? v.roles.split(",").filter(Boolean) : defaults.roles;
  const siteIds = v ? v.siteIds.split(",").filter(Boolean) : defaults.siteIds;
  const buildingIds = v ? v.buildingIds.split(",").filter(Boolean) : defaults.buildingIds;
  const check = "h-4 w-4";
  return (
    <form key={v ? JSON.stringify(v) : "initial"} action={action} className={panel} noValidate data-compose>
      {(v?.broadcastId || defaults.broadcastId) && <input type="hidden" name="broadcastId" value={v?.broadcastId || defaults.broadcastId} />}
      <h3 className="font-medium">{defaults.broadcastId ? "Edit draft" : "New broadcast"}</h3>
      <div className="mt-2 grid gap-3">
        <label className="block text-sm">Title *<input name="title" maxLength={120} defaultValue={v ? v.title : defaults.title} className={input} />{err(e.title)}</label>
        <label className="block text-sm">Message *<textarea name="body" rows={5} maxLength={2000} defaultValue={v ? v.body : defaults.body} className={input} placeholder="What people need to know, and what to do. Sent as written by email and in the app; WhatsApp carries the title only." />{err(e.body)}</label>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <fieldset data-audience="roles">
          <legend className="text-sm font-medium">Who <span className="font-normal text-zinc-500">(none ticked = everyone)</span></legend>
          <div className="mt-1 space-y-1">{options.roles.map((r) => <label key={r.id} className="flex items-center gap-2 text-sm" title={r.hint}><input type="checkbox" name="roles" value={r.id} defaultChecked={roles.includes(r.id)} className={check} />{r.label}</label>)}</div>
        </fieldset>
        <fieldset data-audience="sites">
          <legend className="text-sm font-medium">Sites <span className="font-normal text-zinc-500">(none = all)</span></legend>
          <div className="mt-1 space-y-1">{options.sites.map((s) => <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="siteIds" value={s.id} defaultChecked={siteIds.includes(s.id)} className={check} />{s.label}</label>)}</div>
        </fieldset>
        <fieldset data-audience="buildings">
          <legend className="text-sm font-medium">Buildings</legend>
          <div className="mt-1 space-y-1">{options.buildings.map((b) => <label key={b.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="buildingIds" value={b.id} defaultChecked={buildingIds.includes(b.id)} className={check} />{b.label}</label>)}</div>
        </fieldset>
      </div>
      {err(e.audience)}
      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="emailCopy" defaultChecked={v ? v.emailCopy === "on" : defaults.emailCopy} className={check} /> Also send by email (to people who allow it)</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="whatsappCopy" defaultChecked={v ? v.whatsappCopy === "on" : defaults.whatsappCopy} className={check} /> Also send on WhatsApp (title only, to people who opted in)</label>
      </div>
      {state.preview && (
        <p data-preview className="mt-3 rounded-lg bg-zinc-50 p-3 text-sm">
          <span className="font-medium">{state.preview.count} {state.preview.count === 1 ? "person" : "people"}</span> {state.preview.count === 1 ? "matches" : "match"} this audience{state.preview.sample.length ? `: ${state.preview.sample.join(", ")}${state.preview.count > state.preview.sample.length ? ", …" : ""}` : "."}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" name="intent" value="preview" disabled={pending} className={secondary}>Preview audience</button>
        <button type="submit" name="intent" value="draft" disabled={pending} className={secondary}>Save draft</button>
        <button type="submit" name="intent" value="send" disabled={pending} className={primary}>{pending ? "Working…" : "Send now"}</button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function SendButton({ broadcastId }: { broadcastId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(sendAction, {});
  return <form action={action} className="inline-block"><input type="hidden" name="broadcastId" value={broadcastId} /><button type="submit" disabled={pending} className={primary} data-send>{pending ? "Sending…" : "Send now"}</button><Feedback state={state} /></form>;
}

export function CancelButton({ broadcastId }: { broadcastId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(cancelAction, {});
  return <form action={action} className="inline-block"><input type="hidden" name="broadcastId" value={broadcastId} /><button type="submit" disabled={pending} className={danger} data-cancel>Cancel draft</button><Feedback state={state} /></form>;
}
