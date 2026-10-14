// Pure request rules and record shapes: who may decide a step, access, labels and form helpers.
// No database access, so the web app and the API can both import this file.
import type { Prisma, Role } from "@prisma/client";
import { REQUEST_ADMIN_ROLES } from "./access";
import type { DelegatedRole } from "./delegation-rules";
import { parseSchema, toFormStrings, visibleFields, type FormData, type FormField, type FormSchema } from "./forms";

/** Who is acting: their own roles plus any roles held through live delegations (WF-06). */
export type Actor = { id: string; roles: Role[]; delegated?: DelegatedRole[] };

export const requestInclude = {
  requestType: true,
  workflowVersion: { include: { steps: { orderBy: { order: "asc" } } } },
  requester: { select: { id: true, name: true, email: true, organizationId: true, staffProfile: { select: { id: true, employeeId: true, firstName: true, lastName: true, department: true } } } },
  decisions: { include: { approver: { select: { id: true, name: true } }, onBehalfOf: { select: { id: true, name: true } }, step: true }, orderBy: { createdAt: "asc" } },
  submissions: { orderBy: { version: "asc" } },
  allocations: { include: { bed: true } },
} satisfies Prisma.RequestInclude;

export type RequestRecord = Prisma.RequestGetPayload<{ include: typeof requestInclude }>;

export function fieldsWithOptions(schema: FormSchema, resolved: Record<string, string[]>): FormField[] {
  return schema.fields.map((f) => (f.optionsSource ? { ...f, options: resolved[f.name] ?? [] } : f));
}

export function currentStep(request: { currentStepOrder: number | null; workflowVersion: { steps: Array<{ order: number; name: string; approverRole: Role; requireComment: boolean; id: string }> } }) {
  if (request.currentStepOrder === null) return null;
  return request.workflowVersion.steps.find((s) => s.order === request.currentStepOrder) ?? null;
}

/** The role that may decide the current step: the route's role unless escalation or an administrator reassigned it (WF-07). */
export function effectiveStepRole(request: Pick<RequestRecord, "currentStepOrder" | "workflowVersion"> & { stepRoleOverride?: Role | null }): Role | null {
  const step = currentStep(request);
  if (!step) return null;
  return request.stepRoleOverride ?? step.approverRole;
}

/** Whether the actor may decide the request at its current step. */
export function canDecide(request: Pick<RequestRecord, "status" | "requesterId" | "currentStepOrder" | "workflowVersion" | "stepRoleOverride">, actor: Actor): { ok: true; onBehalfOf: DelegatedRole | null } | { ok: false; reason: string } {
  if (request.status !== "PENDING_APPROVAL") return { ok: false, reason: "This request is not awaiting approval." };
  const step = currentStep(request);
  if (!step) return { ok: false, reason: "No approval step is pending." };
  if (request.requesterId === actor.id) return { ok: false, reason: "You cannot approve your own request." };
  const role = request.stepRoleOverride ?? step.approverRole;
  if (actor.roles.includes(role)) return { ok: true, onBehalfOf: null };
  // Delegated authority never covers the delegator's own request (WF-06).
  const cover = (actor.delegated ?? []).find((d) => d.role === role && d.delegatorId !== request.requesterId);
  if (cover) return { ok: true, onBehalfOf: cover };
  return { ok: false, reason: `This step needs a ${role.toLowerCase().replace(/_/g, " ")}.` };
}

export type RequestAccess = "requester" | "admin" | "approver" | null;

export function requestAccessFor(request: Pick<RequestRecord, "requesterId" | "workflowVersion">, actor: Actor): RequestAccess {
  if (request.requesterId === actor.id) return "requester";
  if (actor.roles.some((r) => REQUEST_ADMIN_ROLES.includes(r))) return "admin";
  const roles = [...actor.roles, ...(actor.delegated ?? []).map((d) => d.role)];
  if (request.workflowVersion.steps.some((s) => roles.includes(s.approverRole))) return "approver";
  if ((request as { stepRoleOverride?: Role | null }).stepRoleOverride && roles.includes((request as { stepRoleOverride?: Role | null }).stepRoleOverride!)) return "approver";
  return null;
}

export type InboxItem = RequestRecord & { coveringFor: string | null };

export type RequestListFilter = "pending" | "approved" | "closed" | "all";

export function summarizeRequest(request: { data: Prisma.JsonValue; workflowVersion: { formSchema: Prisma.JsonValue } }) {
  const schema = parseSchema(request.workflowVersion.formSchema);
  const data = toFormStrings((request.data ?? {}) as FormData);
  return visibleFields(schema.fields, data).map((f) => ({ label: f.label, value: f.type === "checkbox" ? (data[f.name] === "on" ? "Yes" : "No") : data[f.name] || "—" }));
}

export function describeStatus(request: { status: string; currentStepOrder: number | null; workflowVersion: { steps: Array<{ order: number; name: string }> } }): string {
  switch (request.status) {
    case "PENDING_APPROVAL": {
      const step = request.workflowVersion.steps.find((s) => s.order === request.currentStepOrder);
      const override = (request as { stepRoleOverride?: Role | null }).stepRoleOverride;
      return step ? `Awaiting: ${step.name}${override ? ` (escalated to ${override.toLowerCase().replaceAll("_", " ")})` : ""}` : "Awaiting approval";
    }
    case "EXPIRED": return "Expired without a decision";
    case "CHANGES_REQUESTED": return "Returned for changes";
    case "APPROVED": return "Approved, being actioned";
    case "FULFILLED": return "Completed";
    case "REJECTED": return "Rejected";
    case "CANCELLED": return "Withdrawn";
    default: return request.status.toLowerCase().replace(/_/g, " ");
  }
}
