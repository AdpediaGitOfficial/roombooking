import { Suspense } from "react";
import Link from "next/link";
import { api, orNotFound } from "@/lib/api";
import { hasRole, requireRole } from "@/lib/auth/authorize";
import { ACCOMMODATION_MANAGE_ROLES, ACCOMMODATION_VIEW_ROLES } from "@sam/core/modules/accommodation/access";
import { ALLOCATION_OPERATE_ROLES } from "@sam/core/modules/allocations/access";
import { SummaryTiles } from "@/modules/accommodation/components/summary-tiles";
import { StateBadge } from "@/modules/accommodation/components/state-badge";
import { AddBedsForm, BedStatusForm, RoomStatusForm } from "@/modules/accommodation/components/bed-forms";

async function RoomView({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const user = await requireRole(ACCOMMODATION_VIEW_ROLES, `/accommodation/rooms/${roomId}`);
  const canManage = hasRole(user, ...ACCOMMODATION_MANAGE_ROLES);
  const canOperate = hasRole(user, ...ALLOCATION_OPERATE_ROLES);
  const data = await orNotFound(api.accommodation.room({ roomId }));
  const { room, today, beds, summary } = data;

  return (
    <>
      <p className="text-sm text-zinc-600">
        <Link href={`/accommodation/buildings/${room.building.id}`} className="underline">{room.building.name}</Link>
        {" · "}{room.building.site.name}
      </p>
      <h1 className="mt-1 text-2xl font-semibold">Room {room.code}</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-600">
        {room.type ?? "room"}{room.floor ? ` · floor ${room.floor}` : ""} · {room.genderPolicy.toLowerCase()} · status {room.status.toLowerCase()}
        {room.blockReason ? ` (${room.blockReason})` : ""} · as of {today}
      </p>

      <SummaryTiles summary={summary} />

      <h2 className="mt-8 text-lg font-semibold">Bed spaces</h2>
      <div className="mt-3 overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2">Bed</th>
              <th className="px-3 py-2">Availability</th>
              <th className="px-3 py-2">Occupant</th>
              <th className="px-3 py-2">From / to</th>
              <th className="px-3 py-2">Next arrival</th>
              {canManage && <th className="px-3 py-2">Configure</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {beds.map((bed) => (
              <tr key={bed.id} data-bed={bed.code} className="align-top">
                <td className="px-3 py-3 font-medium">{bed.code}</td>
                <td className="px-3 py-3">
                  <StateBadge state={bed.state} />
                  {bed.state !== "OCCUPIED" && bed.state !== "ALLOCATED" && bed.blockReason && (
                    <div className="mt-1 text-xs text-zinc-500">{bed.blockReason}</div>
                  )}
                  {(bed.state === "OCCUPIED" || bed.state === "ALLOCATED") && bed.status === "BLOCKED" && (
                    <div className="mt-1 text-xs text-red-700">Blocked: occupant needs relocating</div>
                  )}
                </td>
                <td className="px-3 py-3">
                  {bed.occupant ? (
                    <>
                      <div>
                        {bed.allocationId ? <Link href={`/accommodation/allocations/${bed.allocationId}`} className="underline">{bed.occupant.name}</Link> : bed.occupant.name}
                      </div>
                      <div className="text-xs text-zinc-500">{bed.occupant.employeeId}</div>
                    </>
                  ) : bed.state === "VACANT" && canOperate ? (
                    <Link href={`/accommodation/allocations/new?buildingId=${room.building.id}&bedId=${bed.id}`} className="text-sm underline">Allocate…</Link>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="px-3 py-3 tabular-nums">
                  {bed.since ? `${bed.since} → ${bed.until ?? "open-ended"}` : <span className="text-zinc-400">—</span>}
                </td>
                <td className="px-3 py-3">
                  {bed.upcoming ? (
                    <>
                      <div>{bed.upcoming.occupant.name}</div>
                      <div className="text-xs text-zinc-500">from {bed.upcoming.startDate}</div>
                    </>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                {canManage && (
                  <td className="px-3 py-3">
                    <BedStatusForm bedId={bed.id} current={bed.status} />
                  </td>
                )}
              </tr>
            ))}
            {beds.length === 0 && (
              <tr><td colSpan={canManage ? 6 : 5} className="px-3 py-6 text-center text-zinc-500">No beds configured.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {canManage && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <AddBedsForm roomId={room.id} />
          <RoomStatusForm roomId={room.id} current={room.status} />
        </div>
      )}
    </>
  );
}

export default function RoomPage({ params }: PageProps<"/accommodation/rooms/[roomId]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <RoomView params={params} />
      </Suspense>
    </main>
  );
}
