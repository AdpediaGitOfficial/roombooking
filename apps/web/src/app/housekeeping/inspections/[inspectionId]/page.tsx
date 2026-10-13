import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@sam/core/lib/db";
import { requireUser, userAccess } from "@/lib/auth/authorize";
import { inspectionChecklist } from "@sam/core/modules/housekeeping/service";
import { performInspectionAction } from "@/modules/housekeeping/actions";
import { InspectionForm } from "@/modules/housekeeping/inspection-form";
import { PageHeader } from "@/components/shell/page-header";

async function Content({ params }: { params: Promise<{ inspectionId: string }> }) {
  const { inspectionId } = await params;
  const user = await requireUser(`/housekeeping/inspections/${inspectionId}`);
  const insp = await prisma.inspection.findUnique({ where: { id: inspectionId } });
  if (!insp) notFound();
  if (!userAccess(user, "house.inspect", { siteId: insp.siteId })) redirect("/forbidden");
  const [room, site] = await Promise.all([prisma.room.findUniqueOrThrow({ where: { id: insp.roomId }, include: { building: true } }), prisma.site.findUniqueOrThrow({ where: { id: insp.siteId } })]);
  const list = await inspectionChecklist(site.organizationId, insp.templateId, insp.siteId);
  if (insp.status !== "SCHEDULED") return <p className="text-sm text-zinc-600">This inspection is already {insp.status.toLowerCase().replace("_", " ")}.</p>;
  return <div className="max-w-xl"><p className="mb-3 text-sm text-zinc-600">{room.building.name} · room {room.code}</p><InspectionForm action={performInspectionAction} inspectionId={insp.id} items={list.items} /></div>;
}

export default function InspectionPage({ params }: PageProps<"/housekeeping/inspections/[inspectionId]">) {
  return <main><PageHeader title="Inspect room" crumbs={[["Housekeeping", "/housekeeping"], ["Inspections", "/housekeeping/inspections"], ["Inspect"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content params={params} /></Suspense></main>;
}
