import { Suspense } from "react";
import Link from "next/link";
import { prisma } from "@sam/core/lib/db";
import { requireCapability } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { listWaitlist, suggestForWaitlist } from "@sam/core/modules/allocations/extras";
import { staffOptions } from "@sam/core/modules/people/service";
import { isoDate } from "@sam/core/modules/accommodation/occupancy";
import { AddWaitlistForm, WaitlistRowActions } from "@/modules/allocations/components/extras-forms";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireCapability("accom.allocate", { returnTo: "/accommodation/waitlist", level: "access" });
  const visible = await visibleSites(user, "accom.allocate");
  const [entries, staff, sites, roomTypes] = await Promise.all([
    listWaitlist(),
    staffOptions(),
    prisma.site.findMany({ where: { archivedAt: null, ...(visible ? { id: { in: visible } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.masterItem.findMany({ where: { kind: "ROOM_TYPE", archivedAt: null }, select: { code: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const suggestions = await Promise.all(entries.map((e) => suggestForWaitlist(e.id)));
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <section className="panel">
        <div className="toolbar"><h2 className="font-medium">Waiting ({entries.length})</h2></div>
        <ul className="divide-y divide-zinc-200">
          {entries.map((e, i) => (
            <li key={e.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <div><Link href={`/people/${e.staffId}`} className="font-medium underline">{e.staff.firstName} {e.staff.lastName}</Link> <span className="text-xs text-zinc-500">{e.staff.employeeId}</span><div className="text-xs text-zinc-500">Needed from {isoDate(e.neededFrom)} · priority {e.priority}{e.roomType ? ` · ${e.roomType}` : ""}{e.notes ? ` · ${e.notes}` : ""}</div></div>
                <span className={`chip ${suggestions[i].length ? "chip-ok" : "chip-warn"}`}>{suggestions[i].length ? `${suggestions[i].length} bed${suggestions[i].length === 1 ? "" : "s"} available` : "Nothing available"}</span>
              </div>
              <div className="mt-2"><WaitlistRowActions entryId={e.id} suggestions={suggestions[i].map((s) => ({ bedId: s.bedId, label: s.label }))} /></div>
            </li>
          ))}
          {entries.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-500">The waitlist is empty.</li>}
        </ul>
      </section>
      <AddWaitlistForm staff={staff.map((s) => ({ id: s.id, label: `${s.firstName} ${s.lastName} (${s.employeeId})` }))} sites={sites} roomTypes={roomTypes} />
    </div>
  );
}

export default function WaitlistPage() {
  return <main><PageHeader title="Waitlist" subtitle="People waiting for a bed. When a matching bed is free it is suggested here for one-click allocation." crumbs={[["Accommodation", "/accommodation"], ["Waitlist"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
