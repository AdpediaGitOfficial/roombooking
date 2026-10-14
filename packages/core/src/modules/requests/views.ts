// Everything a requests, approvals, delegations or form-builder page needs,
// assembled in one call each so the API can serve a page in a single round trip.
import type { Role } from "@prisma/client";
import { prisma } from "../../lib/db";
import { listTypes, getType } from "./builder";
import { delegatableRoles, delegateOptions, delegatorOptions, isoDay, listDelegations } from "./delegations";
import { RequestError } from "./errors";
import { parseSchema } from "./forms";
import { canDecide, currentStep, effectiveStepRole, fieldsWithOptions, getCurrentWorkflow, getRequest, listAllRequests, listInbox, listMyRequests, listRequestTypes, requestAccessFor, resolveFieldOptions, withDelegations, type RequestListFilter } from "./service";
import { REQUEST_ADMIN_ROLES } from "./access";

const notFound = () => new RequestError("NOT_FOUND", "Request not found.");

/** Request types a resident can start. */
export async function startableTypes(organizationId: string) {
  return listRequestTypes(organizationId);
}

/** A request type's current form, with option lists resolved, ready to render. */
export async function newRequestForm(organizationId: string, typeCode: string) {
  const workflow = await getCurrentWorkflow(organizationId, typeCode);
  if (!workflow) throw new RequestError("NOT_FOUND", "That request type is not available.");
  const fields = fieldsWithOptions(workflow.schema, await resolveFieldOptions(workflow.schema));
  return { type: workflow.type, steps: workflow.version.steps, fields };
}

export async function myRequests(userId: string) {
  return listMyRequests(userId);
}

/** One of the resident's own requests; when it can be edited and resent, the form fields come too. */
export async function myRequestView(userId: string, requestId: string) {
  const request = await getRequest(requestId);
  // Residents only ever see their own requests (SRS 3.1).
  if (!request || request.requesterId !== userId) throw notFound();
  const canResubmit = request.status === "CHANGES_REQUESTED" || request.status === "EXPIRED";
  const schema = parseSchema(request.workflowVersion.formSchema);
  const fields = canResubmit ? fieldsWithOptions(schema, await resolveFieldOptions(schema)) : [];
  return { request, fields };
}

export type InboxFilter = RequestListFilter | "inbox";

/** The approvals list: the caller's inbox, or (administrators) any request list. */
export async function approvalsInbox(user: { id: string; roles: Role[] }, filter: InboxFilter) {
  const isAdmin = user.roles.some((r) => REQUEST_ADMIN_ROLES.includes(r));
  const effective: InboxFilter = isAdmin ? filter : "inbox";
  const actor = await withDelegations({ id: user.id, roles: user.roles });
  const requests = effective === "inbox" ? await listInbox(actor) : await listAllRequests(effective);
  const covering = [...new Set((actor.delegated ?? []).map((d) => d.delegatorName))];
  return { requests, covering, isAdmin, filter: effective };
}

/** One request for an approver or administrator, with their ability to decide it right now. */
export async function approvalView(user: { id: string; roles: Role[] }, requestId: string) {
  const actor = await withDelegations({ id: user.id, roles: user.roles });
  const request = await getRequest(requestId);
  if (!request) throw notFound();
  const access = requestAccessFor(request, actor) ?? (user.roles.some((r) => REQUEST_ADMIN_ROLES.includes(r)) ? ("admin" as const) : null);
  if (!access) throw notFound();
  const staff = request.requester.staffProfile;
  const currentAllocation = staff
    ? await prisma.allocation.findFirst({ where: { staffId: staff.id, status: { in: ["CONFIRMED", "CHECKED_IN"] } }, include: { bed: { include: { room: { include: { building: true } } } } }, orderBy: { startDate: "desc" } })
    : null;
  const step = currentStep(request);
  return { request, access, currentAllocation, decision: canDecide(request, actor), step, effectiveRole: effectiveStepRole(request) };
}

/** Delegations visible to the caller, with the pick-lists for creating one. */
export async function delegationsView(user: { id: string; organizationId: string; roles: Role[] }, now: Date = new Date()) {
  const isAdmin = user.roles.some((r) => REQUEST_ADMIN_ROLES.includes(r));
  const [rows, delegates, delegators] = await Promise.all([listDelegations({ id: user.id, isAdmin }, now), delegateOptions(user.organizationId, ""), isAdmin ? delegatorOptions(user.organizationId) : Promise.resolve(null)]);
  return { rows, delegates, delegators, isAdmin, myRoles: delegatableRoles(user.roles), today: isoDay(now) };
}

export async function formTypes(organizationId: string) {
  return listTypes(organizationId);
}

/** One request type with all its versions, for the form builder. */
export async function formType(organizationId: string, typeId: string) {
  const type = await getType(typeId);
  if (!type || type.organizationId !== organizationId) throw new RequestError("NOT_FOUND", "Request type not found.");
  return type;
}

