"use client";

import { useActionState } from "react";
import { itemAction, myClaimAction, registerItemAction, updateItemAction, type FormState } from "../actions";

function Feedback({ state }: { state: FormState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{state.error}</p>;
  if (state.message) return <p role="status" className="mt-2 text-sm text-green-700 dark:text-green-300">{state.message}</p>;
  return null;
}
const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const primary = "rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900";
const secondary = "rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-60 dark:border-zinc-700";
const danger = "rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60 dark:border-red-800 dark:text-red-300";
const panel = "rounded-lg border border-zinc-200 p-4 dark:border-zinc-800";
const err = (m?: string) => (m ? <span role="alert" className="text-xs text-red-700 dark:text-red-300">{m}</span> : null);
type Opt = { id: string; label: string };

export function RegisterItemForm({ sites, categories, defaultFoundAt, retentionDays }: { sites: Opt[]; categories: readonly string[]; defaultFoundAt: string; retentionDays: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(registerItemAction, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form key={state.values ? JSON.stringify(state.values) : "initial"} action={action} encType="multipart/form-data" className={panel} noValidate data-register-item>
      <h3 className="font-medium">Register a found item</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <label className="block text-sm sm:col-span-2">Description *<input name="description" defaultValue={v.description ?? ""} placeholder="Colour, brand, distinguishing marks" className={input} />{err(e.description)}</label>
        <label className="block text-sm">Category<select name="category" defaultValue={v.category ?? ""} className={input}><option value="">Choose…</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="block text-sm">Found where<input name="foundLocation" defaultValue={v.foundLocation ?? ""} placeholder="e.g. Canteen, Block A corridor" className={input} /></label>
        <label className="block text-sm">Found when *<input type="datetime-local" name="foundAt" defaultValue={v.foundAt ?? defaultFoundAt} className={input} />{err(e.foundAt)}</label>
        <label className="block text-sm">Found by<input name="foundByName" defaultValue={v.foundByName ?? ""} placeholder="Name of finder" className={input} /></label>
        <label className="block text-sm">Site<select name="siteId" defaultValue={v.siteId ?? sites[0]?.id ?? ""} className={input}>{sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label className="block text-sm">Stored at <span className="text-zinc-500">(leave blank if not yet stored)</span><input name="storageLocation" defaultValue={v.storageLocation ?? ""} className={input} /></label>
        <label className="block text-sm">Keep for (days)<input type="number" name="retentionDays" min={1} defaultValue={v.retentionDays ?? String(retentionDays)} className={input} />{err(e.retentionDays)}</label>
        <label className="block text-sm sm:col-span-2">Photos<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple className="mt-1 block w-full text-sm" />{err(e.photos)}</label>
        <label className="block text-sm">Notes<input name="notes" defaultValue={v.notes ?? ""} className={input} /></label>
      </div>
      <button type="submit" disabled={pending} className={`${primary} mt-3`}>{pending ? "Saving…" : "Register"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function EditItemForm({ item, categories }: { item: { id: string; description: string; category: string | null; foundLocation: string | null; foundByName: string | null; notes: string | null; retainUntil: string | null }; categories: readonly string[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateItemAction, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  return (
    <form key={state.values ? JSON.stringify(state.values) : "initial"} action={action} className={panel} noValidate data-edit-item>
      <input type="hidden" name="itemId" value={item.id} />
      <h3 className="font-medium">Edit details</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">Description *<input name="description" defaultValue={v.description ?? item.description} className={input} />{err(e.description)}</label>
        <label className="block text-sm">Category<select name="category" defaultValue={v.category ?? item.category ?? ""} className={input}><option value="">None</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="block text-sm">Found where<input name="foundLocation" defaultValue={v.foundLocation ?? item.foundLocation ?? ""} className={input} /></label>
        <label className="block text-sm">Found by<input name="foundByName" defaultValue={v.foundByName ?? item.foundByName ?? ""} className={input} /></label>
        <label className="block text-sm">Keep until<input type="date" name="retainUntil" defaultValue={v.retainUntil ?? item.retainUntil ?? ""} className={input} />{err(e.retainUntil)}</label>
        <label className="block text-sm sm:col-span-2">Notes<input name="notes" defaultValue={v.notes ?? item.notes ?? ""} className={input} /></label>
      </div>
      <button type="submit" disabled={pending} className={`${primary} mt-3`}>{pending ? "Saving…" : "Save"}</button>
      <Feedback state={state} />
    </form>
  );
}

export type ItemKind = "STORE" | "PHOTO" | "CLAIM" | "VERIFY" | "REJECT" | "HANDOVER" | "DISPOSE" | "WITHDRAW";

export function ItemForm(props: { kind: ItemKind; itemId: string; claimId?: string; staff?: Opt[]; methods?: readonly string[]; defaultStorage?: string | null; compact?: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(itemAction, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const { kind } = props;
  const multipart = kind === "PHOTO" || kind === "HANDOVER";
  const titles: Record<ItemKind, [string, string]> = { STORE: ["Put into storage", "Store"], PHOTO: ["Add a photo", "Upload"], CLAIM: ["Record a claim", "Record claim"], VERIFY: ["", "Verify"], REJECT: ["", "Reject"], HANDOVER: ["Hand over to the owner", "Record handover"], DISPOSE: ["Dispose", "Record disposal"], WITHDRAW: ["", "Withdraw claim"] };
  return (
    <form key={state.values ? JSON.stringify(state.values) : "initial"} action={action} encType={multipart ? "multipart/form-data" : undefined} className={props.compact ? "" : panel} noValidate data-item-form={kind}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="itemId" value={props.itemId} />
      {props.claimId && <input type="hidden" name="claimId" value={props.claimId} />}
      {!props.compact && titles[kind][0] && <h3 className="font-medium">{titles[kind][0]}</h3>}
      <div className={`mt-2 grid gap-2 ${props.compact ? "" : "sm:grid-cols-2"}`}>
        {kind === "STORE" && <><label className="block text-sm">Storage location *<input name="storageLocation" defaultValue={v.storageLocation ?? props.defaultStorage ?? ""} className={input} />{err(e.storageLocation)}</label><label className="block text-sm">Notes<input name="notes" defaultValue={v.notes ?? ""} className={input} /></label></>}
        {kind === "PHOTO" && <label className="block text-sm">Photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="mt-1 block w-full text-sm" />{err(e.photo)}</label>}
        {kind === "CLAIM" && (
          <>
            <label className="block text-sm">Resident<select name="claimantStaffId" defaultValue={v.claimantStaffId ?? ""} className={input}><option value="">Not a resident (enter name below)</option>{props.staff?.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
            <label className="block text-sm">Or claimant name<input name="claimantName" defaultValue={v.claimantName ?? ""} className={input} />{err(e.claimantName)}</label>
            <label className="block text-sm">Contact<input name="claimantContact" defaultValue={v.claimantContact ?? ""} placeholder="Phone or email" className={input} /></label>
            <label className="block text-sm sm:col-span-2">Ownership details *<textarea name="evidence" rows={2} defaultValue={v.evidence ?? ""} placeholder="What the claimant says about the item: marks, contents, where it was lost" className={input} />{err(e.evidence)}</label>
          </>
        )}
        {(kind === "VERIFY" || kind === "REJECT") && <label className="block text-sm">{kind === "REJECT" ? "Reason *" : "Note"}<input name="note" defaultValue={v.note ?? ""} className={input} />{err(e.note)}</label>}
        {kind === "HANDOVER" && (
          <>
            <label className="block text-sm">Handed to <span className="text-zinc-500">(defaults to the verified claimant)</span><input name="recipientName" defaultValue={v.recipientName ?? ""} className={input} /></label>
            <label className="block text-sm">Evidence photo <span className="text-zinc-500">(signed slip, ID check)</span><input name="evidence" type="file" accept="image/jpeg,image/png,image/webp" className="mt-1 block w-full text-sm" />{err(e.evidence)}</label>
            <label className="block text-sm sm:col-span-2">Note<input name="note" defaultValue={v.note ?? ""} placeholder="e.g. ID checked, signed collection slip" className={input} /></label>
          </>
        )}
        {kind === "DISPOSE" && (
          <>
            <label className="block text-sm">Method *<select name="method" defaultValue={v.method ?? ""} className={input}><option value="">Choose…</option>{props.methods?.map((m) => <option key={m} value={m}>{m}</option>)}</select>{err(e.method)}</label>
            <label className="block text-sm">Reason *<input name="note" defaultValue={v.note ?? ""} placeholder="e.g. Unclaimed after retention period" className={input} />{err(e.note)}</label>
          </>
        )}
      </div>
      <button type="submit" disabled={pending} className={`${kind === "REJECT" || kind === "DISPOSE" || kind === "WITHDRAW" ? danger : kind === "VERIFY" ? primary : kind === "PHOTO" ? secondary : primary} mt-3`}>{pending ? "Saving…" : titles[kind][1]}</button>
      <Feedback state={state} />
    </form>
  );
}

export function MyClaimForm({ itemId }: { itemId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(myClaimAction, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  if (state.message) return <p role="status" data-claim-sent className="rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">{state.message}</p>;
  return (
    <form key={state.values ? JSON.stringify(state.values) : "initial"} action={action} className={panel} noValidate data-my-claim>
      <input type="hidden" name="itemId" value={itemId} />
      <h3 className="font-medium">Is this yours?</h3>
      <p className="mt-1 text-xs text-zinc-500">Describe the item so the office can check it is yours: colour, brand, marks, what is inside, where and when you lost it.</p>
      <label className="mt-2 block text-sm">Ownership details *<textarea name="evidence" rows={3} defaultValue={v.evidence ?? ""} className={input} />{err(e.evidence)}</label>
      <label className="mt-2 block text-sm">How to reach you<input name="claimantContact" defaultValue={v.claimantContact ?? ""} placeholder="Phone number (optional)" className={input} /></label>
      <button type="submit" disabled={pending} className={`${primary} mt-3`}>{pending ? "Sending…" : "Submit claim"}</button>
      <Feedback state={state} />
    </form>
  );
}
