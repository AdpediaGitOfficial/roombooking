// Form and route builder (WF-02, WF-03). Administrators edit a draft version
// of a request type's form and approval route; publishing makes it current.
// Requests pin the version they were submitted under, so published versions
// are never changed.
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { RequestError } from "./errors";
import { parseSchema } from "./forms";
import { APPROVER_ROLES, CODE_PATTERN, typeInclude, normaliseSchema, normaliseSteps, validateSchema, validateSteps } from "./builder-rules";

export * from "./builder-rules";

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

export async function listTypes(organizationId: string) {
  return prisma.requestType.findMany({ where: { organizationId }, include: typeInclude, orderBy: { name: "asc" } });
}

export async function getType(id: string) {
  return prisma.requestType.findUnique({ where: { id }, include: typeInclude });
}


export async function createType(input: { organizationId: string; actorId: string; code: string; name: string; description?: string | null }) {
  const code = input.code.trim().toUpperCase().replace(/[\s-]+/g, "_");
  const errors: Record<string, string> = {};
  if (!CODE_PATTERN.test(code)) errors.code = "Code: letters, digits and underscores, starting with a letter (e.g. PARKING_PERMIT).";
  if (!input.name.trim()) errors.name = "Enter a name.";
  if (Object.keys(errors).length) throw new RequestError("VALIDATION", "Please correct the highlighted fields.", errors);
  try {
    return await prisma.$transaction(async (tx) => {
      const type = await tx.requestType.create({ data: { organizationId: input.organizationId, code, name: input.name.trim(), description: input.description?.trim() || null } });
      await tx.workflowVersion.create({ data: { requestTypeId: type.id, version: 1, formSchema: { fields: [] }, createdById: input.actorId } });
      await recordAudit({ actorId: input.actorId, action: "REQUEST_TYPE_CREATED", entityType: "RequestType", entityId: type.id, after: { code, name: type.name } }, tx);
      return type;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new RequestError("VALIDATION", "A request type with that code already exists.", { code: "Already used." });
    throw e;
  }
}

export type PolicyInput = { reminderAfterDays?: number | null; escalateAfterDays?: number | null; escalateToRole?: Role | null; expireAfterDays?: number | null };

export async function updateType(input: { typeId: string; actorId: string; name: string; description?: string | null; status: "ACTIVE" | "INACTIVE"; policy?: PolicyInput }) {
  const errors: Record<string, string> = {};
  if (!input.name.trim()) errors.name = "Enter a name.";
  const p = input.policy ?? {};
  for (const k of ["reminderAfterDays", "escalateAfterDays", "expireAfterDays"] as const) {
    const v = p[k];
    if (v != null && (!Number.isInteger(v) || v < 0 || v > 365)) errors[k] = "Whole number of days, 0 to switch off.";
  }
  if (p.escalateToRole && !APPROVER_ROLES.includes(p.escalateToRole)) errors.escalateToRole = "Choose an approver role.";
  if (Object.keys(errors).length) throw new RequestError("VALIDATION", "Please correct the highlighted fields.", errors);
  const before = await prisma.requestType.findUnique({ where: { id: input.typeId } });
  if (!before) throw new RequestError("NOT_FOUND", "Request type not found.");
  const after = await prisma.requestType.update({ where: { id: input.typeId }, data: { name: input.name.trim(), description: input.description?.trim() || null, status: input.status, ...(p.reminderAfterDays != null ? { reminderAfterDays: p.reminderAfterDays } : {}), ...(p.escalateAfterDays != null ? { escalateAfterDays: p.escalateAfterDays } : {}), ...(p.expireAfterDays != null ? { expireAfterDays: p.expireAfterDays } : {}), ...(input.policy && "escalateToRole" in input.policy ? { escalateToRole: p.escalateToRole ?? null } : {}) } });
  await recordAudit({ actorId: input.actorId, action: "REQUEST_TYPE_UPDATED", entityType: "RequestType", entityId: input.typeId, before: { name: before.name, description: before.description, status: before.status, reminderAfterDays: before.reminderAfterDays, escalateAfterDays: before.escalateAfterDays, escalateToRole: before.escalateToRole, expireAfterDays: before.expireAfterDays }, after: { name: after.name, description: after.description, status: after.status, reminderAfterDays: after.reminderAfterDays, escalateAfterDays: after.escalateAfterDays, escalateToRole: after.escalateToRole, expireAfterDays: after.expireAfterDays } });
  return after;
}

// ---------------------------------------------------------------------------
// Versions: draft, save, publish, discard
// ---------------------------------------------------------------------------

/** Starts a draft from the current version (fields and route copied); one draft at a time. */
export async function createDraft(input: { typeId: string; actorId: string }) {
  return prisma.$transaction(async (tx) => {
    const type = await tx.requestType.findUnique({ where: { id: input.typeId }, include: { versions: { include: { steps: { orderBy: { order: "asc" } } }, orderBy: { version: "desc" } } } });
    if (!type) throw new RequestError("NOT_FOUND", "Request type not found.");
    if (type.versions.some((v) => !v.publishedAt)) throw new RequestError("INVALID_STATE", "There is already a draft; edit or discard it first.");
    const base = type.versions.find((v) => v.isCurrent) ?? type.versions[0];
    const draft = await tx.workflowVersion.create({ data: { requestTypeId: type.id, version: (type.versions[0]?.version ?? 0) + 1, formSchema: (base?.formSchema ?? { fields: [] }) as Prisma.InputJsonValue, createdById: input.actorId, steps: { create: (base?.steps ?? []).map((s) => ({ order: s.order, name: s.name, approverRole: s.approverRole, requireComment: s.requireComment })) } } });
    await recordAudit({ actorId: input.actorId, action: "WORKFLOW_DRAFT_CREATED", entityType: "WorkflowVersion", entityId: draft.id, after: { requestTypeId: type.id, version: draft.version, basedOn: base?.version ?? null } }, tx);
    return draft;
  });
}

export async function saveDraft(input: { versionId: string; actorId: string; schema: unknown; steps: unknown; changeNote?: string | null }) {
  const schema = normaliseSchema(input.schema);
  const steps = normaliseSteps(input.steps);
  const errors = { ...validateSchema(schema), ...validateSteps(steps) };
  if (Object.keys(errors).length) throw new RequestError("VALIDATION", "Please correct the highlighted fields.", errors);
  return prisma.$transaction(async (tx) => {
    const v = await tx.workflowVersion.findUnique({ where: { id: input.versionId } });
    if (!v) throw new RequestError("NOT_FOUND", "Version not found.");
    if (v.publishedAt) throw new RequestError("INVALID_STATE", "Published versions cannot be changed; start a new draft.");
    await tx.approvalStep.deleteMany({ where: { workflowVersionId: v.id } });
    const updated = await tx.workflowVersion.update({ where: { id: v.id }, data: { formSchema: schema as unknown as Prisma.InputJsonObject, changeNote: input.changeNote?.trim() || null, steps: { create: steps.map((s, i) => ({ order: i + 1, name: s.name.trim(), approverRole: s.approverRole, requireComment: s.requireComment })) } } });
    await recordAudit({ actorId: input.actorId, action: "WORKFLOW_DRAFT_SAVED", entityType: "WorkflowVersion", entityId: v.id, after: { fields: schema.fields.length, steps: steps.length, changeNote: input.changeNote ?? null } }, tx);
    return updated;
  });
}

/** Makes the draft current. In-flight requests keep the version they were submitted under. */
export async function publishVersion(input: { versionId: string; actorId: string; now?: Date }) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const v = await tx.workflowVersion.findUnique({ where: { id: input.versionId }, include: { steps: true } });
    if (!v) throw new RequestError("NOT_FOUND", "Version not found.");
    if (v.publishedAt) throw new RequestError("INVALID_STATE", "This version is already published.");
    const schema = parseSchema(v.formSchema);
    const errors = { ...validateSchema(schema), ...validateSteps(v.steps) };
    if (schema.fields.length === 0) errors["fields"] = "Add at least one field before publishing.";
    if (Object.keys(errors).length) throw new RequestError("VALIDATION", "The draft has problems; fix them before publishing.", errors);
    await tx.workflowVersion.updateMany({ where: { requestTypeId: v.requestTypeId, isCurrent: true }, data: { isCurrent: false } });
    const published = await tx.workflowVersion.update({ where: { id: v.id }, data: { isCurrent: true, publishedAt: now, publishedById: input.actorId } });
    await recordAudit({ actorId: input.actorId, action: "WORKFLOW_PUBLISHED", entityType: "WorkflowVersion", entityId: v.id, after: { requestTypeId: v.requestTypeId, version: v.version, fields: schema.fields.length, steps: v.steps.length, changeNote: v.changeNote } }, tx);
    return published;
  });
}

export async function discardDraft(input: { versionId: string; actorId: string }) {
  return prisma.$transaction(async (tx) => {
    const v = await tx.workflowVersion.findUnique({ where: { id: input.versionId }, include: { _count: { select: { requests: true } } } });
    if (!v) throw new RequestError("NOT_FOUND", "Version not found.");
    if (v.publishedAt || v._count.requests > 0) throw new RequestError("INVALID_STATE", "Only unpublished drafts can be discarded.");
    await tx.approvalStep.deleteMany({ where: { workflowVersionId: v.id } });
    await tx.workflowVersion.delete({ where: { id: v.id } });
    await recordAudit({ actorId: input.actorId, action: "WORKFLOW_DRAFT_DISCARDED", entityType: "WorkflowVersion", entityId: v.id, after: { requestTypeId: v.requestTypeId, version: v.version } }, tx);
  });
}
