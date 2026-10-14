import { z } from "zod";
import type { Role } from "@prisma/client";
import { ALL_ROLES } from "@sam/core/modules/admin/access";
import { APPROVALS_AREA_ROLES } from "@sam/core/modules/requests/access";
import { FORM_BUILDER_ROLES } from "@sam/core/modules/requests/builder-rules";
import type * as svc from "@sam/core/modules/requests/service";
import type * as views from "@sam/core/modules/requests/views";
import type * as builder from "@sam/core/modules/requests/builder";
import type * as delegations from "@sam/core/modules/requests/delegations";
import { cuid, op, out, type Ret } from "../define";

const role = z.enum(ALL_ROLES as [Role, ...Role[]]);
const text = (max: number) => z.string().max(max).optional();
/** Raw form-field values as typed by the person (validated against the form's schema on the server). */
const fields = z.record(z.string(), z.string());
const days = z.number().int().nullable().optional();

export const requests = {
  types: op({
    id: "requests.types",
    method: "GET",
    path: "/v1/requests/types",
    summary: "Request types the signed-in user can start",
    tag: "Requests",
    input: z.object({}),
    output: out<Ret<typeof views.startableTypes>>(),
  }),
  form: op({
    id: "requests.form",
    method: "GET",
    path: "/v1/requests/types/:typeCode/form",
    summary: "The current form and approval route for a request type",
    tag: "Requests",
    input: z.object({ typeCode: z.string().min(1).max(60) }),
    output: out<Ret<typeof views.newRequestForm>>(),
  }),
  mine: op({
    id: "requests.mine",
    method: "GET",
    path: "/v1/requests/mine",
    summary: "The signed-in user's own requests",
    tag: "Requests",
    input: z.object({}),
    output: out<Ret<typeof views.myRequests>>(),
  }),
  getMine: op({
    id: "requests.getMine",
    method: "GET",
    path: "/v1/requests/mine/:id",
    summary: "One of the user's own requests, with its form when it can be corrected and resent",
    tag: "Requests",
    input: z.object({ id: cuid() }),
    output: out<Ret<typeof views.myRequestView>>(),
  }),
  submit: op({
    id: "requests.submit",
    method: "POST",
    path: "/v1/requests",
    summary: "Submit a request (idempotent on the key)",
    tag: "Requests",
    input: z.object({ typeCode: z.string().max(60), idempotencyKey: z.string().max(100), fields }),
    output: out<Ret<typeof svc.submitRequest>>(),
  }),
  resubmit: op({
    id: "requests.resubmit",
    method: "POST",
    path: "/v1/requests/:id/resubmit",
    summary: "Correct and resend a request that was returned or expired",
    tag: "Requests",
    input: z.object({ id: cuid(), fields }),
    output: out<Ret<typeof svc.resubmitRequest>>(),
  }),
  withdraw: op({
    id: "requests.withdraw",
    method: "POST",
    path: "/v1/requests/:id/withdraw",
    summary: "Withdraw one's own request",
    tag: "Requests",
    input: z.object({ id: cuid(), reason: text(500) }),
    output: out<Ret<typeof svc.withdrawRequest>>(),
  }),
};

export const approvals = {
  inbox: op({
    id: "approvals.inbox",
    method: "GET",
    path: "/v1/approvals",
    summary: "Requests waiting on the caller (or, for administrators, any request list)",
    tag: "Approvals",
    access: APPROVALS_AREA_ROLES,
    input: z.object({ filter: z.enum(["inbox", "pending", "approved", "closed", "all"]).default("inbox") }),
    output: out<Ret<typeof views.approvalsInbox>>(),
  }),
  get: op({
    id: "approvals.get",
    method: "GET",
    path: "/v1/approvals/:id",
    summary: "One request for an approver, with whether and how they can decide it",
    tag: "Approvals",
    access: APPROVALS_AREA_ROLES,
    input: z.object({ id: cuid() }),
    output: out<Ret<typeof views.approvalView>>(),
  }),
  decide: op({
    id: "approvals.decide",
    method: "POST",
    path: "/v1/approvals/:id/decision",
    summary: "Approve, reject or return a request at its current step",
    tag: "Approvals",
    access: APPROVALS_AREA_ROLES,
    input: z.object({ id: cuid(), action: z.enum(["APPROVE", "REJECT", "REQUEST_CHANGES"]), comment: text(2000) }),
    output: out<Ret<typeof svc.decideRequest>>(),
  }),
  reassign: op({
    id: "approvals.reassign",
    method: "POST",
    path: "/v1/approvals/:id/reassign",
    summary: "Administrators move the current step to another role",
    tag: "Approvals",
    access: APPROVALS_AREA_ROLES,
    input: z.object({ id: cuid(), role, reason: z.string().max(500) }),
    output: out<Ret<typeof svc.reassignStep>>(),
  }),
};

