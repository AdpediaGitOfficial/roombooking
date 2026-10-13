// Property hierarchy and setup (document section 7):
// Organization -> Site -> Building -> Floor (optional) -> Unit (optional) -> Room -> Bed.
//
// Ownership: the Super Admin owns the structure (sites, buildings); the Accommodation Admin owns the inside
// (floors, units, rooms, beds) and can be granted building creation. Every level follows
// Draft -> Active -> Under maintenance / Blocked -> Archived. Blocking a building blocks its rooms and beds;
// capacity cannot drop below occupancy; nothing with occupants can be archived; every change is audited.
import { Prisma as PrismaRuntime } from "@prisma/client";
import type { BuildingType, GenderPolicy, Prisma, RecordStatus, RoomStatus } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { actorCan, type ActorLike } from "../../lib/permissions/actor";
import { OCCUPYING_STATUSES } from "../accommodation/occupancy";
import { StructureError } from "./errors";

type Db = Prisma.TransactionClient;
const Prisma_JsonNull = PrismaRuntime.JsonNull; // clears a JSON column
export type Level = "SITE" | "BUILDING" | "FLOOR" | "UNIT" | "ROOM" | "BED";
export type LifecycleStatus = "DRAFT" | "ACTIVE" | "MAINTENANCE" | "BLOCKED" | "ARCHIVED";

const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/;
const MAX_BULK = 200;

function need(actor: ActorLike, key: string, ctx: { siteId?: string | null; buildingId?: string | null } = {}) {
  if (!actorCan(actor, key, ctx)) throw new StructureError("FORBIDDEN", "Your role does not allow this change in this place.");
}

function validCode(code: string, field = "code") {
  if (!CODE.test(code.trim())) throw new StructureError("VALIDATION", "Use letters, numbers, dots, dashes or underscores (up to 30 characters).", { [field]: "Invalid code." });
  return code.trim();
}

const asLifecycle = (s: string): LifecycleStatus => (s === "INACTIVE" || s === "RETIRED" ? "ARCHIVED" : (s as LifecycleStatus));

/** The code a record carries in search, keys and reports: built from its path (for example PV-V07-R2-B). */
export function pathCode(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p).join("-");
}

// ---------------------------------------------------------------------------
// Policy inheritance (document 7): rooms inherit gender and eligibility from building and site unless overridden
// ---------------------------------------------------------------------------

