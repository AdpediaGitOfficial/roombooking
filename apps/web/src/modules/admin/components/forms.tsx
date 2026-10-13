"use client";

import { useActionState, useState } from "react";
import type { Role } from "@prisma/client";
import { ROLE_DESCRIPTIONS } from "@sam/core/modules/admin/access";
import { acceptInviteAction, addRoleAction, createUserAction, removeRoleAction, signOutEverywhereAction, statusAction, tokenAction, updateUserAction, type ActionState, type FormState } from "../actions";

function Feedback({ state }: { state: ActionState | FormState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>;
  if ("message" in state && state.message) return <p role="status" className="mt-2 text-sm text-green-700">{state.message}</p>;
  if ("values" in state && state.values?.message) return <p role="status" className="mt-2 text-sm text-green-700">{state.values.message}</p>;
  return null;
}
const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";
const primary = "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink disabled:opacity-60";
const secondary = "rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-60";
const danger = "rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60";
const panel = "card p-4";

type Opt = { id: string; name: string };
export type ScopeOptions = { sites: Opt[]; buildings: Opt[]; vendors: Opt[] };
type StaffOpt = { id: string; employeeId: string; firstName: string; lastName: string };

function ScopeSelect({ name, defaultValue, options }: { name: string; defaultValue?: string; options: ScopeOptions }) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} aria-label="Scope" className={input}>
      <option value="">All sites</option>
      <optgroup label="Site">{options.sites.map((s) => <option key={s.id} value={`site:${s.id}`}>{s.name}</option>)}</optgroup>
      <optgroup label="Building">{options.buildings.map((b) => <option key={b.id} value={`building:${b.id}`}>{b.name}</option>)}</optgroup>
    </select>
  );
}

