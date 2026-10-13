import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@sam/core/lib/db";
import { canSeeSite } from "@/lib/auth/scope";
import { requireRole, userCan } from "@/lib/auth/authorize";
import { ACCOMMODATION_VIEW_ROLES } from "@sam/core/modules/accommodation/access";
import { getBuildingOccupancy } from "@sam/core/modules/accommodation/occupancy";
import { activationReview } from "@sam/core/modules/structure/service";
import { SummaryTiles } from "@/modules/accommodation/components/summary-tiles";
import { ActivationPanel, FloorUnitForms, RoomCreateForms, StatusControl } from "@/modules/structure/components/forms";
import { masterOptions } from "@/modules/structure/context";
import { StatusChip } from "@/modules/structure/components/status-chip";
import { PageHeader } from "@/components/shell/page-header";

async function BuildingView({ params }: { params: Promise<{ buildingId: string }> }) {
  const { buildingId } = await params;
  const user = await requireRole(ACCOMMODATION_VIEW_ROLES, `/accommodation/buildings/${buildingId}`);
  const data = await getBuildingOccupancy(buildingId);
  if (!data) notFound();
  if (!(await canSeeSite(user, "accom.view", data.building.siteId))) notFound();
  const { building, today, rooms, summary } = data;
  const ctx = { siteId: building.siteId, buildingId: building.id };
  const canEdit = userCan(user, "setup.structure", ctx);
  const [floors, units, roomTypes, bedTypes, review] = await Promise.all([
    prisma.floor.findMany({ where: { buildingId, status: { not: "ARCHIVED" } }, orderBy: { level: "asc" } }),
    prisma.unit.findMany({ where: { buildingId, status: { not: "ARCHIVED" } }, orderBy: { code: "asc" } }),
    masterOptions(user.organizationId, "ROOM_TYPE", building.siteId),
    masterOptions(user.organizationId, "BED_TYPE", building.siteId),
    canEdit ? activationReview("BUILDING", building.id) : Promise.resolve(null),
  ]);
  const opts = { floors: floors.map((f) => ({ id: f.id, name: f.name })), units: units.map((u) => ({ id: u.id, name: u.name })), roomTypes, bedTypes };
  const floorName = new Map(floors.map((f) => [f.id, f.name]));
  return (
    <>
      <PageHeader title={building.name} status={<StatusChip status={building.status} />} subtitle={`${building.site.name} · ${building.type.toLowerCase()} · as of ${today}`} crumbs={[["Accommodation", "/accommodation"], [building.site.name, `/accommodation/sites/${building.siteId}`], [building.name]]} />
      <SummaryTiles summary={summary} />
      <h2 className="mt-8 text-lg font-semibold">Rooms</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {rooms.map(({ room, summary: s }) => (
          <li key={room.id} className="card p-4">
            <div className="flex items-center justify-between">
              <Link href={`/accommodation/rooms/${room.id}`} className="font-medium underline">Room {room.code}</Link>
              {room.status !== "ACTIVE" && <StatusChip status={room.status} />}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {room.type ?? "room"}{room.floorId && floorName.get(room.floorId) ? ` · ${floorName.get(room.floorId)}` : room.floor ? ` · floor ${room.floor}` : ""} · {room.inheritsPolicy ? "inherits policy" : room.genderPolicy.toLowerCase()}
            </div>
            <div className="mt-2 text-sm tabular-nums text-zinc-600">
              {s.occupied}/{s.capacity} occupied · {s.vacant} vacant · {s.blocked} blocked{s.draft ? ` · ${s.draft} draft` : ""}
            </div>
          </li>
        ))}
        {rooms.length === 0 && <li className="text-sm text-zinc-500">No rooms.</li>}
      </ul>
      {canEdit && review && (
        <div className="mt-8 space-y-6">
          <ActivationPanel level="BUILDING" id={building.id} review={review} canActivate={userCan(user, "setup.activate", ctx)} />
          <RoomCreateForms buildingId={building.id} opts={opts} />
          <FloorUnitForms buildingId={building.id} floors={floors} />
          <section className="card p-4"><h3 className="font-medium">Building status</h3><p className="mt-1 text-xs text-zinc-500">Blocking a building blocks all its rooms and beds.</p><StatusControl level="BUILDING" id={building.id} status={building.status} canRestore={userCan(user, "setup.restore", ctx)} /></section>
        </div>
      )}
    </>
  );
}

export default function BuildingPage({ params }: PageProps<"/accommodation/buildings/[buildingId]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <BuildingView params={params} />
      </Suspense>
    </main>
  );
}
