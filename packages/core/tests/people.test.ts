import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import type { ActorLike } from "../src/lib/permissions/actor";
import { personLevel, viewPerson, maskTail } from "../src/lib/permissions/privacy";
import { PeopleError } from "../src/modules/people/errors";
import { addDependent, addGuestProfile, addStaff, decideDependent, findDuplicates, getPerson, listPeople, mergeStaff, rehireStaff, setEntitlement, stayStatus, sweepExpiredProfiles, updateStaff, verifyStaff } from "../src/modules/people/service";
import { cancelExit, clearanceStatus, closeClearance, createJoiner, listExits, sweepExits, sweepJoiners, triggerExit } from "../src/modules/people/lifecycle";
import { allocate, checkIn, checkOut } from "../src/modules/allocations/service";
import { AllocationError } from "../src/modules/allocations/errors";
import { checkEligibility } from "../src/modules/allocations/eligibility";
import { addToWaitlist, allocateFromWaitlist, bulkAllocate, decideProvisional, emergencyCheckIn, extendStay, listWaitlist, setReadiness, suggestForWaitlist, swapBeds, sweepProvisional } from "../src/modules/allocations/extras";
import { issueKey, registerKey } from "../src/modules/keys/service";
import { archiveRecord } from "../src/modules/archive/service";

const stamp = Date.now().toString(36);
const day = 86400000;
const iso = (offset = 0) => new Date(Date.now() + offset * day).toISOString().slice(0, 10);
let orgId: string;
let siteId: string;
let buildingId: string;
const beds: string[] = [];
const rooms: string[] = [];
let sa: ActorLike;
let aa: ActorLike;
let officer: ActorLike;
let officerEmergency: ActorLike;
let officerGuest: ActorLike;
let aaBulk: ActorLike;

async function expectError<T>(p: Promise<T>, code: string, cls: new (...a: never[]) => Error = PeopleError) {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(cls);
    expect((e as { code: string }).code).toBe(code);
    return e as Error;
  }
  throw new Error(`expected ${code}`);
}

const mkStaff = (id: string, over: Record<string, unknown> = {}) => prisma.staffProfile.create({ data: { organizationId: orgId, employeeId: `${id}-${stamp}`, firstName: id, lastName: "Person", ...over } });

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { code: `PP-${stamp}`, name: "People Org" } })).id;
  siteId = (await prisma.site.create({ data: { organizationId: orgId, code: "PPS", name: "People Site", timezone: "UTC" } })).id;
  buildingId = (await prisma.building.create({ data: { siteId, code: "PB", name: "People Block" } })).id;
  for (let r = 1; r <= 4; r++) {
    const room = await prisma.room.create({ data: { buildingId, code: `PB-${r}`, type: r === 4 ? "SUITE" : "DOUBLE" } });
    rooms.push(room.id);
    for (const n of [1, 2]) beds.push((await prisma.bed.create({ data: { roomId: room.id, code: `PB-${r}-${n}` } })).id);
  }
  const mk = async (name: string, role: "SYSTEM_ADMIN" | "ACCOMMODATION_ADMIN" | "ACCOMMODATION_OFFICER", grants: string[] = []): Promise<ActorLike> => {
    const u = await prisma.user.create({ data: { organizationId: orgId, username: `pp-${name}-${stamp}`, name, status: "ACTIVE", roleAssignments: { create: { role } } }, include: { roleAssignments: true } });
    return { id: u.id, roles: [role], roleAssignments: u.roleAssignments, grants: grants.map((g) => ({ userId: u.id, capabilitySet: g })) };
  };
  sa = await mk("sa", "SYSTEM_ADMIN");
  aa = await mk("aa", "ACCOMMODATION_ADMIN");
  officer = await mk("of", "ACCOMMODATION_OFFICER");
  officerEmergency = await mk("ofe", "ACCOMMODATION_OFFICER", ["EMERGENCY_CHECKIN"]);
  officerGuest = await mk("ofg", "ACCOMMODATION_OFFICER", ["EMERGENCY_CHECKIN"]);
  aaBulk = await mk("aab", "ACCOMMODATION_ADMIN", ["ADMIN_OVERRIDES"]);
});
afterAll(async () => { await prisma.$disconnect(); });