export function CreateUserForm({ options, staff, roles }: { options: ScopeOptions; staff: StaffOpt[]; roles: Role[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createUserAction, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const [vendorRole, setVendorRole] = useState(v.roles === "VENDOR");
  return (
    <form key={state.values ? JSON.stringify(state.values) : "initial"} action={action} noValidate className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">Full name *<input name="name" defaultValue={v.name ?? ""} className={input} />{e.name && <span role="alert" className="text-xs text-red-700">{e.name}</span>}</label>
        <label className="block text-sm">Email *<input name="email" type="email" defaultValue={v.email ?? ""} className={input} />{e.email && <span role="alert" className="text-xs text-red-700">{e.email}</span>}</label>
        <label className="block text-sm">Link to staff record<select name="staffProfileId" defaultValue={v.staffProfileId ?? ""} className={input}><option value="">None</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.lastName}, {s.firstName} ({s.employeeId})</option>)}</select>{e.staffProfileId && <span role="alert" className="text-xs text-red-700">{e.staffProfileId}</span>}</label>
        <label className="block text-sm">Vendor (contractor accounts)<select name="vendorId" defaultValue={v.vendorId ?? ""} className={input}><option value="">None</option>{options.vendors.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>{e.vendorId && <span role="alert" className="text-xs text-red-700">{e.vendorId}</span>}</label>
        {vendorRole && <label className="block text-sm">Access expires<input type="date" name="accessExpiresAt" defaultValue={v.accessExpiresAt ?? ""} className={input} /><span className="text-xs text-zinc-500">Contractor sessions end at this date.</span></label>}
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Roles *</legend>
        {e.roles && <p role="alert" className="text-xs text-red-700">{e.roles}</p>}
        <ul className="mt-2 divide-y divide-zinc-200 card">
          {roles.map((role) => (
            <li key={role} className="grid gap-2 p-3 sm:grid-cols-[1fr_220px]">
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" name="roles" value={role} defaultChecked={false} className="mt-1" onChange={(ev) => role === "VENDOR" && setVendorRole(ev.target.checked)} />
                <span><span className="font-medium">{role.toLowerCase().replace(/_/g, " ")}</span><span className="block text-xs text-zinc-500">{ROLE_DESCRIPTIONS[role]}</span></span>
              </label>
              <ScopeSelect name={`scope_${role}`} options={options} />
            </li>
          ))}
        </ul>
      </fieldset>
      {state.error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className={primary}>{pending ? "Creating…" : "Create and generate invite link"}</button>
    </form>
  );
}

export function EditUserForm(props: { userId: string; name: string; email: string; staffProfileId: string; vendorId: string; accessExpiresAt: string; options: ScopeOptions; staff: StaffOpt[]; isVendor: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateUserAction, {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className={panel} noValidate>
      <input type="hidden" name="userId" value={props.userId} />
      <h3 className="font-medium">Details</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Full name<input name="name" defaultValue={props.name} className={input} />{e.name && <span role="alert" className="text-xs text-red-700">{e.name}</span>}</label>
        <label className="block text-sm">Email<input name="email" type="email" defaultValue={props.email} className={input} />{e.email && <span role="alert" className="text-xs text-red-700">{e.email}</span>}</label>
        <label className="block text-sm">Staff record<select name="staffProfileId" defaultValue={props.staffProfileId} className={input}><option value="">None</option>{props.staff.map((s) => <option key={s.id} value={s.id}>{s.lastName}, {s.firstName} ({s.employeeId})</option>)}</select>{e.staffProfileId && <span role="alert" className="text-xs text-red-700">{e.staffProfileId}</span>}</label>
        <label className="block text-sm">Vendor<select name="vendorId" defaultValue={props.vendorId} className={input}><option value="">None</option>{props.options.vendors.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>{e.vendorId && <span role="alert" className="text-xs text-red-700">{e.vendorId}</span>}</label>
        {(props.isVendor || props.accessExpiresAt) && <label className="block text-sm">Access expires<input type="date" name="accessExpiresAt" defaultValue={props.accessExpiresAt} className={input} /></label>}
      </div>
      <button type="submit" disabled={pending} className={`${secondary} mt-3`}>{pending ? "Saving…" : "Save details"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function AddRoleForm({ userId, options, roles }: { userId: string; options: ScopeOptions; roles: Role[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addRoleAction, {});
  return (
    <form action={action} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <input type="hidden" name="userId" value={userId} />
      <select name="role" aria-label="Role" className={input}>{roles.map((r) => <option key={r} value={r}>{r.toLowerCase().replace(/_/g, " ")}</option>)}</select>
      <ScopeSelect name="scope" options={options} />
      <button type="submit" disabled={pending} className={`${secondary} mt-1`}>{pending ? "Adding…" : "Grant role"}</button>
      <div className="sm:col-span-3"><Feedback state={state} /></div>
    </form>
  );
}

export function RemoveRoleButton({ userId, assignmentId }: { userId: string; assignmentId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(removeRoleAction, {});
  return (
    <form action={action} className="inline">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <button type="submit" disabled={pending} className="text-xs text-red-700 underline disabled:opacity-60">Remove</button>
      {state.error && <span role="alert" className="ml-2 text-xs text-red-700">{state.error}</span>}
    </form>
  );
}

export function StatusForm({ userId, status, hasPassword }: { userId: string; status: string; hasPassword: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(statusAction, {});
  const canActivate = status !== "ACTIVE" && hasPassword;
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="userId" value={userId} />
      <h3 className="font-medium">Account status</h3>
      <label className="mt-2 block text-sm">Reason (required to suspend or deactivate)<input name="reason" className={input} /></label>
      <div className="mt-3 flex flex-wrap gap-2">
        {canActivate && <button type="submit" name="status" value="ACTIVE" disabled={pending} className={primary}>{status === "SUSPENDED" ? "Reactivate" : "Activate"}</button>}
        {status === "ACTIVE" && <button type="submit" name="status" value="SUSPENDED" disabled={pending} className={secondary}>Suspend</button>}
        {status !== "DEACTIVATED" && <button type="submit" name="status" value="DEACTIVATED" disabled={pending} className={danger}>Deactivate</button>}
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function TokenForm({ userId, purpose, initialLink }: { userId: string; purpose: "INVITE" | "RESET"; initialLink?: string | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(tokenAction, initialLink ? { message: "Invite link created. Share it with the person; it works once.", link: initialLink } : {});
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="purpose" value={purpose} />
      <h3 className="font-medium">{purpose === "INVITE" ? "Invite link" : "Password reset"}</h3>
      <p className="mt-1 text-xs text-zinc-500">{purpose === "INVITE" ? "The person sets their password from this one-time link." : "Creates a one-time link to set a new password; existing sessions end when it is used."}</p>
      <button type="submit" disabled={pending} className={`${secondary} mt-3`}>{pending ? "Working…" : purpose === "INVITE" ? "Generate invite link" : "Generate reset link"}</button>
      <Feedback state={state} />
      {state.link && (
        <div className="mt-2">
          <input readOnly data-invite-link value={typeof window !== "undefined" ? `${window.location.origin}${state.link}` : state.link} onFocus={(ev) => ev.currentTarget.select()} className={`${input} font-mono text-xs`} />
        </div>
      )}
    </form>
  );
}

export function SignOutEverywhereForm({ userId, sessions }: { userId: string; sessions: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(signOutEverywhereAction, {});
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="userId" value={userId} />
      <h3 className="font-medium">Sessions</h3>
      <p className="mt-1 text-sm text-zinc-600" data-sessions={sessions}>{sessions} active session{sessions === 1 ? "" : "s"}.</p>
      <button type="submit" disabled={pending || sessions === 0} className={`${secondary} mt-3`}>{pending ? "Working…" : "Sign out everywhere"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(acceptInviteAction, {});
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} noValidate>
      <input type="hidden" name="token" value={token} />
      <label htmlFor="password" className="block text-sm font-medium">Choose a password</label>
      <input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-3 text-base" />
      <p className="mt-1 text-xs text-zinc-500">At least 10 characters with letters and numbers.</p>
      {e.password && <p role="alert" className="mt-1 text-sm text-red-700">{e.password}</p>}
      <label htmlFor="confirmPassword" className="mt-4 block text-sm font-medium">Confirm password</label>
      <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-3 text-base" />
      {state.error && <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="mt-6 w-full rounded-md bg-primary px-4 py-3 text-base font-medium text-primary-ink disabled:opacity-60">{pending ? "Saving…" : "Set password and sign in"}</button>
    </form>
  );
}
