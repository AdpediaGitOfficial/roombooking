import { Suspense } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/authorize";
import { APPROVALS_AREA_ROLES } from "@sam/core/modules/requests/access";
import { APPROVER_ROLES } from "@sam/core/modules/requests/builder-rules";
import { api, orNotFound } from "@/lib/api";
import { RequestDetails, RequestHistory, RequestStatusBadge, RequestSteps } from "@/modules/requests/components/request-view";
import { DecisionForm, ReassignForm } from "@/modules/requests/components/forms";
import { isoDate } from "@sam/core/modules/accommodation/occupancy-rules";

async function ApprovalContent({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  await requireRole(APPROVALS_AREA_ROLES, `/approvals/${requestId}`);
  const { request, access, currentAllocation, decision, step, effectiveRole } = await orNotFound(api.approvals.get({ id: requestId }));
  const staff = request.requester.staffProfile;

  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="page-title">{request.requestType.name}</h1>
        <RequestStatusBadge request={request} />
      </div>
      <p className="mt-1 text-sm text-zinc-600">
        {staff ? `${staff.firstName} ${staff.lastName} · ${staff.employeeId}${staff.department ? ` · ${staff.department}` : ""}` : request.requester.name}
        {" · submitted "}{request.createdAt.toISOString().slice(0, 10)}
      </p>
      <RequestSteps request={request} />

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="section-title">Request</h2>
          <div className="mt-2"><RequestDetails request={request} /></div>
          {currentAllocation && (
            <p className="mt-3 text-sm text-zinc-600">
              Current accommodation: bed {currentAllocation.bed.code}, {currentAllocation.bed.room.building.name} room {currentAllocation.bed.room.code}, since {isoDate(currentAllocation.startDate)}
              {currentAllocation.endDate ? ` until ${isoDate(currentAllocation.endDate)}` : ""}.
            </p>
          )}
          {request.fulfilmentNote && (request.status === "APPROVED" || request.status === "FULFILLED") && (
            <p className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-900">{request.fulfilmentNote}</p>
          )}
          {request.requestType.code === "ROOM_CHANGE" && request.status === "APPROVED" && currentAllocation && (
            <Link href={`/accommodation/allocations/${currentAllocation.id}/transfer?requestId=${request.id}&reason=${encodeURIComponent(`Room change request ${request.id.slice(-8).toUpperCase()}`)}`} className="mt-3 inline-block rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink">
              Complete the move
            </Link>
          )}
          {request.allocations.length > 0 && (
            <p className="mt-3 text-sm text-zinc-600">
              Linked allocation: {request.allocations.map((a) => <Link key={a.id} href={`/accommodation/allocations/${a.id}`} className="underline">bed {a.bed.code}</Link>)}
            </p>
          )}
        </section>
        <section>
          <h2 className="section-title">History</h2>
          <RequestHistory request={request} showApproverNames />
        </section>
      </div>

      <section className="mt-6">
        {decision.ok && step ? (
          <>
            {decision.onBehalfOf && <p data-on-behalf className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">You are deciding this step on behalf of {decision.onBehalfOf.delegatorName}; the decision will record both names.</p>}
            <DecisionForm requestId={request.id} requireComment={step.requireComment} stepName={step.name} />
          </>
        ) : request.status === "PENDING_APPROVAL" ? (
          <p className="text-sm text-zinc-500">{decision.ok ? "" : decision.reason}</p>
        ) : null}
        {request.status === "PENDING_APPROVAL" && request.escalationNote && <p data-escalation className="mt-3 text-xs text-amber-700">{request.escalatedAt ? "Escalated" : "Reassigned"}: {request.escalationNote}{request.stepStartedAt ? ` · step started ${request.stepStartedAt.toISOString().slice(0, 10)}` : ""}</p>}
        {request.status === "PENDING_APPROVAL" && access === "admin" && step && <div className="mt-4"><ReassignForm requestId={request.id} currentRole={effectiveRole ?? step.approverRole} roles={APPROVER_ROLES} /></div>}
      </section>
    </>
  );
}

export default function ApprovalPage({ params }: PageProps<"/approvals/[requestId]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <ApprovalContent params={params} />
      </Suspense>
    </main>
  );
}
