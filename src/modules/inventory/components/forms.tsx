"use client";

import { useActionState, useState } from "react";
import { createItemAction, movementAction, updateItemAction, type FormState } from "../actions";

function Feedback({ state }: { state: FormState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{state.error}</p>;
  if (state.message) return <p role="status" className="mt-2 text-sm text-green-700 dark:text-green-300">{state.message}</p>;
  return null;
}
const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const primary = "rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900";
const danger = "rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60 dark:border-red-800 dark:text-red-300";
const panel = "rounded-lg border border-zinc-200 p-4 dark:border-zinc-800";
const err = (m?: string) => (m ? <span role="alert" className="text-xs text-red-700 dark:text-red-300">{m}</span> : null);

export type Opt = { id: string; label: string };
export type TargetOptions = { rooms: Opt[]; staff: Opt[]; facilities: Opt[] };
const CONDITION_OPTIONS: Array<[string, string]> = [["NEW", "New"], ["GOOD", "Good"], ["FAIR", "Fair"], ["DAMAGED", "Damaged"]];

function TargetSelect({ options, defaultValue, only, label = "To" }: { options: TargetOptions; defaultValue?: string; only?: Array<{ value: string; label: string }>; label?: string }) {
  return (
    <label className="block text-sm">{label}
      <select name="target" defaultValue={defaultValue ?? (only?.[0]?.value ?? "")} className={input}>
        {only ? only.map((o) => <option key={o.value} value={o.value}>{o.label}</option>) : (
          <>
            <option value="">Choose…</option>
            <optgroup label="Rooms">{options.rooms.map((r) => <option key={r.id} value={`room:${r.id}`}>{r.label}</option>)}</optgroup>
            <optgroup label="Residents">{options.staff.map((s) => <option key={s.id} value={`staff:${s.id}`}>{s.label}</option>)}</optgroup>
            <optgroup label="Facilities">{options.facilities.map((f) => <option key={f.id} value={`facility:${f.id}`}>{f.label}</option>)}</optgroup>
          </>
        )}
      </select>
    </label>
  );
}

export function CreateItemForm({ sites, categories }: { sites: Opt[]; categories: string[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createItemAction, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const [type, setType] = useState(v.trackingType === "SERIALIZED" ? "SERIALIZED" : "STOCK");
  const serialised = type === "SERIALIZED";
  return (
    <form key={state.values ? JSON.stringify(state.values) : "initial"} action={action} className={panel} noValidate data-create-item>
      <h3 className="font-medium">Add an item</h3>
      <div className="mt-2 flex gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="radio" name="trackingType" value="STOCK" checked={!serialised} onChange={() => setType("STOCK")} /> Stock line (counted units)</label>
        <label className="flex items-center gap-2"><input type="radio" name="trackingType" value="SERIALIZED" checked={serialised} onChange={() => setType("SERIALIZED")} /> Serialised asset (one unit, tracked by serial)</label>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">Site<select name="siteId" defaultValue={v.siteId ?? sites[0]?.id ?? ""} className={input}>{sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label className="block text-sm">SKU / item code *<input name="sku" defaultValue={v.sku ?? ""} placeholder={serialised ? "e.g. TV-32" : "e.g. PILLOW-STD"} className={input} />{err(e.sku)}</label>
        <label className="block text-sm">Name *<input name="name" defaultValue={v.name ?? ""} className={input} />{err(e.name)}</label>
        <label className="block text-sm">Category *<input name="category" list="inventory-categories" defaultValue={v.category ?? ""} className={input} /><datalist id="inventory-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>{err(e.category)}</label>
        {serialised ? (
          <>
            <label className="block text-sm">Serial number / asset tag *<input name="serialNumber" defaultValue={v.serialNumber ?? ""} className={input} />{err(e.serialNumber)}</label>
            <label className="block text-sm">Condition<select name="condition" defaultValue={v.condition ?? "GOOD"} className={input}>{CONDITION_OPTIONS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></label>
          </>
        ) : (
          <>
            <label className="block text-sm">Opening quantity<input type="number" name="openingQuantity" min={0} defaultValue={v.openingQuantity ?? "0"} className={input} />{err(e.openingQuantity)}</label>
            <label className="block text-sm">Unit<input name="unit" defaultValue={v.unit ?? "pcs"} className={input} /></label>
            <label className="block text-sm">Reorder threshold <span className="text-zinc-500">(warn at or below)</span><input type="number" name="reorderThreshold" min={0} defaultValue={v.reorderThreshold ?? ""} className={input} />{err(e.reorderThreshold)}</label>
          </>
        )}
        <label className="block text-sm">Storage location<input name="storageLocation" defaultValue={v.storageLocation ?? ""} placeholder="e.g. Store room A, shelf 3" className={input} /></label>
        <label className="block text-sm sm:col-span-2">Description<input name="description" defaultValue={v.description ?? ""} className={input} /></label>
      </div>
      <button type="submit" disabled={pending} className={`${primary} mt-3`}>{pending ? "Saving…" : "Add item"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function EditItemForm({ item }: { item: { id: string; name: string; category: string; description: string | null; unit: string; trackingType: string; condition: string; reorderThreshold: number | null; storageLocation: string | null; notes: string | null } }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateItemAction, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const serialised = item.trackingType === "SERIALIZED";
  return (
    <form key={state.values ? JSON.stringify(state.values) : "initial"} action={action} className={panel} noValidate data-edit-item>
      <input type="hidden" name="itemId" value={item.id} />
      <h3 className="font-medium">Edit item</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Name *<input name="name" defaultValue={v.name ?? item.name} className={input} />{err(e.name)}</label>
        <label className="block text-sm">Category *<input name="category" defaultValue={v.category ?? item.category} className={input} />{err(e.category)}</label>
        {serialised ? (
          <label className="block text-sm">Condition<select name="condition" defaultValue={v.condition ?? item.condition} className={input}>{CONDITION_OPTIONS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select>{err(e.condition)}</label>
        ) : (
          <>
            <label className="block text-sm">Unit<input name="unit" defaultValue={v.unit ?? item.unit} className={input} /></label>
            <label className="block text-sm">Reorder threshold<input type="number" name="reorderThreshold" min={0} defaultValue={v.reorderThreshold ?? (item.reorderThreshold ?? "")} className={input} />{err(e.reorderThreshold)}</label>
          </>
        )}
        <label className="block text-sm">Storage location<input name="storageLocation" defaultValue={v.storageLocation ?? item.storageLocation ?? ""} className={input} /></label>
        <label className="block text-sm sm:col-span-2">Description<input name="description" defaultValue={v.description ?? item.description ?? ""} className={input} /></label>
        <label className="block text-sm sm:col-span-2">Notes<input name="notes" defaultValue={v.notes ?? item.notes ?? ""} className={input} /></label>
      </div>
      <button type="submit" disabled={pending} className={`${primary} mt-3`}>{pending ? "Saving…" : "Save"}</button>
      <Feedback state={state} />
    </form>
  );
}

export type MovementKind = "RECEIVE" | "ISSUE" | "RETURN" | "DAMAGE" | "ADJUST" | "TRANSFER" | "RETIRE";
const TITLES: Record<MovementKind, [string, string]> = {
  RECEIVE: ["Receive stock", "Record units received"],
  ISSUE: ["Issue", "Issue"],
  RETURN: ["Return", "Record return"],
  DAMAGE: ["Record damage", "Record damage"],
  ADJUST: ["Stock count adjustment", "Adjust"],
  TRANSFER: ["Transfer to another site", "Transfer"],
  RETIRE: ["Retire", "Retire"],
};

export function MovementForm(props: {
  kind: MovementKind; itemId: string; serialised: boolean; unit: string; onHand: number; options?: TargetOptions; sites?: Opt[];
  /** For returns: the places the item is currently out at. */
  outstanding?: Array<{ value: string; label: string }>; defaultTarget?: string; returnPath?: string; compact?: boolean; title?: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(movementAction, {});
  const v = state.values ?? {};
  const e = state.fieldErrors ?? {};
  const { kind, serialised } = props;
  const [title, button] = TITLES[kind];
  const qty = !serialised && ["RECEIVE", "ISSUE", "RETURN", "DAMAGE", "TRANSFER"].includes(kind);
  return (
    <form key={state.values ? JSON.stringify(state.values) : "initial"} action={action} className={props.compact ? "" : panel} noValidate data-movement={kind}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="itemId" value={props.itemId} />
      {props.returnPath && <input type="hidden" name="returnPath" value={props.returnPath} />}
      {!props.compact && <h3 className="font-medium">{props.title ?? title}</h3>}
      <div className={`mt-2 grid gap-2 ${props.compact ? "sm:grid-cols-[1fr_auto]" : "sm:grid-cols-2"}`}>
        {qty && <label className="block text-sm">Quantity ({props.unit})<input type="number" name="quantity" min={1} defaultValue={v.quantity ?? "1"} className={input} />{err(e.quantity)}</label>}
        {kind === "RECEIVE" && <label className="block text-sm">Reference <span className="text-zinc-500">(PO, delivery note)</span><input name="reference" defaultValue={v.reference ?? ""} className={input} /></label>}
        {kind === "ISSUE" && props.options && <TargetSelect options={props.options} defaultValue={v.target ?? props.defaultTarget} />}
        {kind === "RETURN" && props.options && <TargetSelect options={props.options} defaultValue={v.target ?? props.defaultTarget} only={props.outstanding} label="From" />}
        {kind === "RETURN" && <label className="block text-sm">Condition<select name="condition" defaultValue={v.condition ?? (serialised ? "GOOD" : "")} className={input}>{!serialised && <option value="">Usable</option>}{CONDITION_OPTIONS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></label>}
        {kind === "ADJUST" && (
          <>
            <label className="block text-sm">Counted quantity ({props.unit}) <span className="text-zinc-500">· currently {props.onHand}</span><input type="number" name="countedQuantity" min={0} defaultValue={v.countedQuantity ?? String(props.onHand)} className={input} />{err(e.countedQuantity)}</label>
            <label className="block text-sm">Reason *<input name="reason" defaultValue={v.reason ?? ""} className={input} />{err(e.reason)}</label>
          </>
        )}
        {kind === "TRANSFER" && props.sites && <label className="block text-sm">To site<select name="toSiteId" defaultValue={v.toSiteId ?? ""} className={input}><option value="">Choose…</option>{props.sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>{err(e.toSiteId)}</label>}
        {kind !== "ADJUST" && <label className={`block text-sm ${props.compact ? "" : "sm:col-span-2"}`}>{kind === "DAMAGE" || kind === "RETIRE" ? "Reason *" : "Notes"}<input name="notes" defaultValue={v.notes ?? ""} className={input} />{err(e.notes)}</label>}
      </div>
      {err(e.target)}
      <button type="submit" disabled={pending} className={`${kind === "RETIRE" || kind === "DAMAGE" ? danger : primary} mt-3`}>{pending ? "Saving…" : button}</button>
      <Feedback state={state} />
    </form>
  );
}