export const delegations_ = {
  view: op({
    id: "delegations.view",
    method: "GET",
    path: "/v1/delegations",
    summary: "Approval delegations visible to the caller, with pick-lists for creating cover",
    tag: "Delegations",
    access: APPROVALS_AREA_ROLES,
    input: z.object({}),
    output: out<Ret<typeof views.delegationsView>>(),
  }),
  create: op({
    id: "delegations.create",
    method: "POST",
    path: "/v1/delegations",
    summary: "Arrange absence cover for a date range",
    tag: "Delegations",
    access: APPROVALS_AREA_ROLES,
    input: z.object({ delegatorId: cuid().optional(), delegateId: z.string().max(64), roles: z.array(role).default([]), startsAt: z.string().max(10), endsAt: z.string().max(10), reason: text(500) }),
    output: out<Ret<typeof delegations.createDelegation>>(),
  }),
  revoke: op({
    id: "delegations.revoke",
    method: "POST",
    path: "/v1/delegations/:id/revoke",
    summary: "End a delegation",
    tag: "Delegations",
    access: APPROVALS_AREA_ROLES,
    input: z.object({ id: cuid(), reason: text(500) }),
    output: out<Ret<typeof delegations.revokeDelegation>>(),
  }),
};

export const forms = {
  list: op({
    id: "forms.list",
    method: "GET",
    path: "/v1/admin/forms",
    summary: "Request types with their versions",
    tag: "Form builder",
    access: FORM_BUILDER_ROLES,
    input: z.object({}),
    output: out<Ret<typeof views.formTypes>>(),
  }),
  get: op({
    id: "forms.get",
    method: "GET",
    path: "/v1/admin/forms/:id",
    summary: "One request type with all its versions and steps",
    tag: "Form builder",
    access: FORM_BUILDER_ROLES,
    input: z.object({ id: cuid() }),
    output: out<Ret<typeof views.formType>>(),
  }),
  createType: op({
    id: "forms.createType",
    method: "POST",
    path: "/v1/admin/forms",
    summary: "Create a request type",
    tag: "Form builder",
    access: FORM_BUILDER_ROLES,
    input: z.object({ code: z.string().max(60), name: z.string().max(200), description: text(1000) }),
    output: out<Ret<typeof builder.createType>>(),
  }),
  updateType: op({
    id: "forms.updateType",
    method: "PUT",
    path: "/v1/admin/forms/:id",
    summary: "Edit a request type's name, status and pending-step policy",
    tag: "Form builder",
    access: FORM_BUILDER_ROLES,
    input: z.object({ id: cuid(), name: z.string().max(200), description: text(1000), status: z.enum(["ACTIVE", "INACTIVE"]), reminderAfterDays: days, escalateAfterDays: days, expireAfterDays: days, escalateToRole: role.nullable().optional() }),
    output: out<Ret<typeof builder.updateType>>(),
  }),
  createDraft: op({
    id: "forms.createDraft",
    method: "POST",
    path: "/v1/admin/forms/:id/drafts",
    summary: "Start a new draft version from the current one",
    tag: "Form builder",
    access: FORM_BUILDER_ROLES,
    input: z.object({ id: cuid() }),
    output: out<Ret<typeof builder.createDraft>>(),
  }),
  saveDraft: op({
    id: "forms.saveDraft",
    method: "PUT",
    path: "/v1/admin/forms/versions/:id",
    summary: "Save a draft's fields and approval route, optionally publishing it",
    tag: "Form builder",
    access: FORM_BUILDER_ROLES,
    input: z.object({ id: cuid(), schema: z.unknown(), steps: z.unknown(), changeNote: text(500), publish: z.boolean().default(false) }),
    output: out<{ published: boolean }>(),
  }),
  discardDraft: op({
    id: "forms.discardDraft",
    method: "POST",
    path: "/v1/admin/forms/versions/:id/discard",
    summary: "Delete a draft version",
    tag: "Form builder",
    access: FORM_BUILDER_ROLES,
    input: z.object({ id: cuid() }),
    output: out<Ret<typeof builder.discardDraft>>(),
  }),
};