describe("directory, verification and privacy", () => {
  it("officers add unverified staff; admins verify, but not their own additions", async () => {
    await expectError(addStaff(officer, orgId, { employeeId: "X", firstName: "A", lastName: "B" }), "FORBIDDEN"); // grantable, not granted
    const granted: ActorLike = { ...officer, grants: [{ userId: officer.id, capability: "people.add" }] };
    const s = await addStaff(granted, orgId, { employeeId: `WALK-${stamp}`, firstName: "Walk", lastName: "In", phone: "+971501234567", idNumber: "784-1990-1234567-1" });
    expect(s.verificationStatus).toBe("UNVERIFIED");
    await expectError(addStaff(granted, orgId, { employeeId: `WALK-${stamp}`, firstName: "Dup", lastName: "Id" }), "CONFLICT");
    await expectError(addStaff(aa, orgId, { employeeId: "", firstName: "", lastName: "" }), "VALIDATION");
    // An unverified profile cannot be allocated a bed.
    await expect(allocate({ staffId: s.id, bedId: beds[0], startDate: iso(1), actorId: aa.id })).rejects.toMatchObject({ code: "STAFF_UNVERIFIED" });
    await expectError(verifyStaff(officer, s.id), "FORBIDDEN");
    await verifyStaff(aa, s.id);
    expect((await prisma.staffProfile.findUniqueOrThrow({ where: { id: s.id } })).verificationStatus).toBe("VERIFIED");
    await expectError(verifyStaff(aa, s.id), "INVALID_STATE");
    const mine = await addStaff(aa, orgId, { employeeId: `ADM-${stamp}`, firstName: "Admin", lastName: "Added" });
    expect(mine.verificationStatus).toBe("VERIFIED"); // admins hold the verify right, so their additions are verified at once
    // Someone who added an unverified profile cannot verify it themselves.
    const byAdminLike = await prisma.staffProfile.create({ data: { organizationId: orgId, employeeId: `SELF-${stamp}`, firstName: "S", lastName: "V", verificationStatus: "UNVERIFIED" } });
    await prisma.auditEvent.create({ data: { actorId: aa.id, action: "STAFF_ADDED", entityType: "StaffProfile", entityId: byAdminLike.id } });
    await expectError(verifyStaff(aa, byAdminLike.id), "FORBIDDEN");
    await verifyStaff(sa, byAdminLike.id);
  });

  it("shows personal data at the level each role needs", async () => {
    const s = await mkStaff("PRIV", { phone: "+971 50 123 4567", idNumber: "784-1990-1234567-1", idType: "Emirates ID", department: "Ops", grade: "G4" });
    const full = await getPerson(aa, s.id);
    expect(full.view).toMatchObject({ phone: "+971 50 123 4567", idNumber: "784-1990-1234567-1", grade: "G4", masked: false });
    const desk = await getPerson(officer, s.id);
    expect(desk.level).toBe("DESK");
    expect(desk.view.phone).toBe(maskTail("+971 50 123 4567", 3));
    expect(desk.view.phone).not.toContain("123");
    expect(desk.view.idNumber).toMatch(/^•+.{3}$/);
    expect(desk.view.grade).toBeNull(); // department only
    expect(desk.view.department).toBe("Ops");
    const security: ActorLike = { id: "x", roles: ["SECURITY"] };
    expect(personLevel(security)).toBe("GATE");
    expect(viewPerson("GATE", s as never)).toMatchObject({ idNumber: null, idType: "Emirates ID", phone: null });
    expect(personLevel({ id: "y", roles: ["TECHNICIAN"] })).toBe("NONE");
    expect(personLevel({ id: "m", roles: ["READONLY_MANAGER"] })).toBe("NONE");
    expect(personLevel({ id: "m", roles: ["READONLY_MANAGER"], grants: [{ userId: "m", capability: "people.view" }] })).toBe("MANAGER"); // drill-down is name-level only
    expect(viewPerson("MANAGER", s as never)).toMatchObject({ phone: null, idNumber: null, department: null });
    await expectError(getPerson({ id: "t", roles: ["TECHNICIAN"] }, s.id), "FORBIDDEN");
    const listed = await listPeople(officer, { q: `PRIV-${stamp}` });
    expect(listed).toHaveLength(1);
    expect(listed[0].view?.idNumber).not.toBe("784-1990-1234567-1");
  });

  it("edits master data and entitlement, with audit", async () => {
    const s = await mkStaff("EDIT");
    await expectError(updateStaff(officer, s.id, { grade: "G1" }), "FORBIDDEN");
    await updateStaff(aa, s.id, { grade: "G3", department: "Finance", email: "x@example.com" });
    expect((await prisma.staffProfile.findUniqueOrThrow({ where: { id: s.id } })).grade).toBe("G3");
    await expectError(updateStaff(aa, s.id, { email: "not-an-email" }), "VALIDATION");
    await expectError(setEntitlement(officer, s.id, { roomTypes: ["DOUBLE"] }), "FORBIDDEN");
    await expectError(setEntitlement(aa, s.id, { maxDays: 0 }), "VALIDATION");
    await setEntitlement(aa, s.id, { eligibilityCategory: "SENIOR", roomTypes: ["DOUBLE", "SUITE"], maxDays: 90 });
    const row = await prisma.staffProfile.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.entitlement).toMatchObject({ roomTypes: ["DOUBLE", "SUITE"], maxDays: 90 });
    expect(await prisma.auditEvent.count({ where: { entityId: s.id, action: { in: ["STAFF_UPDATED", "STAFF_ENTITLEMENT_SET"] } } })).toBe(2);
  });
});

