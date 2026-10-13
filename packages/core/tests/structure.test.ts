import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/db";
import type { ActorLike } from "../src/lib/permissions/actor";
import { StructureError } from "../src/modules/structure/errors";
import { activateBranch, activationReview, addBeds, bulkGenerateBuildings, bulkGenerateRooms, createBuilding, createFloor, createRoom, createSite, createUnit, effectivePolicy, restoreRecord, setStatus, submitForActivation } from "../src/modules/structure/service";
import { getBuildingOccupancy, getRoomOccupancy } from "../src/modules/accommodation/occupancy";
import { ArchiveError, archiveRecord, hardDelete, restoreArchived } from "../src/modules/archive/service";
import { allocate } from "../src/modules/allocations/service";

let orgId: string;
let sa: ActorLike;
let aa: ActorLike;
let aaGranted: ActorLike;
let officer: ActorLike;
const stamp = Date.now().toString(36);

async function expectError<T>(p: Promise<T>, code: string, cls: new (...a: never[]) => Error = StructureError) {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(cls);
    expect((e as { code: string }).code).toBe(code);
    return e as Error;
  }
  throw new Error(`expected ${code}`);
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { code: `ST-${stamp}`, name: "Structure Org" } });
  orgId = org.id;
  const mk = async (name: string, role: "SYSTEM_ADMIN" | "ACCOMMODATION_ADMIN" | "ACCOMMODATION_OFFICER") => {
    const u = await prisma.user.create({ data: { organizationId: orgId, username: `st-${name}-${stamp}`, name, status: "ACTIVE", roleAssignments: { create: { role } } }, include: { roleAssignments: true } });
    return { u, actor: { id: u.id, roles: [role], roleAssignments: u.roleAssignments } as ActorLike };
  };
  sa = (await mk("sa", "SYSTEM_ADMIN")).actor;
  const aaUser = await mk("aa", "ACCOMMODATION_ADMIN");
  aa = aaUser.actor;
  const granted = await mk("aag", "ACCOMMODATION_ADMIN");
  aaGranted = { ...granted.actor, grants: [{ userId: granted.u.id, capabilitySet: "BUILDING_CREATION" }] };
  officer = (await mk("of", "ACCOMMODATION_OFFICER")).actor;
});
afterAll(async () => { await prisma.$disconnect(); });

describe("setup ownership", () => {
  it("only the Super Admin creates sites; the Admin needs the Building creation grant for buildings", async () => {
    await expectError(createSite(aa, orgId, { code: "X1", name: "No" }), "FORBIDDEN");
    const site = await createSite(sa, orgId, { code: `PV${stamp}`.slice(0, 12), name: "Palm Villas", propertyType: "VILLA_COMPOUND", timezone: "Asia/Dubai" });
    expect(site.status).toBe("DRAFT");
    await expectError(createSite(sa, orgId, { code: site.code, name: "Dup" }), "CONFLICT");
    await expectError(createSite(sa, orgId, { code: "BAD", name: "Zone", timezone: "Nowhere/Land" }), "VALIDATION");
    await expectError(createBuilding(aa, site.id, { code: "V01", name: "Villa 01" }), "FORBIDDEN");
    const b = await createBuilding(aaGranted, site.id, { code: "V01", name: "Villa 01", type: "VILLA" });
    expect(b.status).toBe("DRAFT");
    await expectError(createBuilding(aaGranted, site.id, { code: "V01", name: "again" }), "CONFLICT");
    await expectError(createBuilding(sa, site.id, { code: "bad code!", name: "x" }), "VALIDATION");
    // The Admin owns the inside: floors, units, rooms and beds are theirs by default.
    const floor = await createFloor(aa, b.id, { code: "1", level: 1 });
    const unit = await createUnit(aa, b.id, { code: "302", floorId: floor.id });
    const room = await createRoom(aa, b.id, { code: "V01-R1", floorId: floor.id, unitId: unit.id, bedCount: 2, amenities: ["AC"] });
    expect(room.status).toBe("DRAFT");
    const beds = await prisma.bed.findMany({ where: { roomId: room.id }, orderBy: { code: "asc" } });
    expect(beds.map((x) => x.code)).toEqual(["V01-R1-A", "V01-R1-B"]);
    expect(beds.every((x) => x.status === "DRAFT")).toBe(true);
    await expectError(createRoom(officer, b.id, { code: "V01-R9" }), "FORBIDDEN");
  });
});

