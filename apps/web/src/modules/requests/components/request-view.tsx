import Link from "next/link";
import type { RequestRecord } from "@sam/core/modules/requests/service";
import { describeStatus, summarizeRequest } from "@sam/core/modules/requests/service";

const STATUS_STYLE: Record<string, string> = {
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  CHANGES_REQUESTED: "bg-orange-100 text-orange-800",
  APPROVED: "bg-blue-100 text-blue-800",
  FULFILLED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
  CANCELLED: "bg-zinc-200 text-zinc-700",
  EXPIRED: "bg-red-100 text-red-800",
};

export function RequestStatusBadge({ request }: { request: Parameters<typeof describeStatus>[0] }) {
  const style = STATUS_STYLE[request.status] ?? "bg-zinc-100 text-zinc-700";
  return <span data-status={request.status} className={`chip ${style}`}>{describeStatus(request)}</span>;
}

export function RequestSteps({ request }: { request: RequestRecord }) {
  const steps = request.workflowVersion.steps;
  if (steps.length === 0) return null;
  return (
    <ol className="mt-3 flex flex-wrap gap-2 text-xs">
      {steps.map((s) => {
        const decided = request.decisions.filter((d) => d.stepId === s.id && d.submissionVersion === request.submissionVersion).at(-1);
        const active = request.status === "PENDING_APPROVAL" && request.currentStepOrder === s.order;
        const done = decided?.action === "APPROVE" || (request.currentStepOrder !== null && request.currentStepOrder > s.order) || ["APPROVED", "FULFILLED"].includes(request.status);
        const cls = active ? "border-amber-400 bg-amber-50" : done ? "border-green-400 bg-green-50" : "border-zinc-300";
        return (
          <li key={s.id} className={`rounded-full border px-3 py-1 ${cls}`}>
            {s.order}. {s.name}{active ? " · pending" : done ? " · approved" : ""}
          </li>
        );
      })}
    </ol>
  );
}

export function RequestDetails({ request }: { request: RequestRecord }) {
  const rows = summarizeRequest(request);
  return (
    <dl className="divide-y divide-zinc-200 card px-4">
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between gap-4 py-2 text-sm">
          <dt className="text-zinc-500">{r.label}</dt>
          <dd className="text-right whitespace-pre-line">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RequestHistory({ request, showApproverNames }: { request: RequestRecord; showApproverNames: boolean }) {
  type Item = { at: Date; title: string; body?: string | null; kind: "submission" | "decision" };
  const items: Item[] = [
    ...request.submissions.map<Item>((s) => ({ at: s.submittedAt, kind: "submission", title: s.version === 1 ? "Submitted" : `Resubmitted (version ${s.version})` })),
    ...request.decisions.map<Item>((d) => ({
      at: d.createdAt,
      kind: "decision",
      title: `${d.action === "APPROVE" ? "Approved" : d.action === "REJECT" ? "Rejected" : "Changes requested"} · ${d.step.name}${showApproverNames ? ` · ${d.approver.name}${d.onBehalfOf ? ` (on behalf of ${d.onBehalfOf.name})` : ""}` : d.onBehalfOf ? " · by absence cover" : ""}`,
      body: d.comment,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (request.fulfilledAt) items.push({ at: request.fulfilledAt, kind: "decision", title: "Completed", body: request.fulfilmentNote });
  else if (request.fulfilmentNote && request.status === "APPROVED") items.push({ at: request.decidedAt ?? request.updatedAt, kind: "decision", title: "Approved", body: request.fulfilmentNote });

  return (
    <ol className="mt-2 space-y-3">
      {items.map((i, idx) => (
        <li key={idx} className="card p-3 text-sm">
          <div className="flex justify-between gap-3">
            <span className="font-medium">{i.title}</span>
            <span className="text-xs text-zinc-500 tabular-nums">{i.at.toISOString().replace("T", " ").slice(0, 16)}</span>
          </div>
          {i.body && <p className="mt-1 whitespace-pre-line text-zinc-700">{i.body}</p>}
        </li>
      ))}
    </ol>
  );
}

export function RoomChangeFulfilmentLink({ request }: { request: RequestRecord }) {
  if (request.requestType.code !== "ROOM_CHANGE" || request.status !== "APPROVED") return null;
  const staffId = request.requester.staffProfile?.id;
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm">
      <div className="font-medium">Approved room change awaiting the move</div>
      <p className="mt-1">Complete it from the resident&apos;s current allocation: choose the new bed on the transfer page and the request will close automatically.</p>
      {staffId && (
        <Link href={`/accommodation/allocations?filter=active&staffId=${staffId}&requestId=${request.id}`} className="mt-2 inline-block underline">Find their allocation</Link>
      )}
    </div>
  );
}