export function effectivePolicy(room: { genderPolicy: GenderPolicy; inheritsPolicy: boolean; eligibility: unknown }, building: { genderPolicy: GenderPolicy | null; eligibility: unknown }, site: { genderPolicy: GenderPolicy | null; defaultEligibility: unknown }) {
  if (!room.inheritsPolicy) return { genderPolicy: room.genderPolicy, eligibility: room.eligibility ?? building.eligibility ?? site.defaultEligibility ?? null, inherited: false };
  return { genderPolicy: building.genderPolicy ?? site.genderPolicy ?? ("ANY" as GenderPolicy), eligibility: building.eligibility ?? site.defaultEligibility ?? null, inherited: true };
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export type SiteInput = { code: string; name: string; propertyType?: string | null; address?: string | null; latitude?: number | null; longitude?: number | null; contactName?: string | null; contactPhone?: string | null; contactEmail?: string | null; timezone?: string | null; genderPolicy?: GenderPolicy | null; defaultEligibility?: Prisma.InputJsonValue | null };

export async function createSite(actor: ActorLike, organizationId: string, input: SiteInput) {
  need(actor, "setup.sites");
  const code = validCode(input.code);
  if (!input.name?.trim()) throw new StructureError("VALIDATION", "Enter the site name.", { name: "Required." });
  if (await prisma.site.findUnique({ where: { organizationId_code: { organizationId, code } } })) throw new StructureError("CONFLICT", "A site with that code already exists.", { code: "Already in use." });
  const tz = input.timezone?.trim() || "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { throw new StructureError("VALIDATION", "Unknown time zone.", { timezone: "Use an IANA name such as Asia/Dubai." }); }
  return prisma.$transaction(async (tx) => {
    const site = await tx.site.create({ data: { organizationId, code, name: input.name.trim(), propertyType: input.propertyType || null, address: input.address || null, latitude: input.latitude ?? null, longitude: input.longitude ?? null, contactName: input.contactName || null, contactPhone: input.contactPhone || null, contactEmail: input.contactEmail || null, timezone: tz, genderPolicy: input.genderPolicy ?? null, defaultEligibility: input.defaultEligibility ?? undefined, status: "DRAFT" } });
    await recordAudit({ actorId: actor.id, action: "SITE_CREATED", entityType: "Site", entityId: site.id, after: { code, name: site.name, status: "DRAFT" } }, tx);
    return site;
  });
}

export async function updateSite(actor: ActorLike, siteId: string, input: Partial<SiteInput>) {
  need(actor, "setup.sites");
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) throw new StructureError("NOT_FOUND", "Site not found.");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.site.update({ where: { id: siteId }, data: { name: input.name?.trim() || undefined, propertyType: input.propertyType === undefined ? undefined : input.propertyType, address: input.address === undefined ? undefined : input.address, latitude: input.latitude === undefined ? undefined : input.latitude, longitude: input.longitude === undefined ? undefined : input.longitude, contactName: input.contactName === undefined ? undefined : input.contactName, contactPhone: input.contactPhone === undefined ? undefined : input.contactPhone, contactEmail: input.contactEmail === undefined ? undefined : input.contactEmail, timezone: input.timezone || undefined, genderPolicy: input.genderPolicy === undefined ? undefined : input.genderPolicy, defaultEligibility: input.defaultEligibility === undefined ? undefined : (input.defaultEligibility ?? Prisma_JsonNull) } });
    await recordAudit({ actorId: actor.id, action: "SITE_UPDATED", entityType: "Site", entityId: siteId, before: { name: site.name, propertyType: site.propertyType, timezone: site.timezone }, after: { name: updated.name, propertyType: updated.propertyType, timezone: updated.timezone } }, tx);
    return updated;
  });
}

export type BuildingInput = { code: string; name: string; type?: BuildingType; address?: string | null; genderPolicy?: GenderPolicy | null; eligibility?: Prisma.InputJsonValue | null };

export async function createBuilding(actor: ActorLike, siteId: string, input: BuildingInput) {
  need(actor, "setup.buildings", { siteId });
  const site = await requireSite(siteId);
  const code = validCode(input.code);
  if (!input.name?.trim()) throw new StructureError("VALIDATION", "Enter the building name.", { name: "Required." });
  if (await prisma.building.findUnique({ where: { siteId_code: { siteId, code } } })) throw new StructureError("CONFLICT", "A building with that code already exists on this site.", { code: "Already in use." });
  return prisma.$transaction(async (tx) => {
    const b = await tx.building.create({ data: { siteId, code, name: input.name.trim(), type: input.type ?? "BUILDING", address: input.address || null, genderPolicy: input.genderPolicy ?? null, eligibility: input.eligibility ?? undefined, status: site.status === "ACTIVE" ? "DRAFT" : "DRAFT" } });
    await recordAudit({ actorId: actor.id, action: "BUILDING_CREATED", entityType: "Building", entityId: b.id, after: { siteId, code, name: b.name, status: "DRAFT" } }, tx);
    return b;
  });
}

export type BulkBuildingInput = { prefix: string; from: number; to: number; pad?: number; namePrefix?: string; type?: BuildingType };

