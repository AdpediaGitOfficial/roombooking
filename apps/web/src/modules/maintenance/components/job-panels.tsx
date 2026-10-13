import type { WorkOrderRecord, WorkOrderAccess } from "@sam/core/modules/maintenance/service";
import { costThreshold, listParts, permitsFor, HOLD_REASONS, PERMIT_TYPES } from "@sam/core/modules/maintenance/extras";
import { ActionForm } from "@/components/forms/action-form";
import { acceptAction, costDecisionAction, estimateAction, holdAction, partAction, permitCloseAction, permitDecisionAction, permitRequestAction, recordWorkAction, resumeAction, verifyAction } from "../extras-actions";

type Can = (key: string) => boolean;
const money = (n: unknown) => (n == null ? "—" : Number(n).toFixed(2));

/** Cost, permit, parts and verification panels for a work order, each shown only to the roles that act on it. */
export async function JobPanels({ wo, access, can, isRequester }: { wo: WorkOrderRecord; access: WorkOrderAccess; can: Can; isRequester: boolean }) {
  const [threshold, parts, permits] = await Promise.all([costThreshold(), listParts(wo.id), permitsFor(wo.id)]);
  const worker = access === "assignee" || access === "vendor";
  const coordinator = access === "coordinator";
  const active = !["CLOSED", "CANCELLED", "RESOLVED", "VERIFIED"].includes(wo.status);
  const amount = wo.costEstimate == null ? null : Number(wo.costEstimate);
  const mayDecideCost = wo.costApprovalStatus === "PENDING" && amount != null && can(amount > threshold ? "maint.cost_above" : "maint.cost_within");
  const openPermit = permits.find((p) => p.status === "REQUESTED" || p.status === "APPROVED");

  return (
    <>
      {(worker || coordinator) && active && (
        <section className="panel">
          <div className="panel-head"><div><h2>Job</h2></div></div>
          <div className="panel-body grid gap-3">
            {worker && (wo.status === "ASSIGNED" || wo.status === "REOPENED") && <ActionForm compact action={acceptAction} hidden={{ workOrderId: wo.id }} submit="Accept this job" />}
            {wo.status === "ON_HOLD" && <><p className="text-sm text-zinc-600">On hold: {wo.holdReason}</p><ActionForm compact tone="secondary" action={resumeAction} hidden={{ workOrderId: wo.id }} submit="Resume" /></>}
            {wo.status !== "ON_HOLD" && ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "REOPENED", "TRIAGED"].includes(wo.status) && (
              <details><summary className="cursor-pointer text-sm font-medium">Put on hold</summary>
                <div className="mt-2"><ActionForm compact tone="secondary" action={holdAction} hidden={{ workOrderId: wo.id }} submit="Hold" fields={[{ name: "reason", label: "Reason", type: "select", options: HOLD_REASONS.map((r) => ({ value: r, label: r })) }, { name: "detail", label: "Details" }]} /></div>
              </details>
            )}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head"><div><h2>Cost</h2><p>Threshold {threshold.toFixed(0)}: above it an Admin approves</p></div></div>
        <div className="panel-body grid gap-3 text-sm">
          <dl className="kv"><dt>Estimate</dt><dd>{money(wo.costEstimate)} <span className="chip">{wo.costApprovalStatus.toLowerCase()}</span></dd>{wo.costActual != null && <><dt>Actual</dt><dd>{money(wo.costActual)}</dd></>}{wo.quoteRef && <><dt>Quote ref</dt><dd>{wo.quoteRef}</dd></>}{wo.laborHours != null && <><dt>Labour</dt><dd>{Number(wo.laborHours)} h</dd></>}{wo.rootCause && <><dt>Root cause</dt><dd>{wo.rootCause}</dd></>}</dl>
          {(worker || coordinator) && active && wo.costApprovalStatus !== "PENDING" && (
            <details><summary className="cursor-pointer font-medium">{wo.costEstimate == null ? "Submit a cost estimate" : "Revise the estimate"}</summary>
              <div className="mt-2"><ActionForm compact action={estimateAction} hidden={{ workOrderId: wo.id }} submit="Submit for approval" fields={[{ name: "amount", label: "Estimated cost", type: "number", step: "0.01", required: true }, { name: "quoteRef", label: "Quote / invoice reference" }, { name: "note", label: "Note" }]} /></div>
            </details>
          )}
          {mayDecideCost && (
            <div className="grid gap-2">
              <ActionForm compact action={costDecisionAction} hidden={{ workOrderId: wo.id, decision: "approve" }} submit="Approve cost" fields={[{ name: "note", label: "Note (optional)" }]} />
              <ActionForm compact tone="danger" action={costDecisionAction} hidden={{ workOrderId: wo.id, decision: "reject" }} submit="Reject cost" fields={[{ name: "note", label: "Reason", required: true }]} />
            </div>
          )}
          {wo.costApprovalStatus === "PENDING" && !mayDecideCost && <p className="text-xs text-zinc-500">Waiting for {amount != null && amount > threshold ? "an Admin" : "the Coordinator"} to approve. Work cannot start until then.</p>}
        </div>
      </section>

      {(worker || coordinator || permits.length > 0) && (
        <section className="panel">
          <div className="panel-head"><div><h2>Work permit</h2><p>High-risk work cannot start without one</p></div></div>
          <div className="panel-body grid gap-3 text-sm">
            {permits.map((p) => (
              <div key={p.id} className="rounded-md border border-zinc-200 p-2">
                <div className="flex justify-between gap-2"><b>{p.type}</b><span className="chip">{p.status.toLowerCase()}</span></div>
                {p.hazards && <div className="text-xs text-zinc-600">Hazards: {p.hazards}</div>}
                {p.controls && <div className="text-xs text-zinc-600">Controls: {p.controls}</div>}
                {p.validTo && <div className="text-xs text-zinc-500">Valid to {p.validTo.toISOString().slice(0, 16).replace("T", " ")}</div>}
                {p.status === "REQUESTED" && can("maint.permit") && p.requestedById !== undefined && (
                  <div className="mt-2 grid gap-2">
                    <ActionForm compact action={permitDecisionAction} hidden={{ permitId: p.id, decision: "approve" }} submit="Approve permit" fields={[{ name: "validTo", label: "Valid until", type: "datetime-local" }, { name: "note", label: "Note" }]} />
                    <ActionForm compact tone="danger" action={permitDecisionAction} hidden={{ permitId: p.id, decision: "reject" }} submit="Reject permit" fields={[{ name: "note", label: "Reason", required: true }]} />
                  </div>
                )}
                {p.status === "APPROVED" && (worker || coordinator) && <div className="mt-2"><ActionForm compact tone="secondary" action={permitCloseAction} hidden={{ permitId: p.id }} submit="Close permit (work finished)" /></div>}
              </div>
            ))}
            {(worker || coordinator) && active && !openPermit && <details><summary className="cursor-pointer font-medium">Request a permit</summary><div className="mt-2"><ActionForm compact action={permitRequestAction} hidden={{ workOrderId: wo.id }} submit="Request permit" fields={[{ name: "type", label: "Type of work", type: "select", options: PERMIT_TYPES.map((t) => ({ value: t, label: t })) }, { name: "hazards", label: "Hazards", type: "textarea" }, { name: "controls", label: "Controls", type: "textarea" }]} /></div></details>}
          </div>
        </section>
      )}

      {(worker || coordinator || parts.length > 0) && (
        <section className="panel">
          <div className="panel-head"><div><h2>Parts & labour</h2></div></div>
          <div className="panel-body grid gap-3 text-sm">
            <ul className="divide-y divide-zinc-100">{parts.map((p) => <li key={p.id} className="flex justify-between py-1"><span>{p.quantity} × {p.name}</span><span className="text-zinc-500">{p.unitCost != null ? money(Number(p.unitCost) * p.quantity) : ""}</span></li>)}{parts.length === 0 && <li className="py-1 text-zinc-500">No parts recorded.</li>}</ul>
            {(worker || coordinator) && wo.status !== "CLOSED" && wo.status !== "CANCELLED" && (
              <>
                <details><summary className="cursor-pointer font-medium">Record a part</summary><div className="mt-2"><ActionForm compact action={partAction} hidden={{ workOrderId: wo.id }} submit="Record part" fields={[{ name: "name", label: "Part" }, { name: "quantity", label: "Quantity", type: "number", defaultValue: 1, min: 1 }, { name: "unitCost", label: "Unit cost", type: "number", step: "0.01" }]} /></div></details>
                <details><summary className="cursor-pointer font-medium">Record labour & root cause</summary><div className="mt-2"><ActionForm compact action={recordWorkAction} hidden={{ workOrderId: wo.id }} submit="Save" fields={[{ name: "laborHours", label: "Hours worked", type: "number", step: "0.25", defaultValue: wo.laborHours == null ? "" : Number(wo.laborHours) }, { name: "costActual", label: "Actual cost", type: "number", step: "0.01", defaultValue: wo.costActual == null ? "" : Number(wo.costActual) }, { name: "rootCause", label: "Root cause", type: "textarea", defaultValue: wo.rootCause ?? "" }]} /></div></details>
              </>
            )}
          </div>
        </section>
      )}

      {wo.status === "RESOLVED" && (isRequester || can("maint.verify")) && (
        <section className="panel">
          <div className="panel-head"><div><h2>Verify & rate</h2><p>Is the problem fixed?</p></div></div>
          <div className="panel-body"><ActionForm compact action={verifyAction} hidden={{ workOrderId: wo.id }} submit="Verify the job" fields={[{ name: "rating", label: "Rating", type: "select", options: [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} ${"★".repeat(n)}` })) }, { name: "comment", label: "Comment" }]} /></div>
        </section>
      )}
      {wo.rating != null && <p className="text-xs text-zinc-500">Rated {wo.rating}/5{wo.ratingNote ? `: ${wo.ratingNote}` : ""}</p>}
    </>
  );
}
