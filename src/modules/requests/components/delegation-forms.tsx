"use client";

import { useActionState, useState } from "react";
import type { Role } from "@prisma/client";
import { createDelegationAction, revokeDelegationAction, type DelegationState } from "../delegation-actions";

function Feedback({ state }: { state: DelegationState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p role="status" className="mt-2 text-sm text-green-700">{state.message}</p>;
  return null;
}
const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";
const primary = "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink disabled:opacity-60";
const danger = "rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60";
const panel = "card p-4";
const err = (m?: string) => (m ? <span role="alert" className="text-xs text-red-700">{m}</span> : null);
type Opt = { id: string; label: string };
const roleLabel = (r: string) => r.toLowerCase().replaceAll("_", " ");

export function CreateDelegationForm({ me, delegators, delegates, today }: { me: { id: string; roles: Role[] }; delegators: Array<Opt & { roles: Role[] }> | null; delegates: Opt[]; today: string }) {
  const [state, action, pending] = useActionState<DelegationState, FormData>(createDelegationAction, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const [delegatorId, setDelegatorId] = useState(v.delegatorId ?? me.id);
  const roles = delegators ? (delegators.find((d) => d.id === delegatorId)?.roles ?? []) : me.roles;
  const chosen = v.roles ? v.roles.split(",") : [];
  return (
    <form key={state.values ? JSON.stringify(state.values) : "initial"} action={action} className={panel} noValidate data-create-delegation>
      <h3 className="font-medium">{delegators ? "Arrange cover" : "Delegate my approvals"}</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {delegators ? (
          <label className="block text-sm">Whose approvals<select name="delegatorId" value={delegatorId} onChange={(ev) => setDelegatorId(ev.target.value)} className={input}>{delegators.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select>{err(e.delegatorId)}</label>
        ) : <input type="hidden" name="delegatorId" value={me.id} />}
        <label className="block text-sm">Covered by<select name="delegateId" defaultValue={v.delegateId ?? ""} className={input}><option value="">Choose…</option>{delegates.filter((d) => d.id !== delegatorId).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select>{err(e.delegateId)}</label>
        <label className="block text-sm">From<input type="date" name="startsAt" min={today} defaultValue={v.startsAt ?? today} className={input} />{err(e.startsAt)}</label>
        <label className="block text-sm">To<input type="date" name="endsAt" min={today} defaultValue={v.endsAt ?? ""} className={input} />{err(e.endsAt)}</label>
        <label className="block text-sm sm:col-span-2">Reason <span className="text-zinc-500">(optional)</span><input name="reason" defaultValue={v.reason ?? ""} placeholder="e.g. Annual leave" className={input} /></label>
        <fieldset className="sm:col-span-2 text-sm">
          <legend className="font-medium">Roles to cover <span className="font-normal text-zinc-500">(none ticked = all)</span></legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {roles.map((r) => <label key={r} className="flex items-center gap-2"><input type="checkbox" name="roles" value={r} defaultChecked={chosen.includes(r)} /> {roleLabel(r)}</label>)}
            {roles.length === 0 && <span className="text-zinc-500">This person holds no approver role.</span>}
          </div>
          {err(e.roles)}
        </fieldset>
      </div>
      <p className="mt-2 text-xs text-zinc-500">The cover sees and decides these steps between the dates, marked as acting on behalf. Cover never applies to the delegator&apos;s own requests and cannot be passed on.</p>
      <button type="submit" disabled={pending || roles.length === 0} className={`${primary} mt-3`}>{pending ? "Saving…" : "Arrange cover"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function RevokeButton({ delegationId, label }: { delegationId: string; label: string }) {
  const [state, action, pending] = useActionState<DelegationState, FormData>(revokeDelegationAction, {});
  return <form action={action} className="inline-block"><input type="hidden" name="delegationId" value={delegationId} /><button type="submit" disabled={pending} className={danger} data-revoke={delegationId}>{pending ? "Ending…" : label}</button>{state.error && <span role="alert" className="ml-2 text-xs text-red-700">{state.error}</span>}</form>;
}
