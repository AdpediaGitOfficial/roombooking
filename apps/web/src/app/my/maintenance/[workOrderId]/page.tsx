import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/authorize";
import { accessFor, allowedTransitions, getWorkOrder, listAttachments, locationLabel, reopenWindowOpen, visibleNotes } from "@sam/core/modules/maintenance/service";
import { actorOf } from "@/modules/maintenance/context";
import { NoteList, PriorityLabel, WorkOrderStatusBadge } from "@/modules/maintenance/components/views";
import { ActionForm } from "@/components/forms/action-form";
import { verifyAction } from "@/modules/maintenance/extras-actions";
import { NoteForm, StatusForm } from "@/modules/maintenance/components/forms";

async function Content({ params }: { params: Promise<{ workOrderId: string }> }) {
  const { workOrderId } = await params;
  const user = await requireUser(`/my/maintenance/${workOrderId}`);
  const wo = await getWorkOrder(workOrderId);
  // Residents only see their own tickets.
  if (!wo || wo.requesterId !== user.id) notFound();
  const actor = actorOf(user);
  const access = accessFor(wo, actor) === "coordinator" ? "requester" : accessFor(wo, actor);
  const photos = await listAttachments(wo.id);
  const options = allowedTransitions(wo.status, "requester", { reopenWindowOpen: reopenWindowOpen(wo) });

  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="page-title">{wo.category}</h1>
        <WorkOrderStatusBadge status={wo.status} />
      </div>
      <p className="mt-1 text-sm text-zinc-600">{wo.ticketNumber} · {locationLabel(wo)} · <PriorityLabel priority={wo.priority} /></p>
      <p className="mt-3 whitespace-pre-line text-sm">{wo.description}</p>
      {wo.assignee || wo.vendor ? <p className="mt-2 text-xs text-zinc-500">Being handled by {wo.assignee?.name ?? wo.vendor?.name}.</p> : <p className="mt-2 text-xs text-zinc-500">Waiting for the maintenance team to pick this up.</p>}
      {wo.status === "RESOLVED" && (
        <div className="alert alert-success mt-4"><span>✓</span><div><b>Marked resolved{wo.resolvedAt ? ` on ${wo.resolvedAt.toISOString().slice(0, 10)}` : ""}.</b> {wo.resolutionNote}<div className="mt-1 text-xs">Is it fixed? Confirm below, or reopen if the problem persists.</div></div></div>
      )}
      {wo.status === "WAITING_STAFF" && <p className="alert alert-warning mt-4"><span>!</span><span>The team needs something from you. Check the latest note and reply below.</span></p>}

      <section className="mt-6">
        <h2 className="section-title">Updates</h2>
        <div className="mt-2"><NoteList notes={visibleNotes(wo, access)} photos={photos} /></div>
      </section>

      <section className="mt-6 space-y-4">
        {wo.status === "RESOLVED" && <ActionForm action={verifyAction} hidden={{ workOrderId: wo.id }} title="Confirm it is fixed" submit="Verify and rate" fields={[{ name: "rating", label: "Rating", type: "select", options: [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} ${"★".repeat(n)}` })) }, { name: "comment", label: "Comment" }]} />}
        <StatusForm workOrderId={wo.id} options={options} noteLabel="Note (required to reopen or cancel)" />
        {!["CLOSED", "CANCELLED"].includes(wo.status) && <NoteForm workOrderId={wo.id} allowInternal={false} />}
      </section>
    </>
  );
}

export default function MyWorkOrderPage({ params }: PageProps<"/my/maintenance/[workOrderId]">) {
  return (
    <main>
      <p className="crumb"><Link href="/my/maintenance">‹ Maintenance</Link></p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content params={params} />
      </Suspense>
    </main>
  );
}
