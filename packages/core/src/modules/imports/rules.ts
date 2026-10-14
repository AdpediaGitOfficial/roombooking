// Pure import definitions: who may import, the file layouts and the result shapes.
// No database access, so the web app and the API can both import this file.
import type { Role } from "@prisma/client";

export const IMPORT_ROLES: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN"];
export type ImportKind = "staff" | "accommodation";
export const KINDS: Array<{ kind: ImportKind; label: string; columns: string[]; blurb: string }> = [
  { kind: "staff", label: "Staff profiles", columns: ["employeeId", "firstName", "lastName", "gender", "department", "company", "phone", "employmentStatus"], blurb: "One row per employee. Existing employee IDs are updated; new ones are created. Gender: MALE, FEMALE or blank. Employment status: ACTIVE, ON_LEAVE or TERMINATED." },
  { kind: "accommodation", label: "Buildings, rooms and beds", columns: ["site", "building", "buildingName", "buildingType", "room", "roomType", "floor", "genderPolicy", "beds"], blurb: "One row per room. Site is an existing site code. Buildings are created when new (name required then) or matched by code. Beds: a count (e.g. 2) or bed codes separated by | (e.g. A-01-1|A-01-2). Existing rooms keep their beds and gain any new codes." },
];
export const MAX_ROWS = 5000;

export type RowAction = "create" | "update" | "unchanged" | "error";
export type RowResult = { line: number; values: Record<string, string>; action: RowAction; errors: string[]; note: string | null };
export type Summary = { total: number; create: number; update: number; unchanged: number; error: number };

export class ImportError extends Error {
  constructor(public readonly code: "VALIDATION" | "NOT_FOUND" | "INVALID_STATE" | "HAS_ERRORS", message: string) { super(message); this.name = "ImportError"; }
}