/** Bulk generate buildings such as Villa 01 to 20 or Block A to D (letters via `letters`). */
export async function bulkGenerateBuildings(actor: ActorLike, siteId: string, input: BulkBuildingInput) {
  need(actor, "setup.structure_bulk", { siteId });
  await requireSite(siteId);
  const count = input.to - input.from + 1;
  if (!Number.isInteger(input.from) || !Number.isInteger(input.to) || count < 1 || count > MAX_BULK) throw new StructureError("VALIDATION", `Choose a range of 1 to ${MAX_BULK} buildings.`, { to: "Invalid range." });
  const pad = Math.max(0, Math.min(4, input.pad ?? 2));
  const codes = Array.from({ length: count }, (_, i) => `${validCode(input.prefix || "B", "prefix")}${String(input.from + i).padStart(pad, "0")}`);
  const existing = await prisma.building.findMany({ where: { siteId, code: { in: codes } }, select: { code: true } });
  const taken = new Set(existing.map((e) => e.code));
  const fresh = codes.filter((c) => !taken.has(c));
  const namePrefix = input.namePrefix?.trim() || input.prefix;
  return prisma.$transaction(async (tx) => {
    const created = await tx.building.createManyAndReturn({ data: fresh.map((code) => ({ siteId, code, name: `${namePrefix} ${code.slice(input.prefix.length)}`.trim(), type: input.type ?? "BUILDING", status: "DRAFT" as const })) });
    await recordAudit({ actorId: actor.id, action: "BUILDINGS_BULK_GENERATED", entityType: "Site", entityId: siteId, after: { created: created.length, skipped: taken.size, first: fresh[0] ?? null, last: fresh[fresh.length - 1] ?? null } }, tx);
    return { created: created.length, skipped: taken.size };
  });
}

export async function createFloor(actor: ActorLike, buildingId: string, input: { code: string; name?: string | null; level?: number }) {
  const b = await requireBuilding(buildingId);
  need(actor, "setup.structure", { siteId: b.siteId, buildingId });
  const code = validCode(input.code);
  if (await prisma.floor.findUnique({ where: { buildingId_code: { buildingId, code } } })) throw new StructureError("CONFLICT", "That floor already exists.", { code: "Already in use." });
  return prisma.$transaction(async (tx) => {
    const f = await tx.floor.create({ data: { buildingId, code, name: input.name?.trim() || `Floor ${code}`, level: input.level ?? 0, status: "DRAFT" } });
    await recordAudit({ actorId: actor.id, action: "FLOOR_CREATED", entityType: "Floor", entityId: f.id, after: { buildingId, code } }, tx);
    return f;
  });
}

export async function createUnit(actor: ActorLike, buildingId: string, input: { code: string; name?: string | null; floorId?: string | null }) {
  const b = await requireBuilding(buildingId);
  need(actor, "setup.structure", { siteId: b.siteId, buildingId });
  const code = validCode(input.code);
  if (input.floorId && !(await prisma.floor.findFirst({ where: { id: input.floorId, buildingId } }))) throw new StructureError("VALIDATION", "That floor is not in this building.", { floorId: "Unknown floor." });
  if (await prisma.unit.findUnique({ where: { buildingId_code: { buildingId, code } } })) throw new StructureError("CONFLICT", "That unit already exists.", { code: "Already in use." });
  return prisma.$transaction(async (tx) => {
    const u = await tx.unit.create({ data: { buildingId, floorId: input.floorId || null, code, name: input.name?.trim() || `Unit ${code}`, status: "DRAFT" } });
    await recordAudit({ actorId: actor.id, action: "UNIT_CREATED", entityType: "Unit", entityId: u.id, after: { buildingId, code, floorId: u.floorId } }, tx);
    return u;
  });
}

export type RoomInput = {
  code: string;
  type?: string | null;
  floorId?: string | null;
  unitId?: string | null;
  genderPolicy?: GenderPolicy;
  inheritsPolicy?: boolean;
  eligibility?: Prisma.InputJsonValue | null;
  amenities?: string[];
  attachedBath?: boolean;
  areaSqm?: number | null;
  monthlyCharge?: number | null;
  bedCount?: number;
  bedType?: string | null;
};

const bedLetter = (i: number) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : "");

async function createRoomIn(tx: Db, actor: ActorLike, building: { id: string; siteId: string; code: string }, input: Omit<RoomInput, "code">, code: string) {
  const room = await tx.room.create({ data: { buildingId: building.id, code, type: input.type || null, floorId: input.floorId || null, unitId: input.unitId || null, genderPolicy: input.genderPolicy ?? "ANY", inheritsPolicy: input.inheritsPolicy ?? false, eligibility: input.eligibility ?? undefined, amenities: input.amenities ?? [], attachedBath: input.attachedBath ?? false, areaSqm: input.areaSqm ?? null, monthlyCharge: input.monthlyCharge ?? null, status: "DRAFT" } });
  const beds = Math.max(0, Math.min(20, input.bedCount ?? 0));
  if (beds) await tx.bed.createMany({ data: Array.from({ length: beds }, (_, i) => ({ roomId: room.id, code: `${code}-${bedLetter(i)}`, bedType: input.bedType || null, status: "DRAFT" as const })) });
  await recordAudit({ actorId: actor.id, action: "ROOM_CREATED", entityType: "Room", entityId: room.id, after: { buildingId: building.id, code, beds, status: "DRAFT" } }, tx);
  return room;
}