describe("bulk generation", () => {
  it("generates buildings and rooms, skipping codes that exist, and needs the bulk capability", async () => {
    const site = await createSite(sa, orgId, { code: `BG${stamp}`.slice(0, 12), name: "Bulk Site" });
    await expectError(bulkGenerateBuildings(aa, site.id, { prefix: "V", from: 1, to: 3 }), "FORBIDDEN"); // grantable, not granted
    const first = await bulkGenerateBuildings(sa, site.id, { prefix: "V", from: 1, to: 20, pad: 2, namePrefix: "Villa" });
    expect(first).toEqual({ created: 20, skipped: 0 });
    expect(await bulkGenerateBuildings(sa, site.id, { prefix: "V", from: 15, to: 22 })).toEqual({ created: 2, skipped: 6 });
    await expectError(bulkGenerateBuildings(sa, site.id, { prefix: "V", from: 5, to: 1 }), "VALIDATION");
    const b = await prisma.building.findFirstOrThrow({ where: { siteId: site.id, code: "V07" } });
    expect(b.name).toBe("Villa 07");
    const r = await bulkGenerateRooms(sa, b.id, { prefix: "R", from: 101, to: 120, bedCount: 2, type: "DOUBLE", amenities: ["AC"] });
    expect(r.created).toBe(20);
    expect(await prisma.bed.count({ where: { room: { buildingId: b.id } } })).toBe(40);
  });
});

