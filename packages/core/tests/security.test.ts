import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "../src/lib/db";
import type { ActorLike } from "../src/lib/permissions/actor";
import { SecurityError } from "../src/modules/security/errors";
import {
  acknowledgeSos, addRestricted, checkInContractor, checkInVisitor, checkOutContractor, checkOutVisitor, collectParcel, completeRound, confirmWalkIn, contractorsInsideAlert, decideVisitor,
  getIncident, listIncidents, logParcel, peopleInside, preRegister, raiseSos, registerWalkIn, removeRestricted, reportIncident, resolveSos, savePolicy, scanCheckpoint, startRound, sweepVisitors,
  updateIncident, verifyResident, visitorPolicy,
} from "../src/modules/security/service";
import { addWorker, createVendor, scheduleVisit, verifyWorker } from "../src/modules/maintenance/extras";
import { assignWorkOrder, createWorkOrder } from "../src/modules/maintenance/service";

const stamp = Date.now().toString(36);
let orgId: string, siteId: string, bedId: string, hostId: string, hostUserId: string;
const A: Record<string, ActorLike> = {};

async function mk(key: string, roles: Role[], sets: string[] = []) {
  const u = await prisma.user.create({ data: { organizationId: orgId, email: `sec-${key}-${stamp}@example.com`, name: key, status: "ACTIVE", username: `sec_${key}_${stamp}` } });
  for (const role of roles) await prisma.roleAssignment.create({ data: { userId: u.id, role } });
  A[key] = { id: u.id, roles, grants: sets.map((capabilitySet) => ({ capabilitySet, userId: u.id })) };
  return u;
}
async function expectCode<T>(p: Promise<T>, code?: string) {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(SecurityError); if (code) expect((e as SecurityError).code).toBe(code); return e as SecurityError; }
  throw new Error("expected SecurityError");
}
const inHours = (h: number) => new Date(Date.now() + h * 3600000).toISOString();

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  orgId = org.id;
  const site = await prisma.site.upsert({ where: { organizationId_code: { organizationId: orgId, code: "SECX" } }, update: {}, create: { organizationId: orgId, code: "SECX", name: "Security Site", timezone: "UTC" } });
  siteId = site.id;
  const b = await prisma.building.upsert({ where: { siteId_code: { siteId, code: "SECX-B" } }, update: {}, create: { siteId, code: "SECX-B", name: "Sec Block" } });
  const room = await prisma.room.upsert({ where: { buildingId_code: { buildingId: b.id, code: `SX-${stamp}` } }, update: {}, create: { buildingId: b.id, code: `SX-${stamp}` } });
  bedId = (await prisma.bed.upsert({ where: { roomId_code: { roomId: room.id, code: `SX-${stamp}-1` } }, update: {}, create: { roomId: room.id, code: `SX-${stamp}-1` } })).id;
  await mk("admin", ["ACCOMMODATION_ADMIN"]);
  await mk("admin2", ["ACCOMMODATION_ADMIN"]);
  await mk("super", ["SYSTEM_ADMIN"]);
  await mk("officer", ["ACCOMMODATION_OFFICER"]);
  await mk("guard", ["SECURITY"], ["VISITOR_APPROVAL"]);
  await mk("guard2", ["SECURITY"]);
  await mk("coord", ["MAINTENANCE_COORDINATOR"]);
  const host = await mk("host", ["STAFF"], ["VISITOR_APPROVAL"]);
  hostUserId = host.id;
  const staff = await prisma.staffProfile.create({ data: { organizationId: orgId, employeeId: `SEC-${stamp}`, firstName: "Host", lastName: "Resident", userId: host.id, verificationStatus: "VERIFIED", phone: "0501112222", idNumber: "784-9999-123" } });
  hostId = staff.id;
  // Host holds a checked-in bed here.
  await prisma.allocation.create({ data: { staffId: staff.id, bedId, startDate: new Date("2026-01-01"), status: "CHECKED_IN", checkedInAt: new Date() } });
});

afterAll(async () => { await prisma.$disconnect(); });