export async function createRoom(actor: ActorLike, buildingId: string, input: RoomInput) {
  const b = await requireBuilding(buildingId);
  need(actor, "setup.structure", { siteId: b.siteId, buildingId });
  const code = validCode(input.code);
  if (await prisma.room.findUnique({ where: { buildingId_code: { buildingId, code } } })) throw new StructureError("CONFLICT", "That room code is already used in this building.", { code: "Already in use." });
  return prisma.$transaction((tx) => createRoomIn(tx, actor, b, input, code));
}

export type BulkRoomInput = Omit<RoomInput, "code"> & { prefix?: string; from: number; to: number; pad?: number };

/** Bulk generate rooms and their beds, for example Floor 1, rooms 101 to 120, double, 2 beds. */
export async function bulkGenerateRooms(actor: ActorLike, buildingId: string, input: BulkRoomInput) {
  const b = await requireBuilding(buildingId);
  need(actor, "setup.structure_bulk", { siteId: b.siteId, buildingId });
  const count = input.to - input.from + 1;
  if (!Number.isInteger(input.from) || !Number.isInteger(input.to) || count < 1 || count > MAX_BULK) throw new StructureError("VALIDATION", `Choose a range of 1 to ${MAX_BULK} rooms.`, { to: "Invalid range." });
  const pad = Math.max(0, Math.min(4, input.pad ?? 0));
  const prefix = input.prefix?.trim() ?? "";
  const codes = Array.from({ length: count }, (_, i) => validCode(`${prefix}${String(input.from + i).padStart(pad, "0")}`));
  const existing = await prisma.room.findMany({ where: { buildingId, code: { in: codes } }, select: { code: true } });
  const taken = new Set(existing.map((e) => e.code));
  return prisma.$transaction(async (tx) => {
    let created = 0;
    for (const code of codes) {
      if (taken.has(code)) continue;
      await createRoomIn(tx, actor, b, input, code);
      created++;
    }
    await recordAudit({ actorId: actor.id, action: "ROOMS_BULK_GENERATED", entityType: "Building", entityId: buildingId, after: { created, skipped: taken.size, from: codes[0], to: codes[codes.length - 1], bedsPerRoom: input.bedCount ?? 0 } }, tx);
    return { created, skipped: taken.size };
  });
}

export async function updateRoom(actor: ActorLike, roomId: string, input: Partial<Omit<RoomInput, "code" | "bedCount" | "bedType">>) {
  const room = await requireRoom(roomId);
  need(actor, "setup.structure", { siteId: room.building.siteId, buildingId: room.buildingId });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.room.update({ where: { id: roomId }, data: { type: input.type === undefined ? undefined : input.type, floorId: input.floorId === undefined ? undefined : input.floorId, unitId: input.unitId === undefined ? undefined : input.unitId, genderPolicy: input.genderPolicy, inheritsPolicy: input.inheritsPolicy, eligibility: input.eligibility === undefined ? undefined : (input.eligibility ?? Prisma_JsonNull), amenities: input.amenities, attachedBath: input.attachedBath, areaSqm: input.areaSqm === undefined ? undefined : input.areaSqm, monthlyCharge: input.monthlyCharge === undefined ? undefined : input.monthlyCharge } });
    await recordAudit({ actorId: actor.id, action: "ROOM_UPDATED", entityType: "Room", entityId: roomId, before: { type: room.type, genderPolicy: room.genderPolicy, inheritsPolicy: room.inheritsPolicy }, after: { type: updated.type, genderPolicy: updated.genderPolicy, inheritsPolicy: updated.inheritsPolicy } }, tx);
    return updated;
  });
}

