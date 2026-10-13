import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/authorize";
import { toFormStrings, type FormData } from "@sam/core/modules/requests/forms";
import { api, orNotFound } from "@/lib/api";
import { RequestDetails, RequestHistory, RequestStatusBadge, RequestSteps } from "@/modules/requests/components/request-view";
import { DynamicForm } from "@/modules/requests/components/dynamic-form";
import { WithdrawForm } from "@/modules/requests/components/forms";

async function RequestContent({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  await requireUser(`/my/requests/${requestId}`);
  // Residents only ever see their own requests (SRS 3.1); the API answers 404 for anyone else's.
  const { request, fields } = await orNotFound(api.requests.getMine({ id: requestId }));

  const canResubmit = request.status === "CHANGES_REQUESTED" || request.status === "EXPIRED";
  const lastReturn = request.decisions.filter((d) => d.action === "REQUEST_CHANGES").at(-1);

  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="page-title">{request.requestType.name}</h1>
        <RequestStatusBadge request={request} />
      </div>
      <p className="mt-1 text-xs text-zinc-500">Submitted {request.createdAt.toISOString().slice(0, 10)} · reference {request.id.slice(-8).toUpperCase()}</p>
      <RequestSteps request={request} />

      {canResubmit ? (
        <section className="mt-6">
          <div className="rounded-lg bg-orange-50 p-3 text-sm text-orange-900">
            <div className="font-medium">{request.status === "EXPIRED" ? "Expired without a decision" : "Returned for changes"}</div>
            {request.status === "EXPIRED" ? <p className="mt-1">It was not decided within the time allowed. Resubmit it below if it is still needed.</p> : lastReturn?.comment && <p className="mt-1 whitespace-pre-line">{lastReturn.comment}</p>}
          </div>
          <h2 className="mt-4 text-lg font-semibold">Update and resubmit</h2>
          <div className="mt-2">
            <DynamicForm mode="resubmit" requestId={request.id} fields={fields} initialValues={toFormStrings((request.data ?? {}) as FormData)} />
          </div>
        </section>
      ) : (
        <section className="mt-6">
          <h2 className="section-title">Details</h2>
          <div className="mt-2"><RequestDetails request={request} /></div>
        </section>
      )}

      {request.fulfilmentNote && (request.status === "APPROVED" || request.status === "FULFILLED") && (
        <p className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-900">{request.fulfilmentNote}</p>
      )}

      <section className="mt-6">
        <h2 className="section-title">History</h2>
        <RequestHistory request={request} showApproverNames={false} />
      </section>

      {(request.status === "PENDING_APPROVAL" || request.status === "CHANGES_REQUESTED") && (
        <section className="mt-6"><WithdrawForm requestId={request.id} /></section>
      )}
    </>
  );
}

export default function MyRequestPage({ params }: PageProps<"/my/requests/[requestId]">) {
  return (
    <main>
      <p className="text-sm"><Link href="/my/requests" className="underline">Requests</Link></p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <RequestContent params={params} />
      </Suspense>
    </main>
  );
}