describe("visitors", () => {
  it("approves day visitors automatically and holds overnight visitors for an Admin who is not the registrar", async () => {
    const day = await preRegister(A.host, { siteId, kind: "DAY", name: "Day Guest", hostStaffId: hostId, expectedAt: inHours(1) });
    expect(day.status).toBe("APPROVED");
    expect(day.passCode).toMatch(/^\d{6}$/);
    const night = await preRegister(A.host, { siteId, kind: "OVERNIGHT", name: "Night Guest", hostStaffId: hostId, expectedAt: inHours(2), nights: 2 });
    expect(night.status).toBe("PENDING_APPROVAL");
    await expectCode(checkInVisitor(A.guard, night.id), "DENIED");
    await expectCode(decideVisitor(A.guard2, night.id, true), "FORBIDDEN"); // no approve right without the grant
    const done = await decideVisitor(A.admin, night.id, true);
    expect(done.status).toBe("APPROVED");
  });

  it("enforces the visitor policy limits and the per-host cap", async () => {
    await savePolicy(A.admin, orgId, siteId, { maxNights: 2, maxActivePerHost: 5, overnightAllowed: true });
    await expectCode(preRegister(A.host, { siteId, kind: "OVERNIGHT", name: "Long Stay", hostStaffId: hostId, expectedAt: inHours(2), nights: 9 }), "VALIDATION");
    await savePolicy(A.admin, orgId, siteId, { overnightAllowed: false });
    await expectCode(preRegister(A.host, { siteId, kind: "OVERNIGHT", name: "No Night", hostStaffId: hostId, expectedAt: inHours(2), nights: 1 }), "DENIED");
    await savePolicy(A.admin, orgId, siteId, { overnightAllowed: true, maxActivePerHost: 3 });
    expect((await visitorPolicy(siteId)).maxActivePerHost).toBe(3);
    await expectCode(savePolicy(A.officer, orgId, siteId, { maxNights: 1 }), "FORBIDDEN");
  });

  it("checks a visitor in and out, flags overstays and blocks anyone on the restricted list", async () => {
    await prisma.visitor.deleteMany({ where: { hostStaffId: hostId } });
    const v = await preRegister(A.host, { siteId, kind: "DAY", name: "Gate Guest", hostStaffId: hostId, expectedAt: inHours(0), idNumber: "ID-GATE-1" });
    await expectCode(checkInVisitor(A.guard, v.id, { passCode: "000000" }), "DENIED");
    await checkInVisitor(A.guard, v.id, { passCode: v.passCode });
    expect((await peopleInside([siteId])).visitors.some((x) => x.id === v.id)).toBe(true);
    await prisma.visitor.update({ where: { id: v.id }, data: { expectedOutAt: new Date(Date.now() - 3600000) } });
    expect((await peopleInside([siteId])).visitors.find((x) => x.id === v.id)?.overstay).toBe(true);
    await checkOutVisitor(A.guard, v.id);

    await addRestricted(A.admin, { siteId, name: "Banned Person", idNumber: "BAN-1", reason: "Theft" });
    await expectCode(preRegister(A.host, { siteId, kind: "DAY", name: "Someone", idNumber: "ban-1", hostStaffId: hostId, expectedAt: inHours(1) }), "DENIED");
    await expectCode(registerWalkIn(A.guard, { siteId, name: "Banned Person", idNumber: "BAN-1", hostStaffId: hostId }), "DENIED");
  });

  it("holds a walk-in until the host confirms", async () => {
    await prisma.visitor.deleteMany({ where: { hostStaffId: hostId } });
    const w = await registerWalkIn(A.guard, { siteId, name: "Walk In", idNumber: "W-1", hostStaffId: hostId });
    expect(w.status).toBe("WALK_IN_PENDING");
    await expectCode(checkInVisitor(A.guard, w.id), "DENIED");
    await expectCode(confirmWalkIn(A.officer, w.id, true), "FORBIDDEN");
    await confirmWalkIn(A.host, w.id, true);
    await checkInVisitor(A.guard, w.id);
  });

  it("expires visitors that never arrived", async () => {
    await prisma.visitor.deleteMany({ where: { hostStaffId: hostId } });
    const v = await preRegister(A.host, { siteId, kind: "DAY", name: "No Show", hostStaffId: hostId, expectedAt: inHours(0) });
    await prisma.visitor.update({ where: { id: v.id }, data: { expectedOutAt: new Date(Date.now() - 1000) } });
    const r = await sweepVisitors();
    expect(r.expired).toBeGreaterThanOrEqual(1);
    expect((await prisma.visitor.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("CANCELLED");
  });
});

describe("restricted list removal needs a second admin", () => {
  it("needs one Admin to request and a different Admin or the Super Admin to approve", async () => {
    const e = await addRestricted(A.admin, { siteId, name: "Remove Me", reason: "Dispute" });
    expect(await removeRestricted(A.admin, e.id, "Resolved")).toBe("requested");
    await expectCode(removeRestricted(A.admin, e.id, "again"), "INVALID_STATE");
    await expectCode(removeRestricted(A.officer, e.id, "x"), "FORBIDDEN");
    expect(await removeRestricted(A.admin2, e.id, "Confirmed")).toBe("removed");
    const e2 = await addRestricted(A.admin, { siteId, name: "Remove Me Too", reason: "Dispute" });
    expect(await removeRestricted(A.admin, e2.id, "Resolved")).toBe("requested");
    expect(await removeRestricted(A.super, e2.id, "Super admin approves")).toBe("removed");
  });
});

describe("contractor access at the gate", () => {
  it("admits verified workers of an active vendor and stops entry once the vendor is suspended", async () => {
    const vendor = await createVendor(A.admin, orgId, { name: `Gate Co ${stamp}`, contractEnd: "2099-01-01" });
    const worker = await addWorker(A.admin, vendor.id, { name: "Gate Worker", idNumber: "GW-1" });
    await verifyWorker(A.admin, worker.id, true);
    const wo = await createWorkOrder({ requesterId: A.host.id, siteId, category: "Plumbing", description: "Pipe burst in the corridor", priority: "HIGH", locationNote: "Corridor" });
    await prisma.workOrder.update({ where: { id: wo.id }, data: { vendorId: vendor.id, status: "ASSIGNED" } });
    const visit = await scheduleVisit(A.coord, { workOrderId: wo.id, vendorId: vendor.id, workerIds: [worker.id], start: inHours(0.2), end: inHours(2) });
    await expectCode(checkInContractor(A.officer, visit.id), "FORBIDDEN"); // officers need the grant
    const inside = await checkInContractor(A.guard, visit.id);
    expect(inside.status).toBe("CHECKED_IN");
    expect((await peopleInside([siteId])).contractors.filter((c) => c.vendor === vendor.name)).toHaveLength(1);
    expect(await contractorsInsideAlert(vendor.id)).toBe(1);
    const out = await checkOutContractor(A.guard, visit.id);
    expect(out.visit.status).toBe("CHECKED_OUT");

    const visit2 = await scheduleVisit(A.coord, { workOrderId: wo.id, vendorId: vendor.id, workerIds: [worker.id], start: inHours(0.1), end: inHours(3) });
    await prisma.vendor.update({ where: { id: vendor.id }, data: { state: "SUSPENDED" } });
    await expectCode(checkInContractor(A.guard, visit2.id), "DENIED");
    expect((await prisma.contractorVisit.findUniqueOrThrow({ where: { id: visit2.id } })).status).toBe("DENIED");
  });
});

describe("resident verification and privacy", () => {
  it("shows Security the name and stay status but not contact or ID details", async () => {
    const [r] = await verifyResident(A.guard, `SEC-${stamp}`);
    expect(r.name).toBe("Host Resident");
    expect(r.inside).toBe(true);
    expect(r.stay).toBe("CHECKED_IN");
    expect(JSON.stringify(r)).not.toContain("0501112222");
    expect(JSON.stringify(r)).not.toContain("784-9999");
    expect(r.room).toBeNull();
    const [d] = await verifyResident(A.officer, `SEC-${stamp}`);
    expect(d.room).toContain("SX-");
  });
});

describe("incidents, parcels, SOS and patrols", () => {
  it("lets the reporter add notes but only another Admin close an incident", async () => {
    const inc = await reportIncident(A.guard, { siteId, category: "Disturbance", severity: "MEDIUM", description: "Loud argument in the corridor" });
    await expectCode(updateIncident(A.guard, inc.id, { status: "CLOSED", note: "done" }), "FORBIDDEN");
    await updateIncident(A.guard, inc.id, { status: "ACTION_TAKEN", note: "Spoke to both", actionTaken: "Warning given" });
    await updateIncident(A.admin, inc.id, { status: "CLOSED", note: "Satisfied" });
    expect((await getIncident(A.admin, inc.id)).updates).toHaveLength(3);
    await expectCode(getIncident(A.officer, inc.id), "FORBIDDEN");
    expect((await listIncidents(A.guard, {})).every((i) => i.reportedById === A.guard.id)).toBe(true);
  });

  it("logs and hands over parcels, notifying the resident", async () => {
    const p = await logParcel(A.guard, { siteId, staffId: hostId, carrier: "DHL", reference: "AWB1" });
    expect(p.status).toBe("NOTIFIED");
    expect(await prisma.notification.count({ where: { recipientId: hostUserId, event: "parcel.arrived" } })).toBeGreaterThan(0);
    await expectCode(collectParcel(A.coord, p.id), "FORBIDDEN");
    expect((await collectParcel(A.guard, p.id, "Host Resident")).status).toBe("COLLECTED");
  });

  it("raises an SOS once, alerts responders and records the response", async () => {
    const a = await raiseSos(A.host, { siteId, location: "Room SX" });
    const again = await raiseSos(A.host, { siteId });
    expect(again.id).toBe(a.id);
    expect(await prisma.notification.count({ where: { event: "sos.raised", idempotencyKey: { startsWith: `sos:${a.id}:` } } })).toBeGreaterThan(0);
    await expectCode(acknowledgeSos(A.host, a.id), "FORBIDDEN");
    await acknowledgeSos(A.guard, a.id);
    await resolveSos(A.guard, a.id, "Medical help arrived");
    expect((await prisma.sosAlert.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("RESOLVED");
  });

  it("tracks a patrol round against configured checkpoints and reports misses", async () => {
    const patrolSite = await prisma.site.create({ data: { organizationId: orgId, code: `PT${stamp}`.slice(0, 12), name: "Patrol Site", timezone: "UTC" } });
    for (const code of ["GATE", "POOL"]) await prisma.masterItem.create({ data: { organizationId: orgId, siteId: patrolSite.id, kind: "PATROL_CHECKPOINT", code: `${code}-${stamp}`, name: code } });
    await expectCode(startRound(A.guard2, patrolSite.id), "FORBIDDEN");
    const round = await startRound(A.guard, patrolSite.id);
    await scanCheckpoint(A.guard, round.id, `GATE-${stamp}`);
    await expectCode(scanCheckpoint(A.guard, round.id, "NOPE"), "VALIDATION");
    const done = await completeRound(A.guard, round.id);
    expect(done.missed).toEqual([`POOL-${stamp}`]);
  });
});
