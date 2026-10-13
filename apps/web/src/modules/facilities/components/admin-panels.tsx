import { actorOf, userCan, type CurrentUser } from "@/lib/auth/authorize";
import { ActionForm } from "@/components/forms/action-form";
import { blockedResidents, listClosuresAndBlocks } from "@sam/core/modules/facilities/extras";
import { blockAction, closeAction, liftAction, policyAction, reopenAction, removeBlockAction } from "../extras-actions";

type F = { id: string; siteId: string; eligibility: unknown; feePerHour: unknown; noShowLimit: number | null };
const WEEKDAYS = [["1", "Mon"], ["2", "Tue"], ["3", "Wed"], ["4", "Thu"], ["5", "Fri"], ["6", "Sat"], ["7", "Sun"]];

/** Closures, blocked slots and events, eligibility / fee / no-show limit, and residents whose booking is paused. */
export async function FacilityAdminPanels({ facility, user }: { facility: F; user: CurrentUser }) {
  void actorOf;
  const ctx = { siteId: facility.siteId };
  const mayClose = userCan(user, "fac.close", ctx), mayBlock = userCan(user, "fac.block_slots", ctx), mayConfigure = userCan(user, "fac.configure", ctx), mayLift = userCan(user, "fac.lift_noshow", ctx);
  if (!mayClose && !mayBlock && !mayConfigure && !mayLift) return null;
  const [{ closures, blocks }, blocked] = await Promise.all([listClosuresAndBlocks(facility.id), mayLift ? blockedResidents([facility.siteId]) : Promise.resolve([])]);
  const elig = (facility.eligibility ?? {}) as { grades?: string[]; departments?: string[]; categories?: string[] };
  const t = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
  return (
    <section className="mt-6 grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="panel"><div className="toolbar"><h2 className="font-medium">Closures & blocked time</h2></div>
          <ul className="divide-y divide-zinc-200 text-sm">
            {closures.map((c) => <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2"><span><b>Closed</b> {t(c.startsAt)} → {t(c.endsAt)}<span className="block text-xs text-zinc-500">{c.reason}</span></span>{mayClose && <ActionForm compact tone="secondary" action={reopenAction} hidden={{ id: c.id }} submit="Reopen" />}</li>)}
            {blocks.map((b) => <li key={b.id} className="flex items-center justify-between gap-2 px-4 py-2"><span><b>{b.type.toLowerCase()}</b> {b.title}<span className="block text-xs text-zinc-500">{b.type === "RECURRING" ? `${(b.recurrence as { from: string; to: string; weekdays: number[]; until: string }).from}–${(b.recurrence as { to: string }).to} on ${(b.recurrence as { weekdays: number[] }).weekdays.map((d) => WEEKDAYS[d - 1]?.[1]).join(", ")} until ${(b.recurrence as { until: string }).until}` : `${t(b.startsAt)} → ${t(b.endsAt)}`}</span></span>{mayBlock && <ActionForm compact tone="secondary" action={removeBlockAction} hidden={{ id: b.id }} submit="Remove" />}</li>)}
            {closures.length + blocks.length === 0 && <li className="px-4 py-3 text-zinc-500">Nothing scheduled.</li>}
          </ul></div>
        {mayClose && <ActionForm action={closeAction} hidden={{ facilityId: facility.id }} title="Close for maintenance" intro="Bookings in the window are cancelled and the people told." submit="Close facility" fields={[{ name: "startsAt", label: "From", type: "datetime-local", required: true }, { name: "endsAt", label: "Until", type: "datetime-local", required: true }, { name: "reason", label: "Reason", required: true }]} />}
        {mayBlock && <ActionForm action={blockAction} hidden={{ facilityId: facility.id }} title="Block a slot, hold an event or reserve weekly" submit="Block" fields={[{ name: "type", label: "Kind", type: "select", options: [{ value: "BLOCK", label: "Block a slot" }, { value: "EVENT", label: "Event" }, { value: "RECURRING", label: "Recurring weekly reservation" }] }, { name: "title", label: "Title", required: true }, { name: "startsAt", label: "From (block / event)", type: "datetime-local" }, { name: "endsAt", label: "Until (block / event)", type: "datetime-local" }, { name: "weekdays", label: "Weekdays (recurring)", type: "multiselect", options: WEEKDAYS.map(([v, l]) => ({ value: v, label: l })) }, { name: "from", label: "Daily from (recurring)", type: "text", placeholder: "18:00" }, { name: "to", label: "Daily until (recurring)", type: "text", placeholder: "19:00" }, { name: "until", label: "Repeat until (recurring)", type: "date" }]} />}
      </div>
      <div className="space-y-4">
        {mayConfigure && <ActionForm action={policyAction} hidden={{ facilityId: facility.id }} title="Who can book, fee and no-show limit" intro="Leave the lists blank to open the facility to everyone." submit="Save" fields={[{ name: "grades", label: "Eligible grades (comma separated)", defaultValue: (elig.grades ?? []).join(", ") }, { name: "departments", label: "Eligible departments", defaultValue: (elig.departments ?? []).join(", ") }, { name: "categories", label: "Eligibility categories", defaultValue: (elig.categories ?? []).join(", ") }, { name: "feePerHour", label: "Fee per hour (blank = free)", type: "number", step: "0.01", defaultValue: facility.feePerHour == null ? "" : Number(facility.feePerHour) }, { name: "noShowLimit", label: "No-shows before booking pauses (0 = never)", type: "number", defaultValue: facility.noShowLimit ?? "" }]} />}
        {mayLift && (
          <div className="panel"><div className="toolbar"><h2 className="font-medium">No-show strikes</h2></div>
            <ul className="divide-y divide-zinc-200 text-sm">{blocked.filter((b) => b.facilityId === facility.id).map((b) => <li key={`${b.userId}${b.facilityId}`} className="flex items-center justify-between gap-2 px-4 py-2"><span><b>{b.user}</b> · {b.count} of {b.limit}{b.blocked ? <span className="chip chip-danger ml-2">booking paused</span> : null}</span><ActionForm compact tone="secondary" action={liftAction} hidden={{ userId: b.userId, facilityId: b.facilityId }} submit="Lift block" /></li>)}{blocked.filter((b) => b.facilityId === facility.id).length === 0 && <li className="px-4 py-3 text-zinc-500">No active strikes.</li>}</ul></div>
        )}
      </div>
    </section>
  );
}