describe("lifecycle", () => {
  let siteId: string;
  let buildingId: string;
  let roomId: string;
  let bedId: string;
  it("only active beds exist for allocation; activation switches a whole branch on", async () => {
    const site = await createSite(sa, orgId, { code: `LC${stamp}`.slice(0, 12), name: "Lifecycle Site" });
    siteId = site.id;
    const b = await createBuilding(sa, siteId, { code: "B1", name: "Block 1" });
    buildingId = b.id;
    await createRoom(sa, b.id, { code: "B1-101", bedCount: 2 });
    await createRoom(sa, b.id, { code: "B1-102" });
    const review = await activationReview("BUILDING", b.id);
    expect(review.problems.join(" ")).toMatch(/B1-102 in Block 1 has no beds/);
    await expectError(activateBranch(sa, "BUILDING", b.id), "VALIDATION");
    await expectError(activateBranch(aa, "BUILDING", b.id), "FORBIDDEN"); // activation is Super Admin unless granted
    const room2 = await prisma.room.findFirstOrThrow({ where: { buildingId: b.id, code: "B1-102" } });
    await addBeds(sa, room2.id, 1);
    const sub = await submitForActivation(aa, orgId, "BUILDING", b.id);
    expect(sub.notified).toBeGreaterThan(0);
    const done = await activateBranch(sa, "BUILDING", b.id);
    expect(done).toEqual({ buildings: 1, rooms: 2, beds: 3 });
    // A building under a draft site is still outside service until the site is active.
    await expect(allocate({ staffId: (await prisma.staffProfile.create({ data: { organizationId: orgId, employeeId: `DS-${stamp}`, firstName: "Draft", lastName: "Site" } })).id, bedId: (await prisma.bed.findFirstOrThrow({ where: { room: { buildingId: b.id } } })).id, startDate: "2030-01-01", actorId: sa.id })).rejects.toThrow(/draft/i);
    await setStatus(sa, { level: "SITE", id: siteId, status: "ACTIVE" });
    const room = await prisma.room.findFirstOrThrow({ where: { buildingId: b.id, code: "B1-101" } });
    roomId = room.id;
    bedId = (await prisma.bed.findFirstOrThrow({ where: { roomId } })).id;
    expect((await prisma.bed.findUniqueOrThrow({ where: { id: bedId } })).status).toBe("ACTIVE");
    // A bed added to an active room is in service at once.
    const [extra] = await addBeds(aa, roomId, 1);
    expect(extra.status).toBe("ACTIVE");
  });

  it("blocking a building blocks its rooms and beds, and capacity reports it", async () => {
    await expectError(setStatus(sa, { level: "BUILDING", id: buildingId, status: "BLOCKED" }), "VALIDATION"); // reason needed
    await setStatus(sa, { level: "BUILDING", id: buildingId, status: "BLOCKED", reason: "Fire inspection" });
    const blocked = await getBuildingOccupancy(buildingId);
    expect(blocked!.summary.blocked).toBe(blocked!.summary.capacity);
    const room = await getRoomOccupancy(roomId);
    expect(room!.beds.every((b) => b.state === "BLOCKED")).toBe(true);
    await setStatus(sa, { level: "BUILDING", id: buildingId, status: "ACTIVE" });
    expect((await getBuildingOccupancy(buildingId))!.summary.blocked).toBe(0);
    await setStatus(sa, { level: "BED", id: bedId, status: "MAINTENANCE", reason: "Broken frame", until: "2099-01-01" });
    const m = (await getRoomOccupancy(roomId))!;
    expect(m.beds.find((b) => b.id === bedId)!.state).toBe("MAINTENANCE");
    expect(m.summary.maintenance).toBe(1);
    await setStatus(sa, { level: "BED", id: bedId, status: "ACTIVE" });
  });

  it("nothing with occupants can be archived; archived records can be restored to draft", async () => {
    const staff = await prisma.staffProfile.create({ data: { organizationId: orgId, employeeId: `LC-${stamp}`, firstName: "Live", lastName: "Occupant" } });
    const today = new Date().toISOString().slice(0, 10);
    await allocate({ staffId: staff.id, bedId, startDate: today, endDate: null, actorId: sa.id });
    const bedErr = await expectError(setStatus(sa, { level: "BED", id: bedId, status: "ARCHIVED", reason: "Replace" }), "INVALID_STATE");
    expect(bedErr.message).toMatch(/nothing with occupants can be archived/);
    await expectError(setStatus(sa, { level: "ROOM", id: roomId, status: "ARCHIVED", reason: "Closing" }), "INVALID_STATE");
    await expectError(setStatus(sa, { level: "SITE", id: siteId, status: "ARCHIVED", reason: "Closing" }), "INVALID_STATE");
    // An empty bed can be archived and restored.
    const empty = await prisma.bed.findFirstOrThrow({ where: { roomId, id: { not: bedId } } });
    await setStatus(aa, { level: "BED", id: empty.id, status: "ARCHIVED", reason: "Removed from room" });
    expect((await prisma.bed.findUniqueOrThrow({ where: { id: empty.id } })).archivedAt).not.toBeNull();
    await expectError(setStatus(sa, { level: "BED", id: empty.id, status: "ACTIVE" }), "INVALID_STATE");
    await expectError(restoreRecord(aa, "BED", empty.id), "FORBIDDEN"); // restore is Grantable for Admins
    await restoreRecord(sa, "BED", empty.id);
    const back = await prisma.bed.findUniqueOrThrow({ where: { id: empty.id } });
    expect(back.status).toBe("DRAFT");
    expect(back.archivedAt).toBeNull();
    // Past the restore window an Admin with the grant can no longer restore it; the Super Admin still can.
    await setStatus(sa, { level: "BED", id: empty.id, status: "ACTIVE" });
    await setStatus(sa, { level: "BED", id: empty.id, status: "ARCHIVED", reason: "Again" });
    const grantedRestorer: ActorLike = { ...aa, grants: [{ userId: aa.id, capability: "setup.restore" }] };
    await expectError(restoreRecord(grantedRestorer, "BED", empty.id, { now: new Date(Date.now() + 40 * 86400000) }), "FORBIDDEN");
    await restoreRecord(sa, "BED", empty.id, { now: new Date(Date.now() + 40 * 86400000) });
  });
});

