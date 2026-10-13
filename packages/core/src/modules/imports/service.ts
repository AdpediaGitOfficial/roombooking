// Bulk import and export (ACM-10). A file is parsed and validated into a
// preview batch with a result per row (create, update, error, duplicate);
// the batch is then committed in one transaction (nothing is written if any
// row fails) or discarded. Exports produce files in the same layout, so a
// download can be edited and re-imported.
import type { EmploymentStatus, GenderPolicy, Prisma, Role } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { parseCsv, toCsv, toRecords } from "./csv";

/** Staff import and structure import: Super Admin by default, Accommodation Admin with the HR set / building creation grants. */
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

const GENDERS: GenderPolicy[] = ["ANY", "MALE", "FEMALE"];
const EMPLOYMENT: EmploymentStatus[] = ["ACTIVE", "ON_LEAVE", "TERMINATED"];
const BUILDING_TYPES = ["BUILDING", "VILLA", "APARTMENT"] as const;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,39}$/;
const up = (v: string) => v.trim().toUpperCase().replace(/\s+/g, "_");

function summarise(rows: RowResult[]): Summary {
  return { total: rows.length, create: rows.filter((r) => r.action === "create").length, update: rows.filter((r) => r.action === "update").length, unchanged: rows.filter((r) => r.action === "unchanged").length, error: rows.filter((r) => r.action === "error").length };
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export async function validateStaff(records: Array<{ line: number; values: Record<string, string> }>, organizationId: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<RowResult[]> {
  const ids = records.map((r) => r.values.employeeid).filter(Boolean);
  const existing = new Map((await db.staffProfile.findMany({ where: { organizationId, employeeId: { in: ids } } })).map((s) => [s.employeeId, s]));
  const seen = new Map<string, number>();
  return records.map((r) => {
    const v = r.values;
    const errors: string[] = [];
    const employeeId = v.employeeid ?? "";
    if (!employeeId) errors.push("employeeId is required.");
    else if (!CODE.test(employeeId)) errors.push("employeeId may only contain letters, digits, dots, dashes and slashes.");
    if (!v.firstname) errors.push("firstName is required.");
    if (!v.lastname) errors.push("lastName is required.");
    const gender = v.gender ? up(v.gender) : "ANY";
    if (!GENDERS.includes(gender as GenderPolicy)) errors.push(`gender must be MALE, FEMALE or blank (got "${v.gender}").`);
    const status = v.employmentstatus ? up(v.employmentstatus) : "ACTIVE";
    if (!EMPLOYMENT.includes(status as EmploymentStatus)) errors.push(`employmentStatus must be ACTIVE, ON_LEAVE or TERMINATED (got "${v.employmentstatus}").`);
    if (employeeId && seen.has(employeeId)) errors.push(`Duplicate of line ${seen.get(employeeId)} (same employeeId).`);
    else if (employeeId) seen.set(employeeId, r.line);
    if (errors.length) return { line: r.line, values: v, action: "error", errors, note: null };
    const cur = existing.get(employeeId);
    if (!cur) return { line: r.line, values: v, action: "create", errors: [], note: null };
    const changed = cur.firstName !== v.firstname || cur.lastName !== v.lastname || cur.gender !== gender || (cur.department ?? "") !== (v.department ?? "") || (cur.company ?? "") !== (v.company ?? "") || (cur.phone ?? "") !== (v.phone ?? "") || cur.employmentStatus !== status;
    return { line: r.line, values: v, action: changed ? "update" : "unchanged", errors: [], note: changed ? `Updates ${cur.firstName} ${cur.lastName}` : "Already up to date" };
  });
}

async function commitStaff(tx: Prisma.TransactionClient, organizationId: string, rows: RowResult[]) {
  for (const r of rows) {
    if (r.action === "error" || r.action === "unchanged") continue;
    const v = r.values;
    const data = { firstName: v.firstname, lastName: v.lastname, gender: (v.gender ? up(v.gender) : "ANY") as GenderPolicy, department: v.department || null, company: v.company || null, phone: v.phone || null, employmentStatus: (v.employmentstatus ? up(v.employmentstatus) : "ACTIVE") as EmploymentStatus };
    await tx.staffProfile.upsert({ where: { organizationId_employeeId: { organizationId, employeeId: v.employeeid } }, update: data, create: { organizationId, employeeId: v.employeeid, ...data } });
  }
}

// ---------------------------------------------------------------------------
// Accommodation (buildings, rooms, beds)
// ---------------------------------------------------------------------------

function bedCodes(roomCode: string, raw: string): { codes: string[]; error?: string } {
  const t = raw.trim();
  if (!t) return { codes: [], error: "beds is required: a count or codes separated by |." };
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (n < 1 || n > 50) return { codes: [], error: "beds count must be between 1 and 50." };
    return { codes: Array.from({ length: n }, (_, i) => `${roomCode}-${i + 1}`) };
  }
  const codes = t.split("|").map((c) => c.trim()).filter(Boolean);
  const bad = codes.find((c) => !CODE.test(c));
  if (bad) return { codes: [], error: `bed code "${bad}" is not valid.` };
  if (new Set(codes).size !== codes.length) return { codes: [], error: "bed codes repeat within the row." };
  return { codes };
}

export async function validateAccommodation(records: Array<{ line: number; values: Record<string, string> }>, organizationId: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<RowResult[]> {
  const sites = await db.site.findMany({ where: { organizationId }, include: { buildings: { include: { rooms: { include: { beds: true } } } } } });
  const siteByCode = new Map(sites.map((s) => [s.code.toUpperCase(), s]));
  const seenRooms = new Map<string, number>();
  const newBuildings = new Map<string, number>();
  return records.map((r) => {
    const v = r.values;
    const errors: string[] = [];
    const siteCode = up(v.site ?? "");
    const site = siteByCode.get(siteCode);
    if (!v.site) errors.push("site is required.");
    else if (!site) errors.push(`site "${v.site}" does not exist; create it first.`);
    const buildingCode = (v.building ?? "").trim();
    if (!buildingCode) errors.push("building is required.");
    else if (!CODE.test(buildingCode)) errors.push("building code is not valid.");
    const roomCode = (v.room ?? "").trim();
    if (!roomCode) errors.push("room is required.");
    else if (!CODE.test(roomCode)) errors.push("room code is not valid.");
    const buildingType = v.buildingtype ? up(v.buildingtype) : "BUILDING";
    if (!(BUILDING_TYPES as readonly string[]).includes(buildingType)) errors.push(`buildingType must be BUILDING, VILLA or APARTMENT (got "${v.buildingtype}").`);
    const genderPolicy = v.genderpolicy ? up(v.genderpolicy) : "ANY";
    if (!GENDERS.includes(genderPolicy as GenderPolicy)) errors.push(`genderPolicy must be ANY, MALE, FEMALE or blank (got "${v.genderpolicy}").`);
    const building = site?.buildings.find((b) => b.code.toLowerCase() === buildingCode.toLowerCase()) ?? null;
    const buildingKey = `${siteCode}/${buildingCode.toLowerCase()}`;
    if (site && buildingCode && !building) {
      if (!v.buildingname && !newBuildings.has(buildingKey)) errors.push(`building "${buildingCode}" is new, so buildingName is required on its first row.`);
      if (!newBuildings.has(buildingKey)) newBuildings.set(buildingKey, r.line);
    }
    const beds = bedCodes(roomCode, v.beds ?? "");
    if (beds.error) errors.push(beds.error);
    const roomKey = `${buildingKey}/${roomCode.toLowerCase()}`;
    if (roomCode && seenRooms.has(roomKey)) errors.push(`Duplicate of line ${seenRooms.get(roomKey)} (same room).`);
    else if (roomCode) seenRooms.set(roomKey, r.line);
    if (errors.length) return { line: r.line, values: v, action: "error", errors, note: null };
    const room = building?.rooms.find((x) => x.code.toLowerCase() === roomCode.toLowerCase()) ?? null;
    const firstRowOfNewBuilding = !building && newBuildings.get(buildingKey) === r.line;
    if (!room) return { line: r.line, values: v, action: "create", errors: [], note: `${firstRowOfNewBuilding ? "Building and room" : "Room"} with ${beds.codes.length} bed${beds.codes.length === 1 ? "" : "s"}` };
    const have = new Set(room.beds.map((b) => b.code.toLowerCase()));
    const newBeds = beds.codes.filter((c) => !have.has(c.toLowerCase()));
    const changed = (room.type ?? "") !== (v.roomtype ?? "") || (room.floor ?? "") !== (v.floor ?? "") || room.genderPolicy !== genderPolicy || newBeds.length > 0;
    return { line: r.line, values: v, action: changed ? "update" : "unchanged", errors: [], note: changed ? `Updates room${newBeds.length ? `; adds ${newBeds.length} bed${newBeds.length === 1 ? "" : "s"}` : ""}` : "Already up to date" };
  });
}

async function commitAccommodation(tx: Prisma.TransactionClient, organizationId: string, rows: RowResult[]) {
  const sites = await tx.site.findMany({ where: { organizationId } });
  const siteByCode = new Map(sites.map((s) => [s.code.toUpperCase(), s.id]));
  for (const r of rows) {
    if (r.action === "error" || r.action === "unchanged") continue;
    const v = r.values;
    const siteId = siteByCode.get(up(v.site))!;
    const buildingCode = v.building.trim();
    let building = await tx.building.findFirst({ where: { siteId, code: { equals: buildingCode, mode: "insensitive" } } });
    if (!building) building = await tx.building.create({ data: { siteId, code: buildingCode, name: v.buildingname || buildingCode, type: (v.buildingtype ? up(v.buildingtype) : "BUILDING") as "BUILDING" | "VILLA" | "APARTMENT" } });
    const roomCode = v.room.trim();
    const data = { type: v.roomtype || null, floor: v.floor || null, genderPolicy: (v.genderpolicy ? up(v.genderpolicy) : "ANY") as GenderPolicy };
    let room = await tx.room.findFirst({ where: { buildingId: building.id, code: { equals: roomCode, mode: "insensitive" } }, include: { beds: true } });
    if (!room) room = await tx.room.create({ data: { buildingId: building.id, code: roomCode, ...data }, include: { beds: true } });
    else await tx.room.update({ where: { id: room.id }, data });
    const have = new Set(room.beds.map((b) => b.code.toLowerCase()));
    for (const code of bedCodes(roomCode, v.beds).codes) if (!have.has(code.toLowerCase())) await tx.bed.create({ data: { roomId: room.id, code } });
  }
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

export async function previewImport(input: { kind: ImportKind; fileName: string; text: string; organizationId: string; actorId: string }) {
  const spec = KINDS.find((k) => k.kind === input.kind);
  if (!spec) throw new ImportError("VALIDATION", "Unknown import kind.");
  const parsed = parseCsv(input.text);
  if (parsed.headers.length === 0 || parsed.rows.length === 0) throw new ImportError("VALIDATION", "The file has no data rows.");
  if (parsed.rows.length > MAX_ROWS) throw new ImportError("VALIDATION", `At most ${MAX_ROWS} rows per file.`);
  const have = new Set(parsed.headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, "")));
  const missing = spec.columns.filter((c) => c !== "department" && c !== "company" && c !== "phone" && c !== "gender" && c !== "employmentStatus" && c !== "buildingName" && c !== "buildingType" && c !== "roomType" && c !== "floor" && c !== "genderPolicy").filter((c) => !have.has(c.toLowerCase()));
  if (missing.length) throw new ImportError("VALIDATION", `Missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Download the template to see the expected layout.`);
  const records = toRecords(parsed);
  const rows = input.kind === "staff" ? await validateStaff(records, input.organizationId) : await validateAccommodation(records, input.organizationId);
  const summary = summarise(rows);
  const batch = await prisma.importBatch.create({ data: { organizationId: input.organizationId, kind: input.kind, fileName: input.fileName.slice(0, 200) || `${input.kind}.csv`, rows: rows as unknown as Prisma.InputJsonArray, summary, createdById: input.actorId } });
  await recordAudit({ actorId: input.actorId, action: "IMPORT_PREVIEWED", entityType: "ImportBatch", entityId: batch.id, after: { kind: input.kind, fileName: batch.fileName, ...summary } });
  return batch;
}

/**
 * Applies a previewed batch. Rows are validated again against the current
 * data, then written in a single transaction; any failure rolls everything
 * back. Rows with errors stop the import unless `skipErrors` is set, in
 * which case they are left out and reported.
 */
export async function commitImport(input: { batchId: string; actorId: string; skipErrors?: boolean }) {
  const batch = await prisma.importBatch.findUnique({ where: { id: input.batchId } });
  if (!batch) throw new ImportError("NOT_FOUND", "Import not found.");
  if (batch.status !== "PREVIEW") throw new ImportError("INVALID_STATE", batch.status === "IMPORTED" ? "This file has already been imported." : "This import was discarded.");
  const records = (batch.rows as unknown as RowResult[]).map((r) => ({ line: r.line, values: r.values }));
  return prisma.$transaction(async (tx) => {
    const rows = batch.kind === "staff" ? await validateStaff(records, batch.organizationId, tx) : await validateAccommodation(records, batch.organizationId, tx);
    const summary = summarise(rows);
    if (summary.error > 0 && !input.skipErrors) throw new ImportError("HAS_ERRORS", `${summary.error} row${summary.error === 1 ? " has" : "s have"} errors. Fix the file and upload it again, or choose to skip those rows.`);
    if (summary.create + summary.update === 0) throw new ImportError("VALIDATION", "Nothing to import: every row is unchanged or has errors.");
    if (batch.kind === "staff") await commitStaff(tx, batch.organizationId, rows); else await commitAccommodation(tx, batch.organizationId, rows);
    const result = { ...summary, skipped: input.skipErrors ? summary.error : 0 };
    const done = await tx.importBatch.update({ where: { id: batch.id }, data: { status: "IMPORTED", importedAt: new Date(), rows: rows as unknown as Prisma.InputJsonArray, summary, result } });
    await recordAudit({ actorId: input.actorId, action: "IMPORT_COMMITTED", entityType: "ImportBatch", entityId: batch.id, after: { kind: batch.kind, fileName: batch.fileName, ...result } }, tx);
    return done;
  }, { timeout: 60000 });
}

export async function discardBatch(input: { batchId: string; actorId: string }) {
  const r = await prisma.importBatch.updateMany({ where: { id: input.batchId, status: "PREVIEW" }, data: { status: "DISCARDED" } });
  if (r.count !== 1) throw new ImportError("INVALID_STATE", "Only previews can be discarded.");
  await recordAudit({ actorId: input.actorId, action: "IMPORT_DISCARDED", entityType: "ImportBatch", entityId: input.batchId });
}

export async function listBatches(organizationId: string) {
  return prisma.importBatch.findMany({ where: { organizationId }, include: { createdBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
}

export async function getBatch(id: string) {
  return prisma.importBatch.findUnique({ where: { id }, include: { createdBy: { select: { name: true } } } });
}

// ---------------------------------------------------------------------------
// Exports in the import layout (templates that round-trip)
// ---------------------------------------------------------------------------

export async function exportStaffCsv(organizationId: string): Promise<string> {
  const staff = await prisma.staffProfile.findMany({ where: { organizationId }, orderBy: { employeeId: "asc" } });
  const headers = KINDS[0].columns;
  return toCsv(headers, staff.map((s) => [s.employeeId, s.firstName, s.lastName, s.gender === "ANY" ? "" : s.gender, s.department ?? "", s.company ?? "", s.phone ?? "", s.employmentStatus]));
}

export async function exportAccommodationCsv(organizationId: string): Promise<string> {
  const sites = await prisma.site.findMany({ where: { organizationId }, include: { buildings: { orderBy: { code: "asc" }, include: { rooms: { orderBy: { code: "asc" }, include: { beds: { orderBy: { code: "asc" } } } } } } }, orderBy: { code: "asc" } });
  const rows: unknown[][] = [];
  for (const s of sites) for (const b of s.buildings) for (const r of b.rooms) rows.push([s.code, b.code, b.name, b.type, r.code, r.type ?? "", r.floor ?? "", r.genderPolicy === "ANY" ? "" : r.genderPolicy, r.beds.map((x) => x.code).join("|")]);
  return toCsv(KINDS[1].columns, rows);
}

export function templateCsv(kind: ImportKind): string {
  const spec = KINDS.find((k) => k.kind === kind)!;
  const example = kind === "staff" ? [["E2001", "Amina", "Khan", "FEMALE", "Finance", "Example Ltd", "+971500000000", "ACTIVE"]] : [["HQ", "B", "Block B", "BUILDING", "B-01", "shared", "1", "MALE", "2"], ["HQ", "B", "", "", "B-02", "shared", "1", "MALE", "B-02-1|B-02-2|B-02-3"]];
  return toCsv(spec.columns, example);
}
