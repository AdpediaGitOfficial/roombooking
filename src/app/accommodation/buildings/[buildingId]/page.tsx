import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/authorize";
import { ACCOMMODATION_VIEW_ROLES } from "@/modules/accommodation/access";
import { getBuildingOccupancy } from "@/modules/accommodation/occupancy";
import { SummaryTiles } from "@/modules/accommodation/components/summary-tiles";

async function BuildingView({ params }: { params: Promise<{ buildingId: string }> }) {
  const { buildingId } = await params;
  await requireRole(ACCOMMODATION_VIEW_ROLES, `/accommodation/buildings/${buildingId}`);
  const data = await getBuildingOccupancy(buildingId);
  if (!data) notFound();
  const { building, today, rooms, summary } = data;
  return (
    <>
      <h1 className="page-title">{building.name}</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-600">
        {building.site.name} · {building.type.toLowerCase()} · as of {today}
      </p>
      <SummaryTiles summary={summary} />
      <h2 className="mt-8 text-lg font-semibold">Rooms</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {rooms.map(({ room, summary: s }) => (
          <li key={room.id} className="card p-4">
            <div className="flex items-center justify-between">
              <Link href={`/accommodation/rooms/${room.id}`} className="font-medium underline">Room {room.code}</Link>
              {room.status !== "ACTIVE" && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">
                  {room.status.toLowerCase()}
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {room.type ?? "room"}{room.floor ? ` · floor ${room.floor}` : ""} · {room.genderPolicy.toLowerCase()}
            </div>
            <div className="mt-2 text-sm tabular-nums text-zinc-600">
              {s.occupied}/{s.capacity} occupied · {s.vacant} vacant · {s.blocked} blocked
            </div>
          </li>
        ))}
        {rooms.length === 0 && <li className="text-sm text-zinc-500">No rooms.</li>}
      </ul>
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
