import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@sam/core/lib/db";
import { canSeeSite } from "@/lib/auth/scope";
import { requireRole, userCan, userAccess } from "@/lib/auth/authorize";
import { ACCOMMODATION_VIEW_ROLES } from "@sam/core/modules/accommodation/access";
import { ALLOCATION_OPERATE_ROLES } from "@sam/core/modules/allocations/access";
import { hasRole } from "@/lib/auth/authorize";
import { getRoomOccupancy } from "@sam/core/modules/accommodation/occupancy";
import { effectivePolicy } from "@sam/core/modules/structure/service";
import { SummaryTiles } from "@/modules/accommodation/components/summary-tiles";
import { StateBadge } from "@/modules/accommodation/components/state-badge";
import { AddBedsForm, RoomEditForm, StatusControl } from "@/modules/structure/components/forms";
import { ReadinessForm } from "@/modules/allocations/components/extras-forms";
import { StatusChip } from "@/modules/structure/components/status-chip";
import { masterOptions } from "@/modules/structure/context";
import { PageHeader } from "@/components/shell/page-header";

const TABS = [["beds", "Beds"], ["keys", "Keys"], ["assets", "Assets"], ["work", "Work orders"], ["history", "History"]] as const;
type Tab = (typeof TABS)[number][0];

async function RoomHubTab({ tab, roomId, userCanKeys, userCanAssets }: { tab: Tab; roomId: string; userCanKeys: boolean; userCanAssets: boolean }) {
  if (tab === "keys") {
    if (!userCanKeys) return <p className="text-sm text-zinc-500">Your role cannot see the keys for this room.</p>;
    const keys = await prisma.key.findMany({ where: { roomId, archivedAt: null }, include: { transactions: { where: { type: "ISSUE", returnedAt: null }, include: { holder: true }, take: 1 } }, orderBy: { code: "asc" } });
    return (
      <ul className="card divide-y divide-zinc-200 text-sm">
        {keys.map((k) => <li key={k.id} className="flex items-center justify-between px-4 py-2"><Link href={`/keys/${k.id}`} className="font-medium underline">{k.code}{k.sensitive ? " · sensitive" : ""}</Link><span className="text-zinc-500">{k.transactions[0]?.holder ? `held by ${k.transactions[0].holder.firstName} ${k.transactions[0].holder.lastName}` : k.status.toLowerCase().replace(/_/g, " ")}</span></li>)}
        {keys.length === 0 && <li className="px-4 py-4 text-zinc-500">No keys are linked to this room.</li>}
      </ul>
    );
  }
  if (tab === "assets") {
    if (!userCanAssets) return <p className="text-sm text-zinc-500">Your role cannot see the assets in this room.</p>;
    const [assigned, stored] = await Promise.all([
      prisma.assetAssignment.findMany({ where: { roomId, endedAt: null }, include: { item: true }, orderBy: { startedAt: "desc" } }),
      prisma.inventoryItem.findMany({ where: { roomId, status: "ACTIVE" }, orderBy: { name: "asc" } }),
    ]);
    return (
      <ul className="card divide-y divide-zinc-200 text-sm">
        {assigned.map((a) => <li key={a.id} className="flex items-center justify-between px-4 py-2"><Link href={`/inventory/${a.itemId}`} className="font-medium underline">{a.item.name}{a.item.serialNumber ? ` #${a.item.serialNumber}` : ""}</Link><span className="text-zinc-500">issued {a.startedAt.toISOString().slice(0, 10)}</span></li>)}
        {stored.map((i) => <li key={i.id} className="flex items-center justify-between px-4 py-2"><Link href={`/inventory/${i.id}`} className="font-medium underline">{i.name}</Link><span className="text-zinc-500">stored here · {i.quantity} {i.unit}</span></li>)}
        {assigned.length + stored.length === 0 && <li className="px-4 py-4 text-zinc-500">No assets are recorded in this room.</li>}
      </ul>
    );
  }
  if (tab === "work") {
    const orders = await prisma.workOrder.findMany({ where: { roomId }, orderBy: { createdAt: "desc" }, take: 20 });
    return (
      <ul className="card divide-y divide-zinc-200 text-sm">
        {orders.map((w) => <li key={w.id} className="flex items-center justify-between px-4 py-2"><Link href={`/maintenance/${w.id}`} className="font-medium underline">{w.ticketNumber} · {w.category}</Link><span className="text-zinc-500">{w.status.toLowerCase().replace(/_/g, " ")}</span></li>)}
        {orders.length === 0 && <li className="px-4 py-4 text-zinc-500">No work orders for this room.</li>}
      </ul>
    );
  }
  const beds = await prisma.bed.findMany({ where: { roomId }, select: { id: true } });
  const events = await prisma.auditEvent.findMany({ where: { OR: [{ entityType: "Room", entityId: roomId }, { entityType: "Bed", entityId: { in: beds.map((b) => b.id) } }] }, orderBy: { createdAt: "desc" }, take: 30, include: { actor: { select: { name: true } } } });
  const stays = await prisma.allocation.findMany({ where: { bed: { roomId } }, include: { staff: true, bed: true }, orderBy: { startDate: "desc" }, take: 10 });
  return (
    <div className="space-y-4">
      <ul className="card divide-y divide-zinc-200 text-sm">
        {stays.map((a) => <li key={a.id} className="flex items-center justify-between px-4 py-2"><Link href={`/accommodation/allocations/${a.id}`} className="underline">{a.bed.code} · {a.staff.firstName} {a.staff.lastName}</Link><span className="text-zinc-500">{a.startDate.toISOString().slice(0, 10)} → {a.endDate?.toISOString().slice(0, 10) ?? "open"} · {a.status.toLowerCase().replace(/_/g, " ")}</span></li>)}
        {stays.length === 0 && <li className="px-4 py-4 text-zinc-500">No stays yet.</li>}
      </ul>
      <ol className="card divide-y divide-zinc-200 text-sm">
        {events.map((e) => <li key={e.id} className="flex flex-wrap justify-between gap-2 px-4 py-2"><span><span className="font-medium">{e.action.toLowerCase().replace(/_/g, " ")}</span>{e.actor ? <span className="text-zinc-500"> · {e.actor.name}</span> : null}</span><span className="text-xs text-zinc-500">{e.createdAt.toISOString().replace("T", " ").slice(0, 16)}</span></li>)}
        {events.length === 0 && <li className="px-4 py-4 text-zinc-500">No changes recorded.</li>}
      </ol>
    </div>
  );
}

