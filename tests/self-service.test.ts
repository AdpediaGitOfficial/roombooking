import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSessionRecord, resolveSession } from "@/lib/auth/session-store";
import { allocate, checkIn, transfer } from "@/modules/allocations/service";
import { changeOwnPassword, describeNotification, getMyStay, markNotificationRead, SelfServiceError, updateOwnProfile, validateOwnProfile } from "@/modules/self-service/service";

const NOW = new Date("2026-10-12T09:00:00.000Z");
const TODAY = "2026-10-12";
const plus = (n: number) => new Date(Date.UTC(2026, 9, 12 + n)).toISOString().slice(0, 10);

let staffId: string;
let userId: string;
let actorId: string;
let bedA: string;
let bedB: string;

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  const actor = await prisma.user.upsert({ where: { email: "alloc-test@example.com" }, update: {}, create: { organizationId: org.id, email: "alloc-test@example.com", name: "Alloc Tester", status: "ACTIVE" } });
  actorId = actor.id;
  const user = await prisma.user.upsert({
    where: { email: "selfservice@example.com" },
    update: { status: "ACTIVE", passwordHash: await hashPassword("Original-Pass-1") },
    create: { organizationId: org.id, email: "selfservice@example.com", name: "Self Service", status: "ACTIVE", passwordHash: await hashPassword("Original-Pass-1") },
  });
  userId = user.id;
  const staff = await prisma.staffProfile.upsert({
    where: { organizationId_employeeId: { organizationId: org.id, employeeId: "SS-1" } },
    update: { userId, phone: null, emergencyContactName: null, emergencyContactPhone: null },
    create: { organizationId: org.id, employeeId: "SS-1", firstName: "Self", lastName: "Service", userId },
  });
  staffId = staff.id;

  const site = await prisma.site.upsert({ where: { organizationId_code: { organizationId: org.id, code: "SST" } }, update: {}, create: { organizationId: org.id, code: "SST", name: "Self-Service Site", timezone: "UTC", contactPhone: "+971 4 000 0000" } });
  const building = await prisma.building.upsert({ where: { siteId_code: { siteId: site.id, code: "SST-B" } }, update: {}, create: { siteId: site.id, code: "SST-B", name: "Self Block" } });
  const room = await prisma.room.upsert({ where: { buildingId_code: { buildingId: building.id, code: "SST-R1" } }, update: {}, create: { buildingId: building.id, code: "SST-R1", type: "SHARED" } });
  bedA = (await prisma.bed.upsert({ where: { roomId_code: { roomId: room.id, code: "SST-R1-1" } }, update: {}, create: { roomId: room.id, code: "SST-R1-1" } })).id;
  bedB = (await prisma.bed.upsert({ where: { roomId_code: { roomId: room.id, code: "SST-R1-2" } }, update: {}, create: { roomId: room.id, code: "SST-R1-2" } })).id;

  await prisma.allocation.deleteMany({ where: { staffId } });
  await prisma.notification.deleteMany({ where: { recipientId: userId } });
  await prisma.session.deleteMany({ where: { userId } });
});

