import { Suspense } from "react";
import { prisma } from "@sam/core/lib/db";
import { requireCapability, userCan } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { staffOptions } from "@sam/core/modules/people/service";
import { BulkAllocateForm } from "@/modules/allocations/components/extras-forms";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireCapability("accom.bulk_allocate", { returnTo: "/accommodation/allocations/bulk" });
  const visible = await visibleSites(user, "accom.bulk_allocate");
  const [staff, sites, buildings] = await Promise.all([
    staffOptions(),
    prisma.site.findMany({ where: { status: "ACTIVE", ...(visible ? { id: { in: visible } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.building.findMany({ where: { status: "ACTIVE", ...(visible ? { siteId: { in: visible } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return <div className="max-w-3xl"><BulkAllocateForm staff={staff.map((s) => ({ id: s.id, label: `${s.firstName} ${s.lastName} (${s.employeeId})` }))} sites={sites} buildings={buildings} canOverride={userCan(user, "accom.eligibility_override")} /></div>;
}

export default function BulkAllocatePage() {
  return <main><PageHeader title="Bulk allocation" subtitle="Place a group in one go. Each person gets the first eligible bed; results are listed per person." crumbs={[["Accommodation", "/accommodation"], ["Allocations", "/accommodation/allocations"], ["Bulk"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
