// Form and route builder (WF-02, WF-03). Administrators edit a draft version
// of a request type's form and approval route; publishing makes it current.
// Requests pin the version they were submitted under, so published versions
// are never changed.
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { ALL_ROLES } from "@/modules/admin/access";
import { RequestError } from "./errors";
import { FIELD_TYPES, VISIBILITY_OPS, parseSchema, type FormField, type FormSchema } from "./forms";

export const FORM_BUILDER_ROLES: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN"];
/** Roles that can sit on an approval route (residents and vendors never approve). */
export const APPROVER_ROLES: Role[] = ALL_ROLES.filter((r) => r !== "STAFF" && r !== "VENDOR");
export const NAME_PATTERN = /^[a-z][A-Za-z0-9]{0,39}$/;
export const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/;

export type StepInput = { name: string; approverRole: Role; requireComment: boolean };

/** Field name from a label: "Visitor full name" → "visitorFullName". */
export function slugify(label: string): string {
  const words = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return "";
  return (words[0] + words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join("")).slice(0, 40);
}

/** Checks a schema field by field; keys are "fields.<index>.<property>". */
export function validateSchema(schema: FormSchema): Record<string, string> {
  const errors: Record<string, string> = {};
  const seen = new Map<string, number>();
  schema.fields.forEach((f, i) => {
    const k = (p: string) => `fields.${i}.${p}`;
    if (!f.label?.trim()) errors[k("label")] = "Enter a label.";
    if (!NAME_PATTERN.test(f.name ?? "")) errors[k("name")] = "Name must start with a lowercase letter and contain only letters and digits.";
    else if (seen.has(f.name)) errors[k("name")] = `Duplicate of field ${seen.get(f.name)! + 1}.`;
    else seen.set(f.name, i);
    if (!FIELD_TYPES.includes(f.type)) errors[k("type")] = "Unknown field type.";
    if (f.type === "select" && !f.optionsSource && !(f.options ?? []).some((o) => o.trim())) errors[k("options")] = "Add at least one option, or use a data source.";
    if (f.type === "number" && f.min !== undefined && f.max !== undefined && f.min > f.max) errors[k("max")] = "Maximum must be at least the minimum.";
    if (f.maxLength !== undefined && (!Number.isInteger(f.maxLength) || f.maxLength < 1)) errors[k("maxLength")] = "Enter a whole number of characters.";
    const c = f.visibleWhen;
    if (c) {
      const target = schema.fields.findIndex((o) => o.name === c.field);
      if (!c.field) errors[k("visibleWhen")] = "Choose the field this depends on.";
      else if (target === -1 || target >= i) errors[k("visibleWhen")] = "Can only depend on a field that comes earlier in the form.";
      else if (!VISIBILITY_OPS.includes(c.op)) errors[k("visibleWhen")] = "Unknown condition.";
      else {
        const dependsOnCheckbox = schema.fields[target].type === "checkbox";
        if ((c.op === "isTrue" || c.op === "isFalse") && !dependsOnCheckbox) errors[k("visibleWhen")] = "Ticked / not ticked only applies to a checkbox.";
        if ((c.op === "equals" || c.op === "notEquals") && (dependsOnCheckbox || !(c.value ?? "").trim())) errors[k("visibleWhen")] = dependsOnCheckbox ? "Use ticked / not ticked for a checkbox." : "Enter the value to compare with.";
      }
    }
  });
  return errors;
}

export function validateSteps(steps: StepInput[]): Record<string, string> {
  const errors: Record<string, string> = {};
  steps.forEach((s, i) => {
    if (!s.name?.trim()) errors[`steps.${i}.name`] = "Enter a step name.";
    if (!APPROVER_ROLES.includes(s.approverRole)) errors[`steps.${i}.approverRole`] = "Choose an approver role.";
  });
  return errors;
}

/** Normalises a schema from the builder: trims text, drops empty options, removes unused properties. */
export function normaliseSchema(raw: unknown): FormSchema {
  const parsed = parseSchema(raw);
  const fields: FormField[] = parsed.fields.map((f) => {
    const out: FormField = { name: (f.name ?? "").trim(), label: (f.label ?? "").trim(), type: f.type };
    if (f.required) out.required = true;
    if (f.help?.trim()) out.help = f.help.trim();
    if (f.placeholder?.trim()) out.placeholder = f.placeholder.trim();
    if (f.type === "select") {
      if (f.optionsSource === "buildings") out.optionsSource = "buildings";
      else out.options = (f.options ?? []).map((o) => String(o).trim()).filter(Boolean);
    }
    if (f.type === "number") {
      if (f.min !== undefined && f.min !== null && Number.isFinite(Number(f.min))) out.min = Number(f.min);
      if (f.max !== undefined && f.max !== null && Number.isFinite(Number(f.max))) out.max = Number(f.max);
    }
    if ((f.type === "text" || f.type === "textarea") && f.maxLength !== undefined && f.maxLength !== null && Number.isFinite(Number(f.maxLength))) out.maxLength = Number(f.maxLength);
    if (f.visibleWhen && typeof f.visibleWhen === "object" && f.visibleWhen.field) out.visibleWhen = { field: String(f.visibleWhen.field), op: f.visibleWhen.op, ...(f.visibleWhen.value !== undefined && f.visibleWhen.value !== "" ? { value: String(f.visibleWhen.value) } : {}) };
    return out;
  });
  return { fields };
}

export function normaliseSteps(raw: unknown): StepInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => ({ name: String((s as StepInput)?.name ?? "").trim(), approverRole: (s as StepInput)?.approverRole, requireComment: !!(s as StepInput)?.requireComment }));
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

export const typeInclude = {
  versions: { include: { steps: { orderBy: { order: "asc" } }, createdBy: { select: { name: true } }, publishedBy: { select: { name: true } }, _count: { select: { requests: true } } }, orderBy: { version: "desc" } },
  _count: { select: { requests: true } },
} satisfies Prisma.RequestTypeInclude;
export type TypeRecord = Prisma.RequestTypeGetPayload<{ include: typeof typeInclude }>;

export async function listTypes(organizationId: string) {
  return prisma.requestType.findMany({ where: { organizationId }, include: typeInclude, orderBy: { name: "asc" } });
}

export async function getType(id: string) {
  return prisma.requestType.findUnique({ where: { id }, include: typeInclude });
}

export function draftOf(type: TypeRecord) {
  return type.versions.find((v) => !v.publishedAt) ?? null;
}
export function currentOf(type: TypeRecord) {
  return type.versions.find((v) => v.isCurrent) ?? null;
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

export async function updateType(input: { typeId: string; actorId: string; name: string; description?: string | null; status: "ACTIVE" | "INACTIVE" }) {
  if (!input.name.trim()) throw new RequestError("VALIDATION", "Enter a name.", { name: "Required." });
  const before = await prisma.requestType.findUnique({ where: { id: input.typeId } });
  if (!before) throw new RequestError("NOT_FOUND", "Request type not found.");
  const after = await prisma.requestType.update({ where: { id: input.typeId }, data: { name: input.name.trim(), description: input.description?.trim() || null, status: input.status } });
  await recordAudit({ actorId: input.actorId, action: "REQUEST_TYPE_UPDATED", entityType: "RequestType", entityId: input.typeId, before: { name: before.name, description: before.description, status: before.status }, after: { name: after.name, description: after.description, status: after.status } });
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