describe("eligibility", () => {
  it("checks grade, department, category, entitlement and fixed end dates", () => {
    const room = { type: "DOUBLE" };
    expect(checkEligibility({ grade: "G3" }, room, { grades: ["G3", "G4"] }, { startDate: "2030-01-01", endDate: null }).ok).toBe(true);
    expect(checkEligibility({ grade: "G1" }, room, { grades: ["G3"] }, { startDate: "2030-01-01", endDate: null }).reasons[0]).toMatch(/grade G3/);
    expect(checkEligibility({ department: "Ops" }, room, { departments: ["Finance"] }, { startDate: "2030-01-01", endDate: null }).ok).toBe(false);
    expect(checkEligibility({ eligibilityCategory: null }, room, { categories: ["SENIOR"] }, { startDate: "2030-01-01", endDate: null }).ok).toBe(false);
    expect(checkEligibility({ entitlement: { roomTypes: ["SINGLE"] } }, room, null, { startDate: "2030-01-01", endDate: null }).reasons[0]).toMatch(/entitlement covers SINGLE/);
    expect(checkEligibility({ entitlement: { maxDays: 30 } }, room, null, { startDate: "2030-01-01", endDate: "2030-03-01" }).reasons[0]).toMatch(/up to 30 days/);
    expect(checkEligibility({ profileEndDate: new Date("2030-02-01T00:00:00Z") }, room, null, { startDate: "2030-01-01", endDate: "2030-03-01" }).reasons[0]).toMatch(/cannot go past/);
    expect(checkEligibility({ profileEndDate: new Date("2030-02-01T00:00:00Z") }, room, null, { startDate: "2030-01-01", endDate: null }).ok).toBe(false);
    expect(checkEligibility({}, room, null, { startDate: "2030-01-01", endDate: null })).toEqual({ ok: true, reasons: [] });
  });

  it("refuses ineligible allocations; only an Admin with the override grant can proceed, with a flagged reason", async () => {
    await prisma.room.update({ where: { id: rooms[3] }, data: { eligibility: { grades: ["G9"] } } });
    const s = await mkStaff("ELIG", { grade: "G1" });
    const bed = beds[6];
    const e = await allocate({ staffId: s.id, bedId: bed, startDate: iso(1), actorId: aa.id, actor: aa }).catch((x) => x);
    expect(e).toBeInstanceOf(AllocationError);
    expect(e.code).toBe("NOT_ELIGIBLE");
    await expect(allocate({ staffId: s.id, bedId: bed, startDate: iso(1), actorId: aa.id, actor: aa, eligibilityOverrideReason: "Director's guest" })).rejects.toMatchObject({ code: "FORBIDDEN" }); // grantable, not granted
    const a = await allocate({ staffId: s.id, bedId: bed, startDate: iso(1), actorId: aaBulk.id, actor: aaBulk, eligibilityOverrideReason: "Director's guest" });
    expect(await prisma.auditEvent.count({ where: { action: "ELIGIBILITY_OVERRIDE", entityId: a.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { event: "override.flagged", payload: { path: ["allocationId"], equals: a.id } } })).toBeGreaterThan(0);
    await prisma.room.update({ where: { id: rooms[3] }, data: { eligibility: Prisma.DbNull } });
  });
});

describe("guests, dependents, duplicates, rehire", () => {
  it("guest and trainee profiles need a fixed end date, expire, and cannot stay past it", async () => {
    await expectError(addGuestProfile(officer, orgId, { firstName: "G", lastName: "One", profileType: "GUEST", profileEndDate: iso(5) }), "FORBIDDEN"); // grantable
    const og: ActorLike = { ...officer, grants: [{ userId: officer.id, capabilitySet: "EMERGENCY_CHECKIN" }] };
    const g = await addGuestProfile(og, orgId, { firstName: "Guest", lastName: "Visitor", profileType: "GUEST", profileEndDate: iso(5) });
    expect(g.employeeId).toMatch(/^GST-/);
    expect(g.verificationStatus).toBe("UNVERIFIED");
    await expectError(addStaff(aa, orgId, { employeeId: `GG-${stamp}`, firstName: "No", lastName: "End", profileType: "TRAINEE" }), "VALIDATION");
    await verifyStaff(aa, g.id);
    await expect(allocate({ staffId: g.id, bedId: beds[7], startDate: iso(1), endDate: iso(20), actorId: aa.id })).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    await allocate({ staffId: g.id, bedId: beds[7], startDate: iso(1), endDate: iso(4), actorId: aa.id });
    await prisma.staffProfile.update({ where: { id: g.id }, data: { profileEndDate: new Date(Date.now() - 2 * day) } });
    expect(await sweepExpiredProfiles()).toBe(0); // still holds a bed
    const past = await mkStaff("EXPIRED", { profileType: "TRAINEE", profileEndDate: new Date(Date.now() - 2 * day) });
    expect(await sweepExpiredProfiles()).toBeGreaterThanOrEqual(1);
    expect((await prisma.staffProfile.findUniqueOrThrow({ where: { id: past.id } })).archivedAt).not.toBeNull();
  });

  it("residents request dependents for themselves; admins verify", async () => {
    const s = await mkStaff("DEP");
    const resUser = await prisma.user.create({ data: { organizationId: orgId, username: `pp-res-${stamp}`, name: "Resident", status: "ACTIVE" } });
    const resident: ActorLike = { id: resUser.id, roles: ["STAFF"] };
    const d = await addDependent(resident, s.id, { name: "Child One", relationship: "Child" }, { ownStaffId: s.id });
    expect(d.status).toBe("PENDING");
    await expectError(addDependent(resident, s.id, { name: "Other", relationship: "Child" }, { ownStaffId: "someone-else" }), "FORBIDDEN");
    await expectError(decideDependent(officer, d.id, true), "FORBIDDEN");
    await decideDependent(aa, d.id, true);
    expect((await prisma.dependent.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("VERIFIED");
    await expectError(decideDependent(aa, d.id, false), "INVALID_STATE");
    const direct = await addDependent(aa, s.id, { name: "Spouse", relationship: "Spouse" });
    expect(direct.status).toBe("VERIFIED");
  });

  it("finds duplicates and merges everything onto the kept profile", async () => {
    const keep = await mkStaff("KEEP", { idNumber: `ID-${stamp}`, department: "A" });
    const dup = await mkStaff("DUP", { idNumber: `id-${stamp}`, phone: "+971 55 000 1111", grade: "G5" });
    const groups = await findDuplicates(orgId);
    expect(groups.some((g) => g.reason === "Same ID number" && g.people.map((p) => p.id).sort().join() === [keep.id, dup.id].sort().join())).toBe(true);
    await prisma.allocation.create({ data: { staffId: dup.id, bedId: beds[5], startDate: new Date(Date.now() - 30 * day), endDate: new Date(Date.now() - 10 * day), status: "CHECKED_OUT" } });
    await expectError(mergeStaff(officer, keep.id, dup.id), "FORBIDDEN");
    await expectError(mergeStaff(aa, keep.id, keep.id), "VALIDATION");
    const r = await mergeStaff(aa, keep.id, dup.id);
    expect(r.moved.allocations).toBe(1);
    const kept = await prisma.staffProfile.findUniqueOrThrow({ where: { id: keep.id } });
    expect(kept.phone).toBe("+971 55 000 1111");
    expect(kept.grade).toBe("G5");
    const gone = await prisma.staffProfile.findUniqueOrThrow({ where: { id: dup.id } });
    expect(gone.mergedIntoId).toBe(keep.id);
    expect(gone.archivedAt).not.toBeNull();
    expect(await prisma.allocation.count({ where: { staffId: keep.id } })).toBe(1);
    expect((await findDuplicates(orgId)).some((g) => g.people.some((p) => p.id === dup.id))).toBe(false);
  });

  it("rehires archived staff as unverified", async () => {
    const s = await mkStaff("REHIRE");
    await archiveRecord(sa, "STAFF", s.id, "Left");
    await expectError(rehireStaff(officer, s.id), "FORBIDDEN");
    const back = await rehireStaff(aa, s.id);
    expect(back.archivedAt).toBeNull();
    expect(back.verificationStatus).toBe("UNVERIFIED");
    await expectError(rehireStaff(aa, s.id), "INVALID_STATE");
  });

  it("derives the resident lifecycle state", () => {
    const today = iso();
    const base = { verificationStatus: "VERIFIED", archivedAt: null, allocations: [], waitlist: [], exits: [], joiners: [] };
    expect(stayStatus({ ...base, verificationStatus: "UNVERIFIED" }, today)).toBe("UNVERIFIED");
    expect(stayStatus(base, today)).toBe("ELIGIBLE");
    expect(stayStatus({ ...base, waitlist: [{ status: "WAITING" }] }, today)).toBe("WAITLISTED");
    expect(stayStatus({ ...base, joiners: [{ status: "EXPECTED" }] }, today)).toBe("REQUESTED");
    expect(stayStatus({ ...base, allocations: [{ status: "CONFIRMED", startDate: new Date(), endDate: null, provisional: false }] }, today)).toBe("RESERVED");
    const checkedIn = (end: string | null, provisional = false) => ({ ...base, allocations: [{ status: "CHECKED_IN", startDate: new Date(Date.now() - 20 * day), endDate: end ? new Date(`${end}T00:00:00Z`) : null, provisional }] });
    expect(stayStatus(checkedIn(null), today)).toBe("CHECKED_IN");
    expect(stayStatus(checkedIn(iso(2)), today)).toBe("CHECKOUT_DUE");
    expect(stayStatus(checkedIn(iso(-1)), today)).toBe("OVERSTAY");
    expect(stayStatus(checkedIn(null, true), today)).toBe("PROVISIONAL");
    expect(stayStatus({ ...base, allocations: [{ status: "CHECKED_OUT", startDate: new Date(), endDate: new Date(), provisional: false }] }, today)).toBe("CHECKED_OUT");
    expect(stayStatus({ ...base, archivedAt: new Date() }, today)).toBe("ARCHIVED");
  });
});

describe("joiners, exits and clearance", () => {
  it("raises a joiner with a reserved bed, then marks them arrived after check-in", async () => {
    await expectError(createJoiner(officer, { staffId: "x", expectedArrival: iso(3) }), "FORBIDDEN");
    const s = await mkStaff("JOIN");
    await expectError(createJoiner(aa, { staffId: s.id, expectedArrival: "soon" }), "VALIDATION");
    const j = await createJoiner(aa, { staffId: s.id, expectedArrival: iso(3), bedId: beds[1] });
    expect(j.status).toBe("ALLOCATED");
    await expectError(createJoiner(aa, { staffId: s.id, expectedArrival: iso(4) }), "CONFLICT");
    const alloc = await prisma.allocation.findUniqueOrThrow({ where: { id: j.allocationId! } });
    expect(alloc.status).toBe("CONFIRMED");
    await checkIn({ allocationId: alloc.id, actorId: officer.id, today: iso(3) });
    expect(await sweepJoiners()).toBeGreaterThanOrEqual(1);
    expect((await prisma.joiner.findUniqueOrThrow({ where: { id: j.id } })).status).toBe("ARRIVED");
  });

  it("an exit shortens the stay, tracks checkout due, blocks clearance until keys are back, then archives", async () => {
    const s = await mkStaff("EXIT");
    const a = await allocate({ staffId: s.id, bedId: beds[2], startDate: iso(-10), actorId: aa.id });
    await checkIn({ allocationId: a.id, actorId: officer.id, today: iso(-10) });
    const site = await prisma.site.findFirstOrThrow({ where: { id: siteId } });
    const key = await registerKey({ siteId: site.id, code: `EXK-${stamp}`, label: "Room key", roomId: rooms[1], actorId: aa.id });
    await issueKey({ keyId: key.id, actorId: officer.id, holderStaffId: s.id });
    await expectError(triggerExit(officer, { staffId: s.id, lastDay: iso(2) }), "FORBIDDEN");
    const ec = await triggerExit(aa, { staffId: s.id, lastDay: iso(2), reason: "Resigned" });
    await expectError(triggerExit(aa, { staffId: s.id, lastDay: iso(3) }), "CONFLICT");
    expect((await prisma.allocation.findUniqueOrThrow({ where: { id: a.id } })).endDate!.toISOString().slice(0, 10)).toBe(iso(2));
    expect((await sweepExits()).due).toBeGreaterThanOrEqual(1);
    expect((await prisma.exitCase.findUniqueOrThrow({ where: { id: ec.id } })).status).toBe("CHECKOUT_DUE");
    let c = await clearanceStatus(ec.id);
    expect(c.ready).toBe(false);
    expect(c.blockers.map((b) => b.type)).toContain("KEY");
    await expectError(closeClearance(aa, ec.id), "INVALID_STATE"); // still holds the bed
    await expect(checkOut({ allocationId: a.id, actorId: officer.id, today: iso(2) })).rejects.toMatchObject({ code: "CLEARANCE_BLOCKED" });
    const { returnKey } = await import("../src/modules/keys/service");
    await returnKey({ keyId: key.id, actorId: officer.id, condition: "Good" });
    await checkOut({ allocationId: a.id, actorId: officer.id, today: iso(2) });
    c = await clearanceStatus(ec.id);
    expect(c.ready).toBe(true);
    await expectError(closeClearance(officer, ec.id), "FORBIDDEN");
    await closeClearance(aa, ec.id, "All returned");
    const done = await prisma.staffProfile.findUniqueOrThrow({ where: { id: s.id } });
    expect(done.archivedAt).not.toBeNull();
    expect(done.employmentStatus).toBe("TERMINATED");
    await expectError(closeClearance(aa, ec.id), "INVALID_STATE");
    expect((await listExits({ status: "ALL" })).some((e) => e.id === ec.id)).toBe(true);
  });

  it("an exit before arrival cancels the reservation; exits can be cancelled with a reason", async () => {
    const s = await mkStaff("EXITF");
    const a = await allocate({ staffId: s.id, bedId: beds[3], startDate: iso(10), actorId: aa.id });
    const ec = await triggerExit(aa, { staffId: s.id, lastDay: iso(5) });
    expect((await prisma.allocation.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CANCELLED");
    await expectError(cancelExit(aa, ec.id, " "), "VALIDATION");
    await cancelExit(aa, ec.id, "Resignation withdrawn");
    expect((await prisma.exitCase.findUniqueOrThrow({ where: { id: ec.id } })).status).toBe("CANCELLED");
  });
});

describe("emergency check-in, extension, swap, bulk, waitlist, readiness", () => {
  it("emergency check-in is provisional until a different Admin approves; rejection makes a move task; overdue approvals are flagged", async () => {
    const s = await mkStaff("EMER", { verificationStatus: "UNVERIFIED" });
    await expect(emergencyCheckIn(officer, { staffId: s.id, bedId: beds[4], reason: "Flood" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(emergencyCheckIn(officerEmergency, { staffId: s.id, bedId: beds[4], reason: " " })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const a = await emergencyCheckIn(officerEmergency, { staffId: s.id, bedId: beds[4], reason: "Flood in dorm" });
    expect(a).toMatchObject({ status: "CHECKED_IN", provisional: true, stayType: "EMERGENCY" });
    expect(a.provisionalApproveBy!.getTime() - Date.now()).toBeGreaterThan(23 * 3600000);
    expect(await prisma.auditEvent.count({ where: { action: "EMERGENCY_CHECKIN", entityId: a.id } })).toBe(1);
    await expect(decideProvisional(officer, a.id, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(decideProvisional(aa, a.id, false, " ")).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await sweepProvisional()).toBe(0);
    await prisma.allocation.update({ where: { id: a.id }, data: { provisionalApproveBy: new Date(Date.now() - 3600000) } });
    expect(await sweepProvisional()).toBeGreaterThanOrEqual(1);
    await decideProvisional(aa, a.id, false, "Not an emergency");
    expect(await prisma.moveTask.count({ where: { allocationId: a.id, status: "OPEN" } })).toBe(1);
    await expect(decideProvisional(aa, a.id, true)).rejects.toMatchObject({ code: "INVALID_STATE" });

    const s2 = await mkStaff("EMER2");
    const a2 = await emergencyCheckIn(officerEmergency, { staffId: s2.id, bedId: beds[5], reason: "Fire alarm" });
    await decideProvisional(aa, a2.id, true);
    expect((await prisma.allocation.findUniqueOrThrow({ where: { id: a2.id } })).provisional).toBe(false);
    await checkOut({ allocationId: a2.id, actorId: officer.id });
  });

  it("extends within policy, refuses beyond it, and respects the bed's next booking", async () => {
    const s = await mkStaff("EXT");
    const a = await allocate({ staffId: s.id, bedId: beds[0], startDate: iso(-2), endDate: iso(10), actorId: aa.id });
    await checkIn({ allocationId: a.id, actorId: officer.id, today: iso(-2) });
    await expect(extendStay(officer, a.id, iso(12), "More time")).rejects.toMatchObject({ code: "FORBIDDEN" }); // officer needs the grant
    const ok = await extendStay(aa, a.id, iso(15), "Project overran");
    expect(ok.endDate!.toISOString().slice(0, 10)).toBe(iso(15));
    await expect(extendStay(aa, a.id, iso(10), "earlier")).rejects.toMatchObject({ code: "INVALID_DATES" });
    await expect(extendStay(aa, a.id, iso(60), "Too long")).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(extendStay(aa, a.id, iso(16), "")).rejects.toMatchObject({ code: "INVALID_STATE" });
    const next = await mkStaff("NEXT");
    await allocate({ staffId: next.id, bedId: beds[0], startDate: iso(15), actorId: aa.id });
    await expect(extendStay(aa, a.id, iso(18), "Blocked by next resident")).rejects.toMatchObject({ code: "BED_OCCUPIED" });
    // An Officer with the Emergency check-in set (which carries "Extend stay up to X days") may extend, within the same policy.
    const ofGrant: ActorLike = { ...officer, grants: [{ userId: officer.id, capabilitySet: "EMERGENCY_CHECKIN" }] };
    await prisma.allocation.deleteMany({ where: { staffId: next.id } });
    const done = await extendStay(ofGrant, a.id, iso(18), "Officer with grant");
    expect(done.endDate!.toISOString().slice(0, 10)).toBe(iso(18));
  }, 20000);

  it("swaps two residents' beds atomically and checks the destination rules", async () => {
    const swapRoom = await prisma.room.create({ data: { buildingId, code: `PB-SW-${stamp}`, type: "DOUBLE" } });
    rooms.push(swapRoom.id);
    const swapBedA = (await prisma.bed.create({ data: { roomId: swapRoom.id, code: `SW-A-${stamp}` } })).id;
    const swapBedB = (await prisma.bed.create({ data: { roomId: swapRoom.id, code: `SW-B-${stamp}` } })).id;
    const [x, y] = await Promise.all([mkStaff("SWAPX"), mkStaff("SWAPY")]);
    const ax = await allocate({ staffId: x.id, bedId: swapBedA, startDate: iso(40), actorId: aa.id });
    const ay = await allocate({ staffId: y.id, bedId: swapBedB, startDate: iso(40), actorId: aa.id });
    await expect(swapBeds({ id: "t", roles: ["TECHNICIAN"] }, ax.id, ay.id, "x")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(swapBeds(officer, ax.id, ay.id, " ")).rejects.toMatchObject({ code: "INVALID_STATE" });
    const r = await swapBeds(officer, ax.id, ay.id, "Colleagues prefer it");
    expect(r.a.bed).toBe(`SW-B-${stamp}`);
    expect((await prisma.allocation.findUniqueOrThrow({ where: { id: ax.id } })).bedId).toBe(swapBedB);
    expect((await prisma.allocation.findUniqueOrThrow({ where: { id: ay.id } })).bedId).toBe(swapBedA);
    expect(await prisma.auditEvent.count({ where: { action: "BED_SWAP", entityId: ax.id } })).toBe(1);
    await prisma.room.update({ where: { id: swapRoom.id }, data: { genderPolicy: "FEMALE" } });
    await prisma.staffProfile.update({ where: { id: y.id }, data: { gender: "MALE" } });
    await expect(swapBeds(officer, ax.id, ay.id, "again")).rejects.toMatchObject({ code: "GENDER_POLICY" });
    await prisma.room.update({ where: { id: swapRoom.id }, data: { genderPolicy: "ANY" } });
  });

  it("bulk allocation needs the grant and reports each placement", async () => {
    const bulkRoom = await prisma.room.create({ data: { buildingId, code: `PB-BK-${stamp}`, type: "DOUBLE" } });
    for (const n of [1, 2, 3, 4]) await prisma.bed.create({ data: { roomId: bulkRoom.id, code: `BK-${n}-${stamp}` } });
    const people = await Promise.all(["B1", "B2", "B3"].map((n) => mkStaff(n)));
    await expect(bulkAllocate(aa, { staffIds: people.map((p) => p.id), startDate: iso(60), siteId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ghost = "missing-staff";
    const r = await bulkAllocate(aaBulk, { staffIds: [...people.map((p) => p.id), ghost], startDate: iso(60), endDate: iso(90), siteId, buildingId });
    expect(r.placed).toBe(3);
    expect(r.results.find((x) => x.staffId === ghost)).toMatchObject({ ok: false });
    expect(new Set(r.results.filter((x) => x.ok).map((x) => x.bed)).size).toBe(3);
    expect(await prisma.auditEvent.count({ where: { action: "BULK_ALLOCATION", entityId: siteId } })).toBe(1);
  });

  it("keeps a waitlist and allocates from it", async () => {
    const s = await mkStaff("WAIT");
    await expect(addToWaitlist(officer, { staffId: s.id, neededFrom: iso(5) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const e = await addToWaitlist(aa, { staffId: s.id, siteId, neededFrom: iso(100), priority: 2 });
    await expect(addToWaitlist(aa, { staffId: s.id, neededFrom: iso(100) })).rejects.toMatchObject({ code: "STAFF_ALREADY_ALLOCATED" });
    expect((await listWaitlist()).some((w) => w.id === e.id)).toBe(true);
    const suggestions = await suggestForWaitlist(e.id);
    expect(suggestions.length).toBeGreaterThan(0);
    const a = await allocateFromWaitlist(aa, e.id, suggestions[0].bedId);
    expect(a.status).toBe("CONFIRMED");
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("ALLOCATED");
    await expect(allocateFromWaitlist(aa, e.id, suggestions[0].bedId)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("check-out flags the bed for cleaning and opens a task; a bed that needs cleaning is not handed over until ready", async () => {
    const s = await mkStaff("CLEAN");
    const bed = (await prisma.bed.create({ data: { roomId: rooms[0], code: `CL-${stamp}` } })).id;
    const a = await allocate({ staffId: s.id, bedId: bed, startDate: iso(-1), actorId: aa.id });
    await checkIn({ allocationId: a.id, actorId: officer.id, today: iso(-1) });
    await checkOut({ allocationId: a.id, actorId: officer.id, today: iso(0) });
    expect((await prisma.bed.findUniqueOrThrow({ where: { id: bed } })).readiness).toBe("NEEDS_CLEANING");
    expect(await prisma.cleaningTask.count({ where: { bedId: bed, status: "OPEN", reason: "CHECKOUT" } })).toBe(1);
    const s2 = await mkStaff("CLEAN2");
    const a2 = await allocate({ staffId: s2.id, bedId: bed, startDate: iso(1), actorId: aa.id });
    await expect(checkIn({ allocationId: a2.id, actorId: officer.id, today: iso(1) })).rejects.toMatchObject({ code: "NOT_READY" });
    await expect(setReadiness({ id: "t", roles: ["TECHNICIAN"] }, { bedId: bed }, "READY")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await setReadiness(officer, { bedId: bed }, "READY");
    expect(await prisma.cleaningTask.count({ where: { bedId: bed, status: "OPEN" } })).toBe(0);
    await checkIn({ allocationId: a2.id, actorId: officer.id, today: iso(1) });
  });
});
