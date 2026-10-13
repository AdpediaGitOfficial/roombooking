import type { Prisma } from "@prisma/client";

type BedResult = Prisma.BedGetPayload<{ include: { room: { include: { building: { include: { site: true } } } } } }>;

export function BedResultList({ beds, render }: { beds: BedResult[]; render: (bed: BedResult) => React.ReactNode }) {
  if (beds.length === 0) {
    return <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">No beds are available for those criteria.</p>;
  }
  return (
    <ul className="divide-y divide-zinc-200 card">
      {beds.map((bed) => (
        <li key={bed.id} data-bed={bed.code} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <div className="font-medium">Bed {bed.code}</div>
            <div className="text-xs text-zinc-500">
              {bed.room.building.site.name} · {bed.room.building.name} · Room {bed.room.code}
              {bed.room.type ? ` (${bed.room.type.toLowerCase()})` : ""} · {bed.room.genderPolicy.toLowerCase()}
            </div>
          </div>
          {render(bed)}
        </li>
      ))}
    </ul>
  );
}