describe("policy inheritance", () => {
  it("rooms inherit gender and eligibility from building and site unless overridden", () => {
    const room = { genderPolicy: "ANY" as const, inheritsPolicy: true, eligibility: null };
    const building = { genderPolicy: "FEMALE" as const, eligibility: { grades: ["G3"] } };
    const site = { genderPolicy: "MALE" as const, defaultEligibility: { grades: ["G1"] } };
    expect(effectivePolicy(room, building, site)).toMatchObject({ genderPolicy: "FEMALE", eligibility: { grades: ["G3"] }, inherited: true });
    expect(effectivePolicy(room, { genderPolicy: null, eligibility: null }, site)).toMatchObject({ genderPolicy: "MALE", eligibility: { grades: ["G1"] } });
    expect(effectivePolicy({ ...room, inheritsPolicy: false, genderPolicy: "MALE", eligibility: { grades: ["G9"] } }, building, site)).toMatchObject({ genderPolicy: "MALE", eligibility: { grades: ["G9"] }, inherited: false });
  });
});

describe("archive and hard delete", () => {
  it("archives records with a reason, blocks when work is open, restores in the window and purges only after it", async () => {
    const vendor = await prisma.vendor.create({ data: { organizationId: orgId, name: `Arch Vendor ${stamp}` } });
    await expectError(archiveRecord(officer, "VENDOR", vendor.id, "x"), "FORBIDDEN", ArchiveError);
    await expectError(archiveRecord(sa, "VENDOR", vendor.id, " "), "VALIDATION", ArchiveError);
    await archiveRecord(sa, "VENDOR", vendor.id, "Contract ended");
    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: vendor.id } })).status).toBe("ARCHIVED");
    await expectError(archiveRecord(sa, "VENDOR", vendor.id, "again"), "INVALID_STATE", ArchiveError);
    await expectError(hardDelete(sa, "VENDOR", vendor.id), "INVALID_STATE", ArchiveError); // window still open
    await expectError(hardDelete(aa, "VENDOR", vendor.id), "FORBIDDEN", ArchiveError); // Super Admin only
    await restoreArchived(sa, "VENDOR", vendor.id);
    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: vendor.id } })).archivedAt).toBeNull();
    await archiveRecord(sa, "VENDOR", vendor.id, "Contract ended again");
    await hardDelete(sa, "VENDOR", vendor.id, { now: new Date(Date.now() + 31 * 86400000) });
    expect(await prisma.vendor.findUnique({ where: { id: vendor.id } })).toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "VENDOR_PURGED", entityId: vendor.id } })).toBe(1);
  });

  it("refuses to purge a record that history still refers to", async () => {
    const staff = await prisma.staffProfile.create({ data: { organizationId: orgId, employeeId: `AR-${stamp}`, firstName: "Arch", lastName: "Staff" } });
    const bed = await prisma.bed.findFirstOrThrow({ where: { room: { building: { site: { code: { startsWith: "LC" }, organizationId: orgId } } } } });
    await prisma.allocation.create({ data: { staffId: staff.id, bedId: bed.id, startDate: new Date("2020-01-01"), endDate: new Date("2020-02-01"), status: "CHECKED_OUT" } });
    await archiveRecord(sa, "STAFF", staff.id, "Left");
    await expectError(hardDelete(sa, "STAFF", staff.id, { now: new Date(Date.now() + 31 * 86400000) }), "INVALID_STATE", ArchiveError);
  });
});