async function RoomView({ params, searchParams }: { params: Promise<{ roomId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { roomId } = await params;
  const { tab: rawTab } = await searchParams;
  const tab = (TABS.some(([t]) => t === rawTab) ? rawTab : "beds") as Tab;
  const user = await requireRole(ACCOMMODATION_VIEW_ROLES, `/accommodation/rooms/${roomId}`);
  const data = await getRoomOccupancy(roomId);
  if (!data) notFound();
  if (!(await canSeeSite(user, "accom.view", data.room.building.siteId))) notFound();
  const { room, today, beds, summary } = data;
  const ctx = { siteId: room.building.siteId, buildingId: room.buildingId };
  const canManage = userCan(user, "setup.structure", ctx);
  const canOperate = hasRole(user, ...ALLOCATION_OPERATE_ROLES);
  const canReady = userCan(user, "accom.readiness", ctx);
  const policy = effectivePolicy(room, room.building, room.building.site);
  const [roomTypes, bedTypes, floors, units] = canManage
    ? await Promise.all([masterOptions(user.organizationId, "ROOM_TYPE", room.building.siteId), masterOptions(user.organizationId, "BED_TYPE", room.building.siteId), prisma.floor.findMany({ where: { buildingId: room.buildingId, status: { not: "ARCHIVED" } }, orderBy: { level: "asc" } }), prisma.unit.findMany({ where: { buildingId: room.buildingId, status: { not: "ARCHIVED" } }, orderBy: { code: "asc" } })])
    : [[], [], [], []];
  const readiness = new Map((await prisma.bed.findMany({ where: { roomId }, select: { id: true, readiness: true, bedType: true } })).map((b) => [b.id, b]));
  return (
    <>
      <PageHeader title={`Room ${room.code}`} status={<StatusChip status={room.status} />} subtitle={`${room.type ?? "room"} · ${policy.genderPolicy.toLowerCase()}${policy.inherited ? " (inherited)" : ""}${room.blockReason ? ` · ${room.blockReason}` : ""} · as of ${today}`} crumbs={[["Accommodation", "/accommodation"], [room.building.site.name, `/accommodation/sites/${room.building.siteId}`], [room.building.name, `/accommodation/buildings/${room.building.id}`], [`Room ${room.code}`]]} />
      <SummaryTiles summary={summary} />
      <nav className="mt-6 flex flex-wrap gap-1.5" aria-label="Room hub">
        {TABS.map(([t, label]) => <Link key={t} href={`/accommodation/rooms/${room.id}?tab=${t}`} className={`pill${t === tab ? " pill-on" : ""}`}>{label}</Link>)}
      </nav>
      <div className="mt-4">
        {tab !== "beds" ? (
          <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
            <RoomHubTab tab={tab} roomId={room.id} userCanKeys={!!userAccess(user, "keys.room_hub", ctx)} userCanAssets={!!userAccess(user, "inv.room_assets", ctx)} />
          </Suspense>
        ) : (
          <>
            <div className="overflow-x-auto card">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr><th className="px-3 py-2">Bed</th><th className="px-3 py-2">Availability</th><th className="px-3 py-2">Occupant</th><th className="px-3 py-2">From / to</th><th className="px-3 py-2">Next arrival</th>{(canManage || canReady) && <th className="px-3 py-2">Manage</th>}</tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {beds.map((bed) => (
                    <tr key={bed.id} data-bed={bed.code} className="align-top">
                      <td className="px-3 py-3 font-medium">{bed.code}{readiness.get(bed.id)?.bedType ? <div className="text-xs font-normal text-zinc-500">{readiness.get(bed.id)!.bedType!.toLowerCase().replace(/_/g, " ")}</div> : null}</td>
                      <td className="px-3 py-3">
                        <StateBadge state={bed.state} />
                        {bed.state !== "OCCUPIED" && bed.state !== "ALLOCATED" && bed.blockReason && <div className="mt-1 text-xs text-zinc-500">{bed.blockReason}</div>}
                        {(bed.state === "OCCUPIED" || bed.state === "ALLOCATED") && bed.status === "BLOCKED" && <div className="mt-1 text-xs text-red-700">Blocked: occupant needs relocating</div>}
                      </td>
                      <td className="px-3 py-3">
                        {bed.occupant ? (
                          <><div>{bed.allocationId ? <Link href={`/accommodation/allocations/${bed.allocationId}`} className="underline">{bed.occupant.name}</Link> : bed.occupant.name}</div><div className="text-xs text-zinc-500">{bed.occupant.employeeId}</div></>
                        ) : (bed.state === "VACANT" || bed.state === "NEEDS_CLEANING") && canOperate ? (
                          <Link href={`/accommodation/allocations/new?buildingId=${room.building.id}&bedId=${bed.id}`} className="text-sm underline">Allocate…</Link>
                        ) : <span className="text-zinc-400">—</span>}
                      </td>
                      <td className="px-3 py-3 tabular-nums">{bed.since ? `${bed.since} → ${bed.until ?? "open-ended"}` : <span className="text-zinc-400">—</span>}</td>
                      <td className="px-3 py-3">{bed.upcoming ? <><div>{bed.upcoming.occupant.name}</div><div className="text-xs text-zinc-500">from {bed.upcoming.startDate}</div></> : <span className="text-zinc-400">—</span>}</td>
                      {(canManage || canReady) && (
                        <td className="px-3 py-3 space-y-2">
                          {canReady && bed.state !== "OCCUPIED" && bed.state !== "ALLOCATED" && bed.state !== "DRAFT" && bed.state !== "RETIRED" && <ReadinessForm bedId={bed.id} ready={(readiness.get(bed.id)?.readiness ?? "READY") === "READY"} />}
                          {canManage && <StatusControl level="BED" id={bed.id} status={bed.status} canRestore={userCan(user, "setup.restore", ctx)} compact />}
                        </td>
                      )}
                    </tr>
                  ))}
                  {beds.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500">No beds configured.</td></tr>}
                </tbody>
              </table>
            </div>
            {canManage && (
              <div className="mt-6 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <AddBedsForm roomId={room.id} bedTypes={bedTypes} />
                  <section className="card p-4"><h3 className="font-medium">Room status</h3><p className="mt-1 text-xs text-zinc-500">Blocking a room blocks all its beds. A room with occupants cannot be archived.</p><StatusControl level="ROOM" id={room.id} status={room.status} canRestore={userCan(user, "setup.restore", ctx)} /></section>
                </div>
                <RoomEditForm roomId={room.id} opts={{ floors: floors.map((f) => ({ id: f.id, name: f.name })), units: units.map((u) => ({ id: u.id, name: u.name })), roomTypes, bedTypes }} room={{ type: room.type, floorId: room.floorId, unitId: room.unitId, genderPolicy: room.genderPolicy, inheritsPolicy: room.inheritsPolicy, amenities: room.amenities, attachedBath: room.attachedBath, areaSqm: room.areaSqm?.toString() ?? null, monthlyCharge: room.monthlyCharge?.toString() ?? null }} />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default function RoomPage({ params, searchParams }: PageProps<"/accommodation/rooms/[roomId]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <RoomView params={params} searchParams={searchParams as Promise<{ tab?: string }>} />
      </Suspense>
    </main>
  );
}