afterAll(async () => {
  await prisma.allocation.deleteMany({ where: { staffId } });
  await prisma.notification.deleteMany({ where: { recipientId: userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.$disconnect();
});

describe("getMyStay", () => {
  it("reports no stay and no actions for an unallocated resident", async () => {
    const stay = await getMyStay(staffId, NOW);
    expect(stay.current).toBeNull();
    expect(stay.upcoming).toBeNull();
    expect(stay.pendingActions).toEqual([]);
  });

  it("shows an upcoming arrival as a pending action before the stay starts", async () => {
    await allocate({ staffId, bedId: bedA, startDate: plus(3), endDate: plus(40), actorId });
    const stay = await getMyStay(staffId, NOW);
    expect(stay.current).toBeNull();
    expect(stay.upcoming?.bed.code).toBe("SST-R1-1");
    expect(stay.pendingActions.map((a) => a.kind)).toEqual(["ARRIVAL"]);
    expect(stay.pendingActions[0].text).toContain("3 days");
  });

  it("shows the current bed, room sharing and a departure reminder near the end date", async () => {
    const a = await prisma.allocation.findFirstOrThrow({ where: { staffId, status: "CONFIRMED" } });
    await checkIn({ allocationId: a.id, actorId, today: plus(3) });
    const stay = await getMyStay(staffId, new Date("2026-10-15T09:00:00.000Z"));
    expect(stay.current?.status).toBe("CHECKED_IN");
    expect(stay.roomSharing).toEqual({ capacity: 2, occupied: 1 });
    expect(stay.pendingActions).toEqual([]); // 37 days left: no reminder yet

    const nearEnd = await getMyStay(staffId, new Date(`${plus(35)}T09:00:00.000Z`));
    expect(nearEnd.pendingActions.map((x) => x.kind)).toEqual(["DEPARTURE"]);
    expect(nearEnd.pendingActions[0].text).toContain("5 days");
  });

  it("shows a booked transfer as the next bed with a move action", async () => {
    const a = await prisma.allocation.findFirstOrThrow({ where: { staffId, status: "CHECKED_IN" } });
    await transfer({ allocationId: a.id, toBedId: bedB, effectiveDate: plus(10), reason: "Test", actorId, today: plus(5) });
    const stay = await getMyStay(staffId, new Date(`${plus(5)}T09:00:00.000Z`));
    expect(stay.current?.bed.code).toBe("SST-R1-1");
    expect(stay.upcoming?.bed.code).toBe("SST-R1-2");
    expect(stay.pendingActions.map((x) => x.kind)).toEqual(["MOVE"]);
    expect(stay.history).toHaveLength(0);
  });
});

describe("profile", () => {
  it("validates phone numbers and emergency contact pairs", () => {
    expect(validateOwnProfile({ phone: "abc", emergencyContactName: "", emergencyContactPhone: "" })).toContain("phone");
    expect(validateOwnProfile({ phone: "", emergencyContactName: "", emergencyContactPhone: "+971500000000" })).toContain("name");
    expect(validateOwnProfile({ phone: "+971 50 123 4567", emergencyContactName: "A. Person", emergencyContactPhone: "050-123-4567" })).toBeNull();
  });

  it("updates only the self-editable fields and audits the change", async () => {
    const updated = await updateOwnProfile(staffId, userId, { phone: " +971 50 123 4567 ", emergencyContactName: "A. Person", emergencyContactPhone: "050-123-4567" });
    expect(updated.phone).toBe("+971 50 123 4567");
    expect(updated.employeeId).toBe("SS-1");
    await expect(updateOwnProfile(staffId, userId, { phone: "nope", emergencyContactName: "", emergencyContactPhone: "" })).rejects.toBeInstanceOf(SelfServiceError);
    const audit = await prisma.auditEvent.findFirst({ where: { entityType: "StaffProfile", entityId: staffId, action: "PROFILE_SELF_UPDATED" }, orderBy: { createdAt: "desc" } });
    expect((audit?.after as { phone: string }).phone).toBe("+971 50 123 4567");
  });
});

describe("password change", () => {
  it("requires the current password, enforces the policy and signs out other sessions", async () => {
    const keep = await createSessionRecord(userId);
    const other = await createSessionRecord(userId);

    await expect(changeOwnPassword({ userId, currentPassword: "wrong", newPassword: "Brand-New-Pass-2" })).rejects.toThrow("current password");
    await expect(changeOwnPassword({ userId, currentPassword: "Original-Pass-1", newPassword: "short" })).rejects.toThrow("at least");
    await expect(changeOwnPassword({ userId, currentPassword: "Original-Pass-1", newPassword: "Original-Pass-1" })).rejects.toThrow("not used before");

    const result = await changeOwnPassword({ userId, currentPassword: "Original-Pass-1", newPassword: "Brand-New-Pass-2", keepSessionToken: keep.token });
    expect(result.otherSessionsRevoked).toBe(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await verifyPassword("Brand-New-Pass-2", user.passwordHash)).toBe(true);
    expect(user.passwordChangedAt).not.toBeNull();
    expect(await resolveSession(keep.token)).not.toBeNull();
    expect(await resolveSession(other.token)).toBeNull();
  });
});

describe("notifications", () => {
  it("marks only the recipient's own notification as read and renders readable text", async () => {
    const n = await prisma.notification.create({
      data: { recipientId: userId, channel: "IN_APP", event: "allocation.confirmed", template: "allocation.confirmed", idempotencyKey: `test:${Date.now()}`, payload: { bed: "SST-R1-1", building: "Self Block", room: "SST-R1", startDate: TODAY, endDate: null } },
    });
    expect(await markNotificationRead(actorId, n.id)).toBe(0); // someone else cannot mark it
    expect(await markNotificationRead(userId, n.id)).toBe(1);
    expect(await markNotificationRead(userId, n.id)).toBe(0); // already read
    const text = describeNotification(n.event, n.payload);
    expect(text.title).toBe("Accommodation confirmed");
    expect(text.body).toContain("SST-R1-1");
  });
});
