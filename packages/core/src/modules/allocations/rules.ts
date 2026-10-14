// Pure allocation helpers, safe to import from anywhere (no database access).
export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export type AllocationListFilter = "active" | "upcoming" | "history" | "all";
export type ClearanceBlocker = { type: "KEY" | "ASSET"; label: string };
