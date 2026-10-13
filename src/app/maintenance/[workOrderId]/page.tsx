import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/authorize";
import { MAINTENANCE_AREA_ROLES } from "@/modules/maintenance/access";
import { CATEGORIES, accessFor, allowedTransitions, getWorkOrder, listAssignees, listAttachments, locationLabel, reopenWindowOpen, visibleNotes } from "@/modules/maintenance/service";
import { actorOf } from "@/modules/maintenance/context";
import { NoteList, PriorityLabel, SlaLabel, WorkOrderStatusBadge } from "@/modules/maintenance/components/views";
import { AssignForm, NoteForm, StatusForm, TriageForm } from "@/modules/maintenance/components/forms";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt><dd className="mt-0.5">{children}</dd></div>;
}

async function Content({ params }: { params: Promise<{ workOrderId: string }> }) {
  const { workOrderId } = await params;
  const user = await requireRole(MAINTENANCE_AREA_ROLES, `/maintenance/${workOrderId}`);
  const actor = actorOf(user);
  const wo = await getWorkOrder(workOrderId);
  if (!wo) notFound();
  const access = accessFor(wo, actor);
  if (!access) notFound();
  const now = new Date();
  const [photos, assignees] = await Promise.all([listAttachments(wo.id), access === "coordinator" ? listAssignees() : null]);
  const options = allowedTransitions(wo.status, access, { reopenWindowOpen: reopenWindowOpen(wo, now) });
  const isTerminal = wo.status === "CLOSED" || wo.status === "CANCELLED";
  const staff = wo.requester.staffProfile;
  const limited = access === "vendor"; // contractors get location and contact only (MNT-07)

  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="page-title">{wo.ticketNumber}</h1>
        <WorkOrderStatusBadge status={wo.status} />
        <PriorityLabel priority={wo.priority} />
        <SlaLabel wo={wo} now={now} />
      </div>
      <p className="mt-1 text-sm text-zinc-600">{wo.category} · {locationLabel(wo)} · raised {wo.createdAt.toISOString().replace("T", " ").slice(0, 16)}{wo.reopenCount > 0 ? ` · reopened ${wo.reopenCount}×` : ""}</p>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="section-title">Issue</h2>
          <p className="mt-2 whitespace-pre-line text-sm">{wo.description}</p>
          <dl className="mt-4 grid gap-3 card p-4 text-sm sm:grid-cols-2">
            <Field label="Reported by">{limited ? "Resident" : staff ? `${staff.firstName} ${staff.lastName} (${staff.employeeId})` : wo.requester.name}</Field>
            <Field label="Contact">{wo.preferredContact ?? (limited ? "Via the accommodation office" : (staff?.phone ?? wo.requester.email))}</Field>
            <Field label="Assigned to">{wo.assignee?.name ?? wo.vendor?.name ?? <span className="text-zinc-400">Unassigned</span>}</Field>
            <Field label="SLA target">{wo.slaDueAt ? wo.slaDueAt.toISOString().replace("T", " ").slice(0, 16) : "—"}</Field>
            {wo.startedAt && <Field label="Started">{wo.startedAt.toISOString().replace("T", " ").slice(0, 16)}</Field>}
            {wo.resolvedAt && <Field label="Resolved">{wo.resolvedAt.toISOString().replace("T", " ").slice(0, 16)}</Field>}
            {wo.resolutionNote && <Field label="Resolution">{wo.resolutionNote}</Field>}
          </dl>
          <h2 className="mt-6 text-lg font-semibold">Updates</h2>
          <div className="mt-2"><NoteList notes={visibleNotes(wo, access)} photos={photos} /></div>
        </section>

        <section className="space-y-4">
          <h2 className="section-title">Actions</h2>
          {access === "coordinator" && !isTerminal && wo.status !== "RESOLVED" && assignees && (
            <AssignForm workOrderId={wo.id} engineers={assignees.engineers.map((e) => ({ id: e.id, label: e.name }))} vendors={assignees.vendors.map((v) => ({ id: v.id, label: v.name }))} current={wo.assigneeId ? `user:${wo.assigneeId}` : wo.vendorId ? `vendor:${wo.vendorId}` : undefined} />
          )}
          {access === "coordinator" && (wo.status === "NEW" || wo.status === "TRIAGED") && <TriageForm workOrderId={wo.id} categories={CATEGORIES} category={wo.category} priority={wo.priority} />}
          <StatusForm workOrderId={wo.id} options={options} />
          {!isTerminal && access !== "auditor" && <NoteForm workOrderId={wo.id} allowInternal={access === "coordinator" || access === "assignee"} />}
          {access === "coordinator" && wo.room && <p className="text-xs text-zinc-500"><Link href={`/accommodation/rooms/${wo.room.id}`} className="underline">Open room {wo.room.code}</Link></p>}
        </section>
      </div>
    </>
  );
}

export default function WorkOrderPage({ params }: PageProps<"/maintenance/[workOrderId]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content params={params} />
      </Suspense>
    </main>
  );
}
