import { Suspense } from "react";
import Link from "next/link";
import { requireRole, requireUser, userCan } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { ACCOMMODATION_VIEW_ROLES } from "@sam/core/modules/accommodation/access";
import { getSitesOverview } from "@sam/core/modules/accommodation/occupancy";
import { SummaryTiles } from "@/modules/accommodation/components/summary-tiles";
import { PageHeader } from "@/components/shell/page-header";

async function HeaderActions() {
  const user = await requireUser("/accommodation");
  return (
    <>
      <Link href="/accommodation/allocations" className="btn">Allocations</Link>
      {userCan(user, "setup.sites") && <Link href="/accommodation/sites/new" className="btn btn-primary">＋ New site</Link>}
    </>
  );
}

async function Overview() {
  const user = await requireRole(ACCOMMODATION_VIEW_ROLES, "/accommodation");
  const sites = await getSitesOverview(await visibleSites(user, "accom.view"));
  if (sites.length === 0) return <p className="text-sm text-zinc-500">No sites configured yet.</p>;
  return (
    <div className="space-y-10">
      {sites.map(({ site, today, buildings, summary }) => (
        <section key={site.id}>
          <h2 className="section-title">
            <Link href={`/accommodation/sites/${site.id}`} className="underline">{site.name}</Link> <span className="text-sm font-normal text-zinc-500">({site.code}) · as of {today} {site.timezone}</span>
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
      <PageHeader title="Accommodation" subtitle="Sites, buildings, rooms and bed spaces." crumbs={[["Accommodation"]]} actions={<Suspense fallback={null}><HeaderActions /></Suspense>} />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Overview />
      </Suspense>
    </main>
  );
}
