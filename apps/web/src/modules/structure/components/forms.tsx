"use client";

import { useActionState, useState } from "react";
import { activateAction, addBedsAction, bulkBuildingsAction, bulkRoomsAction, createBuildingAction, createFloorAction, createRoomAction, createSiteAction, createUnitAction, restoreAction, statusAction, submitActivationAction, updateRoomAction, updateSiteAction, type ActionState } from "../actions";

const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";
const primary = "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink disabled:opacity-60";
const secondary = "rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium disabled:opacity-60";
const panel = "card p-4";

export function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>;
  if (state.message) return <p role="status" className="mt-2 text-sm text-green-700">{state.message}</p>;
  return null;
}
const fe = (s: ActionState, k: string) => (s.fieldErrors?.[k] ? <span role="alert" className="text-xs text-red-700">{s.fieldErrors[k]}</span> : null);

const GENDERS = [["", "Inherit / any"], ["ANY", "Any"], ["MALE", "Male only"], ["FEMALE", "Female only"]] as const;

export function SiteForm({ site, propertyTypes }: { site?: { id: string; code: string; name: string; propertyType: string | null; address: string | null; latitude: number | null; longitude: number | null; contactName: string | null; contactPhone: string | null; contactEmail: string | null; timezone: string; genderPolicy: string | null }; propertyTypes: Array<{ code: string; name: string }> }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(site ? updateSiteAction : createSiteAction, {});
  return (
    <form action={action} className={panel} noValidate>
      {site && <input type="hidden" name="siteId" value={site.id} />}
      <h3 className="font-medium">{site ? "Site details" : "New site"}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {!site && <label className="block text-sm">Code *<input name="code" className={input} placeholder="PV" />{fe(state, "code")}</label>}
        <label className="block text-sm">Name *<input name="name" defaultValue={site?.name} className={input} />{fe(state, "name")}</label>
        <label className="block text-sm">Property type<select name="propertyType" defaultValue={site?.propertyType ?? ""} className={input}><option value="">Not set</option>{propertyTypes.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
        <label className="block text-sm">Time zone<input name="timezone" defaultValue={site?.timezone ?? "Asia/Dubai"} className={input} />{fe(state, "timezone")}</label>
        <label className="block text-sm sm:col-span-2">Address<input name="address" defaultValue={site?.address ?? ""} className={input} /></label>
        <label className="block text-sm">Latitude<input name="latitude" type="number" step="any" defaultValue={site?.latitude ?? ""} className={input} /></label>
        <label className="block text-sm">Longitude<input name="longitude" type="number" step="any" defaultValue={site?.longitude ?? ""} className={input} /></label>
        <label className="block text-sm">Contact name<input name="contactName" defaultValue={site?.contactName ?? ""} className={input} /></label>
        <label className="block text-sm">Contact phone<input name="contactPhone" defaultValue={site?.contactPhone ?? ""} className={input} /></label>
        <label className="block text-sm">Contact email<input name="contactEmail" type="email" defaultValue={site?.contactEmail ?? ""} className={input} /></label>
        <label className="block text-sm">Gender policy<select name="genderPolicy" defaultValue={site?.genderPolicy ?? ""} className={input}>{GENDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      <button type="submit" disabled={pending} className={`${primary} mt-3`}>{pending ? "Saving…" : site ? "Save site" : "Create site as draft"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function BuildingForm({ siteId }: { siteId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createBuildingAction, {});
  return (
    <form action={action} className={panel} noValidate>
      <input type="hidden" name="siteId" value={siteId} />
      <h3 className="font-medium">Add a building</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Code *<input name="code" className={input} placeholder="V07" />{fe(state, "code")}</label>
        <label className="block text-sm">Name *<input name="name" className={input} placeholder="Villa 07" />{fe(state, "name")}</label>
        <label className="block text-sm">Type<select name="type" className={input}><option value="BUILDING">Block</option><option value="VILLA">Villa</option><option value="APARTMENT">Apartment</option></select></label>
        <label className="block text-sm">Gender policy<select name="genderPolicy" className={input}>{GENDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      <button type="submit" disabled={pending} className={`${secondary} mt-3`}>{pending ? "Adding…" : "Add building"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function BulkBuildingsForm({ siteId }: { siteId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(bulkBuildingsAction, {});
  return (
    <form action={action} className={panel} noValidate>
      <input type="hidden" name="siteId" value={siteId} />
      <h3 className="font-medium">Bulk generate buildings</h3>
      <p className="mt-1 text-xs text-zinc-500">For example prefix V, 1 to 20: Villa 01 to Villa 20. Existing codes are skipped. Needs the Building creation grant.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">Code prefix<input name="prefix" defaultValue="V" className={input} /></label>
        <label className="block text-sm">From<input name="from" type="number" defaultValue={1} className={input} /></label>
        <label className="block text-sm">To<input name="to" type="number" defaultValue={20} className={input} />{fe(state, "to")}</label>
        <label className="block text-sm">Digits<input name="pad" type="number" min={0} max={4} defaultValue={2} className={input} /></label>
        <label className="block text-sm">Name prefix<input name="namePrefix" defaultValue="Villa" className={input} /></label>
        <label className="block text-sm">Type<select name="type" className={input}><option value="VILLA">Villa</option><option value="BUILDING">Block</option><option value="APARTMENT">Apartment</option></select></label>
      </div>
      <button type="submit" disabled={pending} className={`${secondary} mt-3`}>{pending ? "Generating…" : "Generate"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function FloorUnitForms({ buildingId, floors }: { buildingId: string; floors: Array<{ id: string; code: string; name: string }> }) {
  const [fs, fa, fp] = useActionState<ActionState, FormData>(createFloorAction, {});
  const [us, ua, up] = useActionState<ActionState, FormData>(createUnitAction, {});
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <form action={fa} className={panel} noValidate>
        <input type="hidden" name="buildingId" value={buildingId} />
        <h3 className="font-medium">Add a floor</h3>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <label className="block text-sm">Code<input name="code" className={input} placeholder="1" /></label>
          <label className="block text-sm">Name<input name="name" className={input} placeholder="Floor 1" /></label>
          <label className="block text-sm">Level<input name="level" type="number" defaultValue={1} className={input} /></label>
        </div>
        <button type="submit" disabled={fp} className={`${secondary} mt-3`}>Add floor</button>
        <Feedback state={fs} />{fe(fs, "code")}
      </form>
      <form action={ua} className={panel} noValidate>
        <input type="hidden" name="buildingId" value={buildingId} />
        <h3 className="font-medium">Add a unit (flat)</h3>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <label className="block text-sm">Code<input name="code" className={input} placeholder="302" /></label>
          <label className="block text-sm">Name<input name="name" className={input} placeholder="Flat 302" /></label>
          <label className="block text-sm">Floor<select name="floorId" className={input}><option value="">None</option>{floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        </div>
        <button type="submit" disabled={up} className={`${secondary} mt-3`}>Add unit</button>
        <Feedback state={us} />{fe(us, "code")}
      </form>
    </div>
  );
}

type Opts = { floors: Array<{ id: string; name: string }>; units: Array<{ id: string; name: string }>; roomTypes: Array<{ code: string; name: string }>; bedTypes: Array<{ code: string; name: string }> };

function RoomFields({ opts, room }: { opts: Opts; room?: { type: string | null; floorId: string | null; unitId: string | null; genderPolicy: string; inheritsPolicy: boolean; amenities: string[]; attachedBath: boolean; areaSqm: string | null; monthlyCharge: string | null } }) {
  return (
    <>
      <label className="block text-sm">Room type<select name="type" defaultValue={room?.type ?? ""} className={input}><option value="">Not set</option>{opts.roomTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select></label>
      <label className="block text-sm">Floor<select name="floorId" defaultValue={room?.floorId ?? ""} className={input}><option value="">None</option>{opts.floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <label className="block text-sm">Unit<select name="unitId" defaultValue={room?.unitId ?? ""} className={input}><option value="">None</option>{opts.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label className="block text-sm">Gender policy<select name="genderPolicy" defaultValue={room?.genderPolicy ?? "ANY"} className={input}><option value="ANY">Any</option><option value="MALE">Male only</option><option value="FEMALE">Female only</option></select></label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="inheritsPolicy" defaultChecked={room?.inheritsPolicy} />Inherit gender policy and eligibility from the building and site</label>
      <label className="block text-sm sm:col-span-2">Amenities (comma separated)<input name="amenities" defaultValue={room?.amenities.join(", ") ?? ""} className={input} placeholder="AC, wardrobe, desk" /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="attachedBath" defaultChecked={room?.attachedBath} />Attached bathroom</label>
      <label className="block text-sm">Area (m²)<input name="areaSqm" type="number" step="0.1" defaultValue={room?.areaSqm ?? ""} className={input} /></label>
      <label className="block text-sm">Charge per month<input name="monthlyCharge" type="number" step="0.01" defaultValue={room?.monthlyCharge ?? ""} className={input} /></label>
    </>
  );
}

export function RoomCreateForms({ buildingId, opts }: { buildingId: string; opts: Opts }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createRoomAction, {});
  const [bs, ba, bp] = useActionState<ActionState, FormData>(bulkRoomsAction, {});
  const [bulk, setBulk] = useState(false);
  return (
    <div className={panel}>
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{bulk ? "Bulk generate rooms and beds" : "Add a room"}</h3>
        <button type="button" onClick={() => setBulk(!bulk)} className="text-xs underline">{bulk ? "Add a single room" : "Bulk generate instead"}</button>
      </div>
      {!bulk ? (
        <form action={action} noValidate>
          <input type="hidden" name="buildingId" value={buildingId} />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">Code *<input name="code" className={input} placeholder="V07-R2" />{fe(state, "code")}</label>
            <label className="block text-sm">Beds<input name="bedCount" type="number" min={0} max={20} defaultValue={2} className={input} /></label>
            <label className="block text-sm">Bed type<select name="bedType" className={input}><option value="">Not set</option>{opts.bedTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select></label>
            <RoomFields opts={opts} />
          </div>
          <button type="submit" disabled={pending} className={`${secondary} mt-3`}>{pending ? "Adding…" : "Add room as draft"}</button>
          <Feedback state={state} />
        </form>
      ) : (
        <form action={ba} noValidate>
          <input type="hidden" name="buildingId" value={buildingId} />
          <p className="mt-1 text-xs text-zinc-500">For example floor 1, rooms 101 to 120, double, 2 beds, AC. Existing codes are skipped. Needs the Bulk generate capability.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="block text-sm">Code prefix<input name="prefix" className={input} placeholder="R" /></label>
            <label className="block text-sm">From<input name="from" type="number" defaultValue={101} className={input} /></label>
            <label className="block text-sm">To<input name="to" type="number" defaultValue={120} className={input} />{fe(bs, "to")}</label>
            <label className="block text-sm">Digits<input name="pad" type="number" min={0} max={4} defaultValue={0} className={input} /></label>
            <label className="block text-sm">Beds per room<input name="bedCount" type="number" min={0} max={20} defaultValue={2} className={input} /></label>
            <label className="block text-sm">Bed type<select name="bedType" className={input}><option value="">Not set</option>{opts.bedTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select></label>
            <RoomFields opts={opts} />
          </div>
          <button type="submit" disabled={bp} className={`${secondary} mt-3`}>{bp ? "Generating…" : "Generate rooms"}</button>
          <Feedback state={bs} />
        </form>
      )}
    </div>
  );
}

export function RoomEditForm({ roomId, opts, room }: { roomId: string; opts: Opts; room: Parameters<typeof RoomFields>[0]["room"] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateRoomAction, {});
  return (
    <form action={action} className={panel} noValidate>
      <input type="hidden" name="roomId" value={roomId} />
      <h3 className="font-medium">Room details</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2"><RoomFields opts={opts} room={room} /></div>
      <button type="submit" disabled={pending} className={`${secondary} mt-3`}>{pending ? "Saving…" : "Save room"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function AddBedsForm({ roomId, bedTypes }: { roomId: string; bedTypes: Array<{ code: string; name: string }> }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addBedsAction, {});
  return (
    <form action={action} className={panel}>
      <input type="hidden" name="roomId" value={roomId} />
      <label htmlFor="count" className="block text-sm font-medium">Add beds</label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input id="count" name="count" type="number" min={1} max={20} defaultValue={1} inputMode="numeric" className={`${input} !mt-0 w-24`} />
        <select name="bedType" aria-label="Bed type" className={`${input} !mt-0 w-40`}><option value="">Bed type</option>{bedTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
        <button type="submit" disabled={pending} className={secondary}>{pending ? "Adding…" : "Add"}</button>
      </div>
      <p className="mt-1 text-xs text-zinc-500">Beds join an active room in service at once; in a draft room they start as drafts.</p>
      <Feedback state={state} />
    </form>
  );
}

const TRANSITIONS: Record<string, Array<[string, string]>> = {
  DRAFT: [["ACTIVE", "Activate"], ["ARCHIVED", "Archive"]],
  ACTIVE: [["MAINTENANCE", "Under maintenance"], ["BLOCKED", "Block"], ["ARCHIVED", "Archive"]],
  MAINTENANCE: [["ACTIVE", "Return to service"], ["BLOCKED", "Block"], ["ARCHIVED", "Archive"]],
  BLOCKED: [["ACTIVE", "Unblock"], ["MAINTENANCE", "Under maintenance"], ["ARCHIVED", "Archive"]],
  INACTIVE: [["ACTIVE", "Reactivate"], ["ARCHIVED", "Archive"]],
  RETIRED: [["ACTIVE", "Return to service"]],
};

/** Moves a record along Draft -> Active -> Under maintenance / Blocked -> Archived, with the reason the document requires. */
export function StatusControl({ level, id, status, canRestore, compact }: { level: "SITE" | "BUILDING" | "ROOM" | "BED" | "FLOOR" | "UNIT"; id: string; status: string; canRestore?: boolean; compact?: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(statusAction, {});
  const [rs, ra, rp] = useActionState<ActionState, FormData>(restoreAction, {});
  if (status === "ARCHIVED") {
    return canRestore ? (
      <form action={ra} className="flex flex-wrap items-center gap-2"><input type="hidden" name="level" value={level} /><input type="hidden" name="id" value={id} /><button type="submit" disabled={rp} className={secondary}>Restore as draft</button><Feedback state={rs} /></form>
    ) : <span className="text-xs text-zinc-500">Archived</span>;
  }
  const options = TRANSITIONS[status] ?? [];
  if (options.length === 0) return null;
  return (
    <form action={action} className={`flex flex-wrap items-center gap-2 ${compact ? "" : "mt-2"}`}>
      <input type="hidden" name="level" value={level} />
      <input type="hidden" name="id" value={id} />
      <select name="status" aria-label="Change status" className={`${input} !mt-0 w-auto`}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <input name="reason" placeholder="Reason (needed to block, maintain or archive)" aria-label="Reason" className={`${input} !mt-0 w-64`} />
      {level === "BED" && <input name="until" type="date" aria-label="Expected back" title="Expected back in service" className={`${input} !mt-0 w-36`} />}
      <button type="submit" disabled={pending} className={secondary}>{pending ? "Saving…" : "Apply"}</button>
      <div className="basis-full"><Feedback state={state} /></div>
    </form>
  );
}

export function ActivationPanel({ level, id, review, canActivate }: { level: "SITE" | "BUILDING"; id: string; review: { draft: { buildings: number; rooms: number; beds: number; floors: number; units: number }; problems: string[] }; canActivate: boolean }) {
  const [as, aa, ap] = useActionState<ActionState, FormData>(activateAction, {});
  const [ss, sa, sp] = useActionState<ActionState, FormData>(submitActivationAction, {});
  const d = review.draft;
  const nothing = d.buildings + d.rooms + d.beds + d.floors + d.units === 0;
  if (nothing && review.problems.length === 0) return null;
  return (
    <div className={panel} data-activation>
      <h3 className="font-medium">Review and activate</h3>
      <p className="mt-1 text-sm text-zinc-600">Only active beds appear in Allocations. Drafts waiting: {d.buildings} building{d.buildings === 1 ? "" : "s"}, {d.floors} floor{d.floors === 1 ? "" : "s"}, {d.units} unit{d.units === 1 ? "" : "s"}, {d.rooms} room{d.rooms === 1 ? "" : "s"}, {d.beds} bed{d.beds === 1 ? "" : "s"}.</p>
      {review.problems.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-amber-800">{review.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="mt-3 flex flex-wrap gap-2">
        {canActivate ? (
          <form action={aa}><input type="hidden" name="level" value={level} /><input type="hidden" name="id" value={id} /><button type="submit" disabled={ap || review.problems.length > 0} className={primary}>Activate all drafts</button></form>
        ) : (
          <form action={sa}><input type="hidden" name="level" value={level} /><input type="hidden" name="id" value={id} /><button type="submit" disabled={sp || review.problems.length > 0} className={primary}>Submit for activation</button></form>
        )}
      </div>
      <Feedback state={as} /><Feedback state={ss} />
    </div>
  );
}
