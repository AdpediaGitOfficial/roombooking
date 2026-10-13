import { Suspense } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/authorize";
import { ACCOMMODATION_VIEW_ROLES } from "@/modules/accommodation/access";
import { getSitesOverview } from "@/modules/accommodation/occupancy";
import { SummaryTiles } from "@/modules/accommodation/components/summary-tiles";

async function Overview() {
  await requireRole(ACCOMMODATION_VIEW_ROLES, "/accommodation");
  const sites = await getSitesOverview();
  if (sites.length === 0) return <p className="text-sm text-zinc-500">No sites configured yet.</p>;
  return (
    <div className="space-y-10">
      {sites.map(({ site, today, buildings, summary }) => (
        <section key={site.id}>
          <h2 className="section-title">
            {site.name} <span className="text-sm font-normal text-zinc-500">({site.code}) · as of {today} {site.timezone}</span>
          </h2>
          <div className="mt-3"><SummaryTiles summary={summary} /></div>
          <ul className="mt-4 divide-y divide-zinc-200 card">
            {buildings.map(({ building, roomCount, summary: s }) => (
              <li key={building.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <Link href={`/accommodation/buildings/${building.id}`} className="font-medium underline">
                    {building.name}
                  </Link>
                  <div className="text-xs text-zinc-500">{building.type.toLowerCase()} · {roomCount} rooms</div>
                </div>
                <div className="text-sm tabular-nums text-zinc-600">
                  {s.occupied}/{s.capacity} occupied · {s.vacant} vacant · {s.blocked} blocked
                </div>
              </li>
            ))}
            {buildings.length === 0 && <li className="p-4 text-sm text-zinc-500">No buildings.</li>}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function AccommodationPage() {
  return (
    <main>
      <h1 className="page-title">Accommodation</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-600">Sites, buildings, rooms and bed spaces.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Overview />
      </Suspense>
    </main>
  );
}
