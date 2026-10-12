import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/authorize";
import { accessFor, allowedTransitions, getWorkOrder, listAttachments, locationLabel, reopenWindowOpen, visibleNotes } from "@/modules/maintenance/service";
import { actorOf } from "@/modules/maintenance/context";
import { NoteList, PriorityLabel, WorkOrderStatusBadge } from "@/modules/maintenance/components/views";
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
        <h1 className="text-2xl font-semibold">{wo.category}</h1>
        <WorkOrderStatusBadge status={wo.status} />
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{wo.ticketNumber} · {locationLabel(wo)} · <PriorityLabel priority={wo.priority} /></p>
      <p className="mt-3 whitespace-pre-line text-sm">{wo.description}</p>
      {wo.assignee || wo.vendor ? <p className="mt-2 text-xs text-zinc-500">Being handled by {wo.assignee?.name ?? wo.vendor?.name}.</p> : <p className="mt-2 text-xs text-zinc-500">Waiting for the maintenance team to pick this up.</p>}
      {wo.status === "RESOLVED" && (
        <div className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-900 dark:bg-green-950 dark:text-green-200">
          <div className="font-medium">Marked resolved</div>
          <p className="mt-1">{wo.resolutionNote}</p>
          <p className="mt-1 text-xs">Please confirm below, or reopen if the problem persists.</p>
        </div>
      )}
      {wo.status === "WAITING_STAFF" && <p className="mt-4 rounded-lg bg-orange-50 p-3 text-sm text-orange-900 dark:bg-orange-950 dark:text-orange-200">The team needs something from you. Check the latest note and reply below.</p>}

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Updates</h2>
        <div className="mt-2"><NoteList notes={visibleNotes(wo, access)} photos={photos} /></div>
      </section>

      <section className="mt-6 space-y-4">
        <StatusForm workOrderId={wo.id} options={options} noteLabel="Note (required to reopen or cancel)" />
        {!["CLOSED", "CANCELLED"].includes(wo.status) && <NoteForm workOrderId={wo.id} allowInternal={false} />}
      </section>
    </>
  );
}

export default function MyWorkOrderPage({ params }: PageProps<"/my/maintenance/[workOrderId]">) {
  return (
    <main>
      <p className="text-sm"><Link href="/my/maintenance" className="underline">Maintenance</Link></p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content params={params} />
      </Suspense>
    </main>
  );
}
