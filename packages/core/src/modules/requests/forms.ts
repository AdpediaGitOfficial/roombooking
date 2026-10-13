// Form schema stored on WorkflowVersion.formSchema (WF-01) and its
// server-side validation. Pure functions; no database access.

export type FieldType = "text" | "textarea" | "date" | "number" | "select" | "checkbox";

export const FIELD_TYPES: FieldType[] = ["text", "textarea", "date", "number", "select", "checkbox"];
export type VisibilityOp = "equals" | "notEquals" | "isSet" | "isNotSet" | "isTrue" | "isFalse";
export const VISIBILITY_OPS: VisibilityOp[] = ["equals", "notEquals", "isSet", "isNotSet", "isTrue", "isFalse"];
/** Conditional visibility (WF-02): the field shows only when another, earlier field satisfies the condition. */
export type Visibility = { field: string; op: VisibilityOp; value?: string };

export type FormField = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  placeholder?: string;
  options?: string[];
  /** Options resolved at render/validation time from application data. */
  optionsSource?: "buildings" | "sites";
  min?: number;
  max?: number;
  maxLength?: number;
  visibleWhen?: Visibility;
};

type RawValues = Record<string, string | number | boolean | null | undefined>;
const asString = (v: string | number | boolean | null | undefined): string => (v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "on" : "") : String(v));

/** Evaluates a field's visibility condition against the current values (strings as submitted, or typed data). */
export function isFieldVisible(field: Pick<FormField, "visibleWhen">, values: RawValues): boolean {
  const c = field.visibleWhen;
  if (!c) return true;
  const v = asString(values[c.field]).trim();
  switch (c.op) {
    case "equals": return v === (c.value ?? "");
    case "notEquals": return v !== (c.value ?? "");
    case "isSet": return v !== "";
    case "isNotSet": return v === "";
    case "isTrue": return v === "on" || v === "true";
    case "isFalse": return !(v === "on" || v === "true");
    default: return true;
  }
}

/** Fields shown for the given values, in order (a hidden field never reveals the ones that depend on it). */
export function visibleFields(fields: FormField[], values: RawValues): FormField[] {
  const shown = new Set<string>();
  const out: FormField[] = [];
  for (const f of fields) {
    const visible = !f.visibleWhen || (shown.has(f.visibleWhen.field) && isFieldVisible(f, values));
    if (visible) { shown.add(f.name); out.push(f); }
  }
  return out;
}

export type FormSchema = { fields: FormField[] };

export type FormValue = string | number | boolean | null;
export type FormData = Record<string, FormValue>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseSchema(raw: unknown): FormSchema {
  const obj = (raw ?? {}) as { fields?: unknown };
  const fields = Array.isArray(obj.fields) ? (obj.fields as FormField[]) : [];
  return { fields: fields.filter((f) => f && typeof f.name === "string" && typeof f.label === "string") };
}

/**
 * Validates raw string inputs (as submitted by a form) against the schema.
 * `resolvedOptions` supplies options for fields with an optionsSource.
 */
export function validateSubmission(
  schema: FormSchema,
  raw: Record<string, string | undefined>,
  resolvedOptions: Record<string, string[]> = {},
): { data: FormData; errors: Record<string, string> } {
  const data: FormData = {};
  const errors: Record<string, string> = {};

  const shown = new Set(visibleFields(schema.fields, raw).map((f) => f.name));
  for (const field of schema.fields) {
    // Hidden fields are neither required nor stored (WF-02 conditional visibility).
    if (!shown.has(field.name)) { data[field.name] = null; continue; }
    const value = (raw[field.name] ?? "").trim();
    const options = field.optionsSource ? (resolvedOptions[field.name] ?? []) : (field.options ?? []);

    if (field.type === "checkbox") {
      data[field.name] = value === "on" || value === "true";
      if (field.required && !data[field.name]) errors[field.name] = `${field.label} must be confirmed.`;
      continue;
    }
    if (!value) {
      data[field.name] = null;
      if (field.required) errors[field.name] = `${field.label} is required.`;
      continue;
    }
    switch (field.type) {
      case "date":
        if (!DATE.test(value) || Number.isNaN(Date.parse(value))) errors[field.name] = `${field.label} must be a valid date.`;
        else data[field.name] = value;
        break;
      case "number": {
        const n = Number(value);
        if (!Number.isFinite(n)) errors[field.name] = `${field.label} must be a number.`;
        else if (field.min !== undefined && n < field.min) errors[field.name] = `${field.label} must be at least ${field.min}.`;
        else if (field.max !== undefined && n > field.max) errors[field.name] = `${field.label} must be at most ${field.max}.`;
        else data[field.name] = n;
        break;
      }
      case "select":
        if (!options.includes(value)) errors[field.name] = `Choose a valid option for ${field.label}.`;
        else data[field.name] = value;
        break;
      default: {
        const max = field.maxLength ?? (field.type === "textarea" ? 2000 : 200);
        if (value.length > max) errors[field.name] = `${field.label} must be ${max} characters or fewer.`;
        else data[field.name] = value;
      }
    }
  }
  return { data, errors };
}

/** Per-request-type rules that span fields (WF-01 validation). */
export const TYPE_RULES: Record<string, (data: FormData, today: string) => Record<string, string>> = {
  VISITOR_STAY: (d) => {
    const e: Record<string, string> = {};
    if (typeof d.arrivalDate === "string" && typeof d.departureDate === "string" && d.departureDate < d.arrivalDate) {
      e.departureDate = "Departure must be on or after arrival.";
    }
    return e;
  },
  ROOM_CHANGE: (d, today) => {
    const e: Record<string, string> = {};
    if (typeof d.effectiveDate === "string" && d.effectiveDate < today) e.effectiveDate = "The effective date cannot be in the past.";
    return e;
  },
  EXIT_CLEARANCE: (d, today) => {
    const e: Record<string, string> = {};
    if (typeof d.lastWorkingDay === "string" && d.lastWorkingDay < today) e.lastWorkingDay = "The last working day cannot be in the past.";
    return e;
  },
};

/** Values as strings for re-rendering a form (defaultValue). */
export function toFormStrings(data: FormData | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data) return out;
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "boolean" ? (v ? "on" : "") : String(v);
  }
  return out;
}
