import { Suspense } from "react";
import Link from "next/link";
import { api, orNotFound } from "@/lib/api";
import { requireRole } from "@/lib/auth/authorize";
import { ACCOMMODATION_VIEW_ROLES } from "@sam/core/modules/accommodation/access";
import { SummaryTiles } from "@/modules/accommodation/components/summary-tiles";
import { PageHeader } from "@/components/shell/page-header";

async function BuildingView({ params }: { params: Promise<{ buildingId: string }> }) {
  const { buildingId } = await params;
  await requireRole(ACCOMMODATION_VIEW_ROLES, `/accommodation/buildings/${buildingId}`);
  const data = await orNotFound(api.accommodation.building({ buildingId }));
  const { building, today, rooms, summary } = data;
  return (
    <>
      <PageHeader
        title={building.name}
        subtitle={`${building.site.name} · ${building.type.toLowerCase()} · as of ${today}`}
        crumbs={[["Accommodation", "/accommodation"], [building.name]]}
      />
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