/** Adds numbered beds to a room. Beds join an active room in service at once; in a draft room they start as drafts. */
export async function addBeds(actor: ActorLike, roomId: string, count: number, bedType?: string | null) {
  const room = await requireRoom(roomId);
  need(actor, "setup.structure", { siteId: room.building.siteId, buildingId: room.buildingId });
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new StructureError("VALIDATION", "Enter a number of beds between 1 and 20.", { count: "1 to 20." });
  const existing = await prisma.bed.findMany({ where: { roomId }, select: { code: true } });
  const prefix = `${room.code}-`;
  let max = 0;
  for (const { code } of existing) {
    if (!code.startsWith(prefix)) continue;
    const n = Number(code.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  const letters = existing.every((e) => /^[A-Z]\d*$/.test(e.code.slice(prefix.length)) || !e.code.startsWith(prefix)) && existing.length > 0;
  const status = room.status === "ACTIVE" ? "ACTIVE" : "DRAFT";
  const codes = Array.from({ length: count }, (_, i) => (letters ? `${prefix}${bedLetter(existing.length + i)}` : `${prefix}${max + 1 + i}`));
  return prisma.$transaction(async (tx) => {
    const beds = await tx.bed.createManyAndReturn({ data: codes.map((code) => ({ roomId, code, bedType: bedType || null, status: status as "ACTIVE" | "DRAFT" })) });
    for (const bed of beds) await recordAudit({ actorId: actor.id, action: "BED_CREATED", entityType: "Bed", entityId: bed.id, after: { roomId, code: bed.code, status } }, tx);
    return beds;
  });
}

// ---------------------------------------------------------------------------
// Lifecycle (Draft -> Active -> Under maintenance / Blocked -> Archived)
// ---------------------------------------------------------------------------

type Node = { level: Level; id: string; siteId: string; buildingId: string | null; status: string; label: string };

async function loadNode(level: Level, id: string, db: Db | typeof prisma = prisma): Promise<Node> {
  switch (level) {
    case "SITE": { const x = await db.site.findUnique({ where: { id } }); if (!x) break; return { level, id, siteId: x.id, buildingId: null, status: x.status, label: x.name }; }
    case "BUILDING": { const x = await db.building.findUnique({ where: { id } }); if (!x) break; return { level, id, siteId: x.siteId, buildingId: x.id, status: x.status, label: x.name }; }
    case "FLOOR": { const x = await db.floor.findUnique({ where: { id }, include: { building: true } }); if (!x) break; return { level, id, siteId: x.building.siteId, buildingId: x.buildingId, status: x.status, label: `Floor ${x.code}` }; }
    case "UNIT": { const x = await db.unit.findUnique({ where: { id }, include: { building: true } }); if (!x) break; return { level, id, siteId: x.building.siteId, buildingId: x.buildingId, status: x.status, label: `Unit ${x.code}` }; }
    case "ROOM": { const x = await db.room.findUnique({ where: { id }, include: { building: true } }); if (!x) break; return { level, id, siteId: x.building.siteId, buildingId: x.buildingId, status: x.status, label: `Room ${x.code}` }; }
    case "BED": { const x = await db.bed.findUnique({ where: { id }, include: { room: { include: { building: true } } } }); if (!x) break; return { level, id, siteId: x.room.building.siteId, buildingId: x.room.buildingId, status: x.status, label: `Bed ${x.code}` }; }
  }
  throw new StructureError("NOT_FOUND", "Record not found.");
}

/** Capability that governs changes at each level. */
function levelCapability(level: Level): string {
  return level === "SITE" ? "setup.sites" : level === "BUILDING" ? "setup.buildings" : "setup.structure";
}

/** Live (current or upcoming) allocations on beds at or below a node. */
export async function occupantCount(level: Level, id: string, db: Db | typeof prisma = prisma): Promise<number> {
  const bedWhere: Prisma.BedWhereInput =
    level === "SITE" ? { room: { building: { siteId: id } } }
    : level === "BUILDING" ? { room: { buildingId: id } }
    : level === "FLOOR" ? { room: { floorId: id } }
    : level === "UNIT" ? { room: { unitId: id } }
    : level === "ROOM" ? { roomId: id }
    : { id };
  return db.allocation.count({ where: { status: { in: OCCUPYING_STATUSES }, bed: bedWhere } });
}

async function writeStatus(tx: Db, node: Node, status: LifecycleStatus, extra: { reason?: string | null; until?: Date | null; actorId: string }) {
  const archived = status === "ARCHIVED" ? { archivedAt: new Date(), archivedById: extra.actorId, archiveReason: extra.reason ?? null } : { archivedAt: null, archivedById: null, archiveReason: null };
  const block = status === "BLOCKED" || status === "MAINTENANCE" ? (extra.reason ?? null) : null;
  switch (node.level) {
    case "SITE": await tx.site.update({ where: { id: node.id }, data: { status, ...archived } }); break;
    case "BUILDING": await tx.building.update({ where: { id: node.id }, data: { status, ...archived } }); break;
    case "FLOOR": await tx.floor.update({ where: { id: node.id }, data: { status, ...archived } }); break;
    case "UNIT": await tx.unit.update({ where: { id: node.id }, data: { status, ...archived } }); break;
    case "ROOM": await tx.room.update({ where: { id: node.id }, data: { status: status as RoomStatus, blockReason: block, ...archived } }); break;
    case "BED": await tx.bed.update({ where: { id: node.id }, data: { status, blockReason: block, blockedUntil: extra.until ?? null, ...archived } }); break;
  }
}

export type StatusChange = { level: Level; id: string; status: LifecycleStatus; reason?: string | null; until?: string | null };

/** Moves one record along its lifecycle with the document's rules. */
export async function setStatus(actor: ActorLike, change: StatusChange) {
  const node = await loadNode(change.level, change.id);
  const from = asLifecycle(node.status);
  const to = change.status;
  const ctx = { siteId: node.siteId, buildingId: node.buildingId };
  if (from === to && !(to === "BLOCKED" || to === "MAINTENANCE")) throw new StructureError("INVALID_STATE", `That is already ${to.toLowerCase()}.`);
  const reason = change.reason?.trim() || null;

  if (to === "ACTIVE" && from === "DRAFT") need(actor, "setup.activate", ctx);
  else if (to === "ARCHIVED") need(actor, levelCapability(change.level), ctx);
  else if (from === "ARCHIVED") throw new StructureError("INVALID_STATE", "Restore an archived record before changing its status.");
  else need(actor, change.level === "SITE" || change.level === "BUILDING" ? "setup.structure" : "setup.structure", ctx);

  if (from === "DRAFT" && to !== "ACTIVE" && to !== "ARCHIVED") throw new StructureError("INVALID_STATE", "A draft must be activated (or archived), not blocked.");
  if ((to === "BLOCKED" || to === "MAINTENANCE" || to === "ARCHIVED") && !reason) throw new StructureError("VALIDATION", "Give a reason.", { reason: "Required." });
  if (to === "ARCHIVED") {
    const n = await occupantCount(change.level, change.id);
    if (n > 0) throw new StructureError("INVALID_STATE", `${node.label} has ${n} current or upcoming ${n === 1 ? "allocation" : "allocations"}. Move or check out the occupants first: nothing with occupants can be archived.`);
  }
  let until: Date | null = null;
  if (change.until) {
    until = new Date(`${change.until}T00:00:00.000Z`);
    if (Number.isNaN(until.getTime())) throw new StructureError("VALIDATION", "Enter a valid expected date.", { until: "Invalid date." });
  }

  return prisma.$transaction(async (tx) => {
    await writeStatus(tx, node, to, { reason, until, actorId: actor.id });
    await recordAudit({ actorId: actor.id, action: to === "ARCHIVED" ? `${change.level}_ARCHIVED` : to === "ACTIVE" && from === "DRAFT" ? `${change.level}_ACTIVATED` : `${change.level}_STATUS_CHANGED`, entityType: change.level[0] + change.level.slice(1).toLowerCase(), entityId: change.id, before: { status: from }, after: { status: to, reason, until: until?.toISOString().slice(0, 10) ?? null } }, tx);
    return { from, to };
  });
}

/** Restores an archived record to Draft; it must be activated again before it can be used. */
export async function restoreRecord(actor: ActorLike, level: Level, id: string, opts: { restoreDays?: number; now?: Date } = {}) {
  const node = await loadNode(level, id);
  if (asLifecycle(node.status) !== "ARCHIVED") throw new StructureError("INVALID_STATE", "Only archived records can be restored.");
  need(actor, "setup.restore", { siteId: node.siteId, buildingId: node.buildingId });
  const row = await archivedAtOf(level, id);
  const days = opts.restoreDays ?? (await restoreWindowDays(node.siteId));
  const now = opts.now ?? new Date();
  // Inside the window an Accommodation Admin with the grant may restore; after it only the Super Admin can.
  if (row && now.getTime() - row.getTime() > days * 86400000 && !actor.roles.includes("SYSTEM_ADMIN")) {
    throw new StructureError("FORBIDDEN", `The ${days}-day restore window has passed; ask a Super Admin to restore it.`);
  }
  return prisma.$transaction(async (tx) => {
    await writeStatus(tx, node, "DRAFT", { actorId: actor.id });
    await recordAudit({ actorId: actor.id, action: `${level}_RESTORED`, entityType: level[0] + level.slice(1).toLowerCase(), entityId: id, after: { status: "DRAFT" } }, tx);
  });
}

async function archivedAtOf(level: Level, id: string): Promise<Date | null> {
  switch (level) {
    case "SITE": return (await prisma.site.findUnique({ where: { id }, select: { archivedAt: true } }))?.archivedAt ?? null;
    case "BUILDING": return (await prisma.building.findUnique({ where: { id }, select: { archivedAt: true } }))?.archivedAt ?? null;
    case "FLOOR": return (await prisma.floor.findUnique({ where: { id }, select: { archivedAt: true } }))?.archivedAt ?? null;
    case "UNIT": return (await prisma.unit.findUnique({ where: { id }, select: { archivedAt: true } }))?.archivedAt ?? null;
    case "ROOM": return (await prisma.room.findUnique({ where: { id }, select: { archivedAt: true } }))?.archivedAt ?? null;
    case "BED": return (await prisma.bed.findUnique({ where: { id }, select: { archivedAt: true } }))?.archivedAt ?? null;
  }
}

export async function restoreWindowDays(_siteId?: string | null): Promise<number> {
  const org = await prisma.organization.findFirst({ select: { id: true } });
  const setting = org ? await prisma.orgSetting.findUnique({ where: { organizationId_key: { organizationId: org.id, key: "archive.restoreDays" } } }) : null;
  const n = Number(setting?.value ?? 30);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

// ---------------------------------------------------------------------------
// Activation review (document 7, steps 5 and 6)
// ---------------------------------------------------------------------------

export type ActivationReview = {
  scope: { level: "SITE" | "BUILDING"; id: string; name: string };
  draft: { buildings: number; rooms: number; beds: number; floors: number; units: number };
  problems: string[];
  ready: boolean;
};

/** What activation would switch on, and what is still missing (rooms without beds, buildings without rooms). */
export async function activationReview(level: "SITE" | "BUILDING", id: string): Promise<ActivationReview> {
  const node = await loadNode(level, id);
  const bw: Prisma.BuildingWhereInput = level === "SITE" ? { siteId: id } : { id };
  const buildings = await prisma.building.findMany({ where: { ...bw, status: { in: ["DRAFT", "ACTIVE"] } }, include: { rooms: { where: { status: { in: ["DRAFT", "ACTIVE"] } }, include: { beds: { where: { status: { in: ["DRAFT", "ACTIVE"] } }, select: { id: true, status: true } } } }, floors: { select: { status: true } }, units: { select: { status: true } } } });
  const problems: string[] = [];
  let rooms = 0, beds = 0, floors = 0, units = 0, draftBuildings = 0;
  for (const b of buildings) {
    if (b.status === "DRAFT") draftBuildings++;
    floors += b.floors.filter((f) => f.status === "DRAFT").length;
    units += b.units.filter((u) => u.status === "DRAFT").length;
    if (b.rooms.length === 0) problems.push(`${b.name} has no rooms.`);
    for (const r of b.rooms) {
      if (r.status === "DRAFT") rooms++;
      if (r.beds.length === 0) problems.push(`Room ${r.code} in ${b.name} has no beds.`);
      beds += r.beds.filter((x) => x.status === "DRAFT").length;
    }
  }
  return { scope: { level, id, name: node.label }, draft: { buildings: draftBuildings, rooms, beds, floors, units }, problems: problems.slice(0, 20), ready: problems.length === 0 && (draftBuildings + rooms + beds > 0 || node.status === "DRAFT") };
}

/** Activates a draft site or building and everything drafted beneath it, so its beds appear in Allocations. */
export async function activateBranch(actor: ActorLike, level: "SITE" | "BUILDING", id: string) {
  const node = await loadNode(level, id);
  need(actor, "setup.activate", { siteId: node.siteId, buildingId: node.buildingId });
  const review = await activationReview(level, id);
  if (review.problems.length) throw new StructureError("VALIDATION", `Fix these before activating: ${review.problems.slice(0, 3).join(" ")}`);
  const bw: Prisma.BuildingWhereInput = level === "SITE" ? { siteId: id } : { id };
  return prisma.$transaction(async (tx) => {
    if (level === "SITE") await tx.site.update({ where: { id }, data: { status: "ACTIVE" } });
    const buildingIds = (await tx.building.findMany({ where: bw, select: { id: true } })).map((b) => b.id);
    const b = await tx.building.updateMany({ where: { id: { in: buildingIds }, status: "DRAFT" }, data: { status: "ACTIVE" } });
    await tx.floor.updateMany({ where: { buildingId: { in: buildingIds }, status: "DRAFT" }, data: { status: "ACTIVE" } });
    await tx.unit.updateMany({ where: { buildingId: { in: buildingIds }, status: "DRAFT" }, data: { status: "ACTIVE" } });
    const r = await tx.room.updateMany({ where: { buildingId: { in: buildingIds }, status: "DRAFT" }, data: { status: "ACTIVE" } });
    const beds = await tx.bed.updateMany({ where: { room: { buildingId: { in: buildingIds } }, status: "DRAFT" }, data: { status: "ACTIVE" } });
    await recordAudit({ actorId: actor.id, action: `${level}_ACTIVATED`, entityType: level === "SITE" ? "Site" : "Building", entityId: id, after: { buildings: b.count, rooms: r.count, beds: beds.count } }, tx);
    return { buildings: b.count, rooms: r.count, beds: beds.count };
  });
}

/** An Accommodation Admin submits a drafted branch; Super Admins are notified to activate it (no grant needed). */
export async function submitForActivation(actor: ActorLike, organizationId: string, level: "SITE" | "BUILDING", id: string) {
  const node = await loadNode(level, id);
  need(actor, "setup.structure", { siteId: node.siteId, buildingId: node.buildingId });
  const review = await activationReview(level, id);
  if (review.problems.length) throw new StructureError("VALIDATION", `Fix these before submitting: ${review.problems.slice(0, 3).join(" ")}`);
  const admins = await prisma.user.findMany({ where: { organizationId, status: "ACTIVE", roleAssignments: { some: { role: "SYSTEM_ADMIN" } } }, select: { id: true } });
  await prisma.$transaction(async (tx) => {
    await recordAudit({ actorId: actor.id, action: "ACTIVATION_SUBMITTED", entityType: level === "SITE" ? "Site" : "Building", entityId: id, after: { draft: review.draft } }, tx);
    for (const a of admins) await enqueueNotification(tx, { recipientId: a.id, event: "structure.activation_submitted", idempotencyKey: `activation:${id}:${Date.now()}:${a.id}`, payload: { name: node.label, level: level.toLowerCase() } });
  });
  return { notified: admins.length };
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

async function requireSite(id: string) {
  const s = await prisma.site.findUnique({ where: { id } });
  if (!s) throw new StructureError("NOT_FOUND", "Site not found.");
  return s;
}
async function requireBuilding(id: string) {
  const b = await prisma.building.findUnique({ where: { id } });
  if (!b) throw new StructureError("NOT_FOUND", "Building not found.");
  return b;
}
async function requireRoom(id: string) {
  const r = await prisma.room.findUnique({ where: { id }, include: { building: true } });
  if (!r) throw new StructureError("NOT_FOUND", "Room not found.");
  return r;
}

/** Whether the person can submit or activate (used to show the right button). */
export function canActivate(actor: ActorLike, ctx: { siteId?: string | null; buildingId?: string | null }) {
  return actorCan(actor, "setup.activate", ctx);
}
