// Pure form-builder rules: roles, naming, schema and route validation and normalisation.
// No database access, so the web app and the API can both import this file.
import type { Prisma, Role } from "@prisma/client";
import { ALL_ROLES } from "../admin/access";
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


export const typeInclude = {
  versions: { include: { steps: { orderBy: { order: "asc" } }, createdBy: { select: { name: true } }, publishedBy: { select: { name: true } }, _count: { select: { requests: true } } }, orderBy: { version: "desc" } },
  _count: { select: { requests: true } },
} satisfies Prisma.RequestTypeInclude;
export type TypeRecord = Prisma.RequestTypeGetPayload<{ include: typeof typeInclude }>;

export function draftOf(type: TypeRecord) {
  return type.versions.find((v) => !v.publishedAt) ?? null;
}
export function currentOf(type: TypeRecord) {
  return type.versions.find((v) => v.isCurrent) ?? null;
}
