import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@sam/core/lib/db";
import { requireRole, userCan } from "@/lib/auth/authorize";
import { canSeeSite } from "@/lib/auth/scope";
import { ACCOMMODATION_VIEW_ROLES } from "@sam/core/modules/accommodation/access";
import { activationReview } from "@sam/core/modules/structure/service";
import { ActivationPanel, BuildingForm, BulkBuildingsForm, SiteForm, StatusControl } from "@/modules/structure/components/forms";
import { masterOptions } from "@/modules/structure/context";
import { StatusChip } from "@/modules/structure/components/status-chip";
import { PageHeader } from "@/components/shell/page-header";


async function Content({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const user = await requireRole(ACCOMMODATION_VIEW_ROLES, `/accommodation/sites/${siteId}`);
  const site = await prisma.site.findUnique({ where: { id: siteId }, include: { buildings: { orderBy: { code: "asc" }, include: { _count: { select: { rooms: true } } } } } });
  if (!site || !(await canSeeSite(user, "accom.view", site.id))) notFound();
  const ctx = { siteId: site.id };
  const [propertyTypes, review] = await Promise.all([masterOptions(user.organizationId, "PROPERTY_TYPE"), activationReview("SITE", site.id)]);
  return (
    <>
      <PageHeader title={site.name} status={<StatusChip status={site.status} />} subtitle={`${site.code} · ${site.timezone}${site.propertyType ? ` · ${site.propertyType.toLowerCase().replace(/_/g, " ")}` : ""}`} crumbs={[["Accommodation", "/accommodation"], [site.name]]} />
      <div className="mt-6 space-y-6">
        <section className="panel">
          <div className="toolbar"><h2 className="section-title">Buildings</h2></div>
          <ul className="divide-y divide-zinc-200">
            {site.buildings.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div><Link href={`/accommodation/buildings/${b.id}`} className="font-medium underline">{b.name}</Link><span className="ml-2 text-xs text-zinc-500">{b.code} · {b._count.rooms} rooms</span></div>
                <StatusChip status={b.status} />
              </li>
            ))}
            {site.buildings.length === 0 && <li className="px-4 py-6 text-sm text-zinc-500">No buildings yet.</li>}
          </ul>
        </section>
        <ActivationPanel level="SITE" id={site.id} review={review} canActivate={userCan(user, "setup.activate", ctx)} />
        <div className="grid gap-4 lg:grid-cols-2">
          {userCan(user, "setup.buildings", ctx) && <BuildingForm siteId={site.id} />}
          {userCan(user, "setup.structure_bulk", ctx) && <BulkBuildingsForm siteId={site.id} />}
        </div>
        {userCan(user, "setup.sites") && (
          <>
            <SiteForm propertyTypes={propertyTypes} site={{ id: site.id, code: site.code, name: site.name, propertyType: site.propertyType, address: site.address, latitude: site.latitude, longitude: site.longitude, contactName: site.contactName, contactPhone: site.contactPhone, contactEmail: site.contactEmail, timezone: site.timezone, genderPolicy: site.genderPolicy }} />
            <section className="card p-4"><h3 className="font-medium">Site status</h3><StatusControl level="SITE" id={site.id} status={site.status} canRestore={userCan(user, "setup.restore", ctx)} /></section>
          </>
        )}
      </div>
    </>
  );
}

export default function SitePage({ params }: PageProps<"/accommodation/sites/[siteId]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content params={params} /></Suspense>
    </main>
  );
}
