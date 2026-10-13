import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole, userAccess, userCan } from "@/lib/auth/authorize";
import { MAINTENANCE_AREA_ROLES } from "@sam/core/modules/maintenance/access";
import { CATEGORIES, accessFor, allowedTransitions, getWorkOrder, listAssignees, listAttachments, locationLabel, reopenWindowOpen, visibleNotes } from "@sam/core/modules/maintenance/service";
import { actorOf } from "@/modules/maintenance/context";
import { NoteList, PriorityLabel, SlaLabel, WorkOrderStatusBadge } from "@/modules/maintenance/components/views";
import { AssignForm, NoteForm, StatusForm, TriageForm } from "@/modules/maintenance/components/forms";
import { JobPanels } from "@/modules/maintenance/components/job-panels";
import { PageHeader } from "@/components/shell/page-header";

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
  // Resident name and contact on a ticket follow the permission matrix: full for admins, officers and coordinators,
  // first name only for technicians, nothing for contractors (document sections 5.4 and 9).
  const contact = userAccess(user, "maint.requester_contact", { siteId: wo.siteId, buildingId: wo.buildingId });
  const detail = access === "requester" || contact?.level === "full" ? "full" : contact ? "first" : "none";
  const limited = detail === "none";

  const stamp = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16);
  const fullName = staff ? `${staff.firstName} ${staff.lastName}` : wo.requester.name;
  const reporter = detail === "none" ? "Resident" : detail === "first" ? fullName.split(" ")[0] : fullName;
  return (
    <>
      <PageHeader
        crumbs={[["Maintenance", "/maintenance"], [wo.ticketNumber]]}
        title={wo.category}
        status={<><WorkOrderStatusBadge status={wo.status} /><PriorityLabel priority={wo.priority} /></>}
        subtitle={`${wo.ticketNumber} · ${locationLabel(wo)} · raised ${stamp(wo.createdAt)}${wo.reopenCount > 0 ? ` · reopened ${wo.reopenCount}×` : ""}`}
        actions={<SlaLabel wo={wo} now={now} />}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4 content-start">
          <section className="panel">
            <div className="panel-head"><div><h2>Issue</h2><p>As reported{limited ? "" : ` by ${reporter}`}</p></div></div>
            <div className="panel-body whitespace-pre-line text-sm">{wo.description}</div>
            {wo.resolutionNote && <div className="panel-foot"><span><b className="text-zinc-700">Resolution:</b> {wo.resolutionNote}</span></div>}
          </section>
          <section className="panel">
            <div className="panel-head"><div><h2>Activity</h2><p>Newest first</p></div></div>
            <div className="panel-body">
              <NoteList notes={visibleNotes(wo, access)} photos={photos} />
              {!isTerminal && access !== "auditor" && <div className="mt-4 border-t border-zinc-200 pt-4"><NoteForm workOrderId={wo.id} allowInternal={access === "coordinator" || access === "assignee"} /></div>}
            </div>
          </section>
        </div>

        <div className="grid gap-4 content-start">
          <section className="panel">
            <div className="panel-head"><div><h2>Status</h2></div></div>
            <div className="panel-body">
              <dl className="kv">
                <dt>Priority</dt><dd><PriorityLabel priority={wo.priority} /></dd>
                <dt>SLA target</dt><dd>{wo.slaDueAt ? <>{stamp(wo.slaDueAt)} <SlaLabel wo={wo} now={now} /></> : "—"}</dd>
                <dt>Assigned to</dt><dd>{wo.assignee ? <div className="who"><span className="av">{wo.assignee.name.split(" ").map((x) => x[0]).join("").slice(0, 2)}</span><b>{wo.assignee.name}</b></div> : wo.vendor ? <>{wo.vendor.name} <span className="sub">vendor</span></> : <span className="chip chip-warning">Unassigned</span>}</dd>
                <dt>Category</dt><dd>{wo.category}</dd>
                <dt>Location</dt><dd>{locationLabel(wo)}{access === "coordinator" && wo.room && <> · <Link href={`/accommodation/rooms/${wo.room.id}`} className="underline">open room</Link></>}</dd>
                {wo.startedAt && <><dt>Started</dt><dd>{stamp(wo.startedAt)}</dd></>}
                {wo.resolvedAt && <><dt>Resolved</dt><dd>{stamp(wo.resolvedAt)}</dd></>}
              </dl>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><div><h2>Reported by</h2></div></div>
            <div className="panel-body">
              <div className="who"><span className="av">{reporter.split(" ").map((x) => x[0]).join("").slice(0, 2)}</span><div><b>{reporter}</b><small>{detail !== "full" ? "Contact via the accommodation office" : staff ? `${staff.employeeId} · ${staff.phone ?? wo.requester.email ?? ""}` : wo.requester.email}</small></div></div>
              {wo.preferredContact && <p className="mt-2 text-xs text-zinc-500">Preferred contact: {wo.preferredContact}</p>}
            </div>
          </section>
          <JobPanels wo={wo} access={access} can={(k) => userCan(user, k, { siteId: wo.siteId, buildingId: wo.buildingId })} isRequester={wo.requesterId === user.id} />
          <section className="panel">
            <div className="panel-head"><div><h2>Actions</h2></div></div>
            <div className="panel-body grid gap-4">
              {access === "coordinator" && !isTerminal && wo.status !== "RESOLVED" && assignees && (
                <AssignForm workOrderId={wo.id} engineers={assignees.engineers.map((e) => ({ id: e.id, label: e.name }))} vendors={assignees.vendors.map((v) => ({ id: v.id, label: v.name }))} current={wo.assigneeId ? `user:${wo.assigneeId}` : wo.vendorId ? `vendor:${wo.vendorId}` : undefined} />
              )}
              {access === "coordinator" && (wo.status === "NEW" || wo.status === "TRIAGED") && <TriageForm workOrderId={wo.id} categories={CATEGORIES} category={wo.category} priority={wo.priority} />}
              <StatusForm workOrderId={wo.id} options={options} />
            </div>
          </section>
        </div>
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
