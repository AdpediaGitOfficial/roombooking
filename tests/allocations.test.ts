// Integration tests for the allocation engine against DATABASE_URL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AllocationError } from "@/modules/allocations/errors";
import { allocate, cancel, checkIn, checkOut, findAvailableBeds, transfer } from "@/modules/allocations/service";

const TODAY = "2026-10-12";
const plus = (n: number) => new Date(Date.UTC(2026, 9, 12 + n)).toISOString().slice(0, 10);

const ids: Record<string, string> = {};
let actorId: string;

async function expectError<T>(p: Promise<T>, code: string) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AllocationError);
    expect((e as AllocationError).code).toBe(code);
    return e as AllocationError;
  }
  throw new Error(`expected AllocationError ${code}`);
}

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  const actor = await prisma.user.upsert({
    where: { email: "alloc-test@example.com" },
    update: { status: "ACTIVE" },
    create: { organizationId: org.id, email: "alloc-test@example.com", name: "Alloc Tester", status: "ACTIVE" },
  });
  actorId = actor.id;
  const site = await prisma.site.upsert({
    where: { organizationId_code: { organizationId: org.id, code: "ALT" } },
    update: {},
    create: { organizationId: org.id, code: "ALT", name: "Allocation Test Site", timezone: "UTC" },
  });
  const building = await prisma.building.upsert({
    where: { siteId_code: { siteId: site.id, code: "ALT-B" } },
    update: { status: "ACTIVE" },
    create: { siteId: site.id, code: "ALT-B", name: "Test Block" },
  });
  const room = async (code: string, extra: { genderPolicy?: "ANY" | "MALE" | "FEMALE"; status?: "ACTIVE" | "BLOCKED" } = {}) =>
    prisma.room.upsert({
      where: { buildingId_code: { buildingId: building.id, code } },
      update: { genderPolicy: extra.genderPolicy ?? "ANY", status: extra.status ?? "ACTIVE" },
      create: { buildingId: building.id, code, genderPolicy: extra.genderPolicy ?? "ANY", status: extra.status ?? "ACTIVE" },
    });
  const bed = async (roomId: string, code: string, status: "ACTIVE" | "BLOCKED" = "ACTIVE") =>
    prisma.bed.upsert({ where: { roomId_code: { roomId, code } }, update: { status }, create: { roomId, code, status } });

  const r1 = await room("ALT-R1");
  const r2 = await room("ALT-R2", { genderPolicy: "FEMALE" });
  const r3 = await room("ALT-R3", { status: "BLOCKED" });
  ids.r1b1 = (await bed(r1.id, "ALT-R1-1")).id;
  ids.r1b2 = (await bed(r1.id, "ALT-R1-2")).id;
  ids.r1b3 = (await bed(r1.id, "ALT-R1-3", "BLOCKED")).id;
  ids.r2b1 = (await bed(r2.id, "ALT-R2-1")).id;
  ids.r3b1 = (await bed(r3.id, "ALT-R3-1")).id;
  ids.building = building.id;
  ids.site = site.id;

  const staff = async (employeeId: string, gender: "ANY" | "MALE" | "FEMALE", employmentStatus: "ACTIVE" | "TERMINATED" = "ACTIVE") =>
    prisma.staffProfile.upsert({
      where: { organizationId_employeeId: { organizationId: org.id, employeeId } },
      update: { gender, employmentStatus },
      create: { organizationId: org.id, employeeId, firstName: "Test", lastName: employeeId, gender, employmentStatus },
    });
  ids.s1 = (await staff("ALT-S1", "MALE")).id;
  ids.s2 = (await staff("ALT-S2", "ANY")).id;
  ids.s3 = (await staff("ALT-S3", "ANY", "TERMINATED")).id;
  ids.s4 = (await staff("ALT-S4", "ANY")).id;

  const key = await prisma.key.upsert({
    where: { siteId_code: { siteId: site.id, code: "ALT-K1" } },
    update: {},
    create: { siteId: site.id, code: "ALT-K1", label: "Test key" },
  });
  ids.key = key.id;
  // Key transaction rows can never be deleted (trigger), so close any open issue left by an earlier run.
  await prisma.keyTransaction.updateMany({ where: { keyId: key.id, returnedAt: null }, data: { returnedAt: new Date() } });

  await prisma.allocation.deleteMany({ where: { staffId: { in: [ids.s1, ids.s2, ids.s3, ids.s4] } } });
});

afterAll(async () => {
  await prisma.allocation.deleteMany({ where: { staffId: { in: [ids.s1, ids.s2, ids.s3, ids.s4] } } });
  await prisma.$disconnect();
});

describe("findAvailableBeds", () => {
  it("excludes blocked beds, beds in blocked rooms and rooms with a conflicting gender policy", async () => {
    const forMale = await findAvailableBeds({ startDate: TODAY, buildingId: ids.building, gender: "MALE" });
    expect(forMale.map((b) => b.code).sort()).toEqual(["ALT-R1-1", "ALT-R1-2"]);
    const forAny = await findAvailableBeds({ startDate: TODAY, buildingId: ids.building, gender: "ANY" });
    expect(forAny.map((b) => b.code).sort()).toEqual(["ALT-R1-1", "ALT-R1-2", "ALT-R2-1"]);
  });

  it("rejects an end date before the start date", async () => {
    await expectError(findAvailableBeds({ startDate: TODAY, endDate: plus(-1), buildingId: ids.building }), "INVALID_DATES");
  });
});

describe("allocate", () => {
  it("creates a confirmed allocation and removes the bed from availability for overlapping dates", async () => {
    const a = await allocate({ staffId: ids.s1, bedId: ids.r1b1, startDate: TODAY, endDate: plus(30), actorId });
    ids.a1 = a.id;
    expect(a.status).toBe("CONFIRMED");

    const overlapping = await findAvailableBeds({ startDate: plus(10), endDate: plus(20), buildingId: ids.building });
    expect(overlapping.map((b) => b.code)).not.toContain("ALT-R1-1");
    const afterEnd = await findAvailableBeds({ startDate: plus(30), buildingId: ids.building });
    expect(afterEnd.map((b) => b.code)).toContain("ALT-R1-1");
    const beforeStart = await findAvailableBeds({ startDate: plus(-10), endDate: TODAY, buildingId: ids.building });
    expect(beforeStart.map((b) => b.code)).toContain("ALT-R1-1");
  });

  it("refuses a second overlapping bed for the same person", async () => {
    const e = await expectError(allocate({ staffId: ids.s1, bedId: ids.r1b2, startDate: plus(5), actorId }), "STAFF_ALREADY_ALLOCATED");
    expect(e.message).toContain("ALT-R1-1");
  });

  it("validates staff status, bed state, room state and gender policy", async () => {
    await expectError(allocate({ staffId: ids.s3, bedId: ids.r1b2, startDate: TODAY, actorId }), "STAFF_INACTIVE");
    await expectError(allocate({ staffId: ids.s2, bedId: ids.r1b3, startDate: TODAY, actorId }), "BED_UNAVAILABLE");
    await expectError(allocate({ staffId: ids.s2, bedId: ids.r3b1, startDate: TODAY, actorId }), "BED_UNAVAILABLE");
    await expectError(allocate({ staffId: ids.s1, bedId: ids.r2b1, startDate: plus(40), actorId }), "GENDER_POLICY");
    await expectError(allocate({ staffId: ids.s2, bedId: ids.r1b2, startDate: TODAY, endDate: TODAY, actorId }), "INVALID_DATES");
  });

  it("lets exactly one of two concurrent allocations for the same bed succeed", async () => {
    const results = await Promise.allSettled([
      allocate({ staffId: ids.s2, bedId: ids.r1b2, startDate: TODAY, actorId }),
      allocate({ staffId: ids.s4, bedId: ids.r1b2, startDate: plus(3), actorId }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(AllocationError);
    expect((rejected[0].reason as AllocationError).code).toBe("BED_OCCUPIED");
    const winner = (fulfilled[0] as PromiseFulfilledResult<{ id: string }>).value;
    await prisma.allocation.update({ where: { id: winner.id }, data: { status: "CANCELLED", reason: "test cleanup" } });
  });
});

describe("check-in and check-out", () => {
  it("checks in a confirmed allocation and refuses a second check-in", async () => {
    const a = await checkIn({ allocationId: ids.a1, actorId, today: TODAY, notes: "Keys handed over" });
    expect(a.status).toBe("CHECKED_IN");
    expect(a.checkedInAt).not.toBeNull();
    await expectError(checkIn({ allocationId: ids.a1, actorId, today: TODAY }), "INVALID_STATE");
  });

  it("blocks check-out while a key is outstanding, then allows an administrator override", async () => {
    const issue = await prisma.keyTransaction.create({ data: { keyId: ids.key, type: "ISSUE", holderId: ids.s1, custodianId: actorId } });

    const blocked = await expectError(checkOut({ allocationId: ids.a1, actorId, today: plus(2) }), "CLEARANCE_BLOCKED");
    expect(blocked.message).toContain("ALT-K1");
    await expectError(checkOut({ allocationId: ids.a1, actorId, today: plus(2), overrideReason: "Key reported lost", canOverride: false }), "FORBIDDEN");

    const out = await checkOut({ allocationId: ids.a1, actorId, today: plus(2), overrideReason: "Key reported lost", canOverride: true });
    expect(out.status).toBe("CHECKED_OUT");
    expect(out.endDate?.toISOString().slice(0, 10)).toBe(plus(2));

    await prisma.keyTransaction.update({ where: { id: issue.id }, data: { returnedAt: new Date() } });
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: ids.a1, action: "ALLOCATION_CHECKED_OUT" }, orderBy: { createdAt: "desc" } });
    expect((audit?.after as { overrideReason?: string })?.overrideReason).toBe("Key reported lost");
  });

  it("frees the bed from the check-out date (end exclusive)", async () => {
    const beds = await findAvailableBeds({ startDate: plus(2), buildingId: ids.building });
    expect(beds.map((b) => b.code)).toContain("ALT-R1-1");
  });
});

describe("transfer", () => {
  it("future-dated: keeps the current bed until the effective date and links the new allocation", async () => {
    const a = await allocate({ staffId: ids.s2, bedId: ids.r1b1, startDate: plus(2), actorId });
    await checkIn({ allocationId: a.id, actorId, today: plus(2) });

    const moved = await transfer({ allocationId: a.id, toBedId: ids.r1b2, effectiveDate: plus(7), reason: "Room change request", actorId, today: plus(2) });
    const old = await prisma.allocation.findUniqueOrThrow({ where: { id: a.id } });
    expect(old.status).toBe("CHECKED_IN");
    expect(old.endDate?.toISOString().slice(0, 10)).toBe(plus(7));
    expect(moved.status).toBe("CONFIRMED");
    expect(moved.previousAllocationId).toBe(a.id);
    expect(moved.startDate.toISOString().slice(0, 10)).toBe(plus(7));

    // Old bed is still unavailable before the effective date, free from it.
    expect((await findAvailableBeds({ startDate: plus(3), endDate: plus(5), buildingId: ids.building })).map((b) => b.code)).not.toContain("ALT-R1-1");
    expect((await findAvailableBeds({ startDate: plus(7), buildingId: ids.building })).map((b) => b.code)).toContain("ALT-R1-1");

    // Arriving at the new bed closes the old stay.
    const arrived = await checkIn({ allocationId: moved.id, actorId, today: plus(7) });
    expect(arrived.status).toBe("CHECKED_IN");
    const closed = await prisma.allocation.findUniqueOrThrow({ where: { id: a.id } });
    expect(closed.status).toBe("CHECKED_OUT");
    ids.s2current = moved.id;
  });

  it("same-day: moves a checked-in resident immediately", async () => {
    const moved = await transfer({ allocationId: ids.s2current, toBedId: ids.r1b1, effectiveDate: plus(9), reason: "Maintenance", actorId, today: plus(9) });
    expect(moved.status).toBe("CHECKED_IN");
    const old = await prisma.allocation.findUniqueOrThrow({ where: { id: ids.s2current } });
    expect(old.status).toBe("CHECKED_OUT");
    expect(old.endDate?.toISOString().slice(0, 10)).toBe(plus(9));
    ids.s2current = moved.id;
  });

  it("rejects backdated transfers, same-bed transfers and inactive allocations", async () => {
    await expectError(transfer({ allocationId: ids.s2current, toBedId: ids.r1b2, effectiveDate: plus(8), reason: "x", actorId, today: plus(9) }), "INVALID_DATES");
    await expectError(transfer({ allocationId: ids.s2current, toBedId: ids.r1b1, effectiveDate: plus(9), reason: "x", actorId, today: plus(9) }), "INVALID_DATES");
    await expectError(transfer({ allocationId: ids.a1, toBedId: ids.r1b2, effectiveDate: plus(9), reason: "x", actorId, today: plus(9) }), "INVALID_STATE");
  });

  it("before arrival: replaces the confirmed allocation and keeps its dates", async () => {
    const a = await allocate({ staffId: ids.s4, bedId: ids.r2b1, startDate: plus(20), endDate: plus(50), actorId });
    const moved = await transfer({ allocationId: a.id, toBedId: ids.r1b2, effectiveDate: plus(12), reason: "Preference", actorId, today: plus(10) });
    const old = await prisma.allocation.findUniqueOrThrow({ where: { id: a.id } });
    expect(old.status).toBe("CANCELLED");
    expect(moved.status).toBe("CONFIRMED");
    expect(moved.startDate.toISOString().slice(0, 10)).toBe(plus(20));
    expect(moved.endDate?.toISOString().slice(0, 10)).toBe(plus(50));
    ids.s4current = moved.id;
  });
});

describe("notifications", () => {
  it("queues an in-app notification for residents with a user account, exactly once per event", async () => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { code: "TEST" } });
    const resident = await prisma.user.upsert({
      where: { email: "alt-resident@example.com" },
      update: { status: "ACTIVE" },
      create: { organizationId: org.id, email: "alt-resident@example.com", name: "Alt Resident", status: "ACTIVE" },
    });
    await prisma.staffProfile.update({ where: { id: ids.s4 }, data: { userId: resident.id } });

    const a = await allocate({ staffId: ids.s4, bedId: ids.r1b2, startDate: plus(60), endDate: plus(70), actorId });
    const queued = await prisma.notification.findMany({ where: { recipientId: resident.id, event: "allocation.confirmed", payload: { path: ["allocationId"], equals: a.id } } });
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe("QUEUED");
    expect(queued[0].channel).toBe("IN_APP");

    await cancel({ allocationId: a.id, actorId, reason: "test" });
    const cancelled = await prisma.notification.findMany({ where: { recipientId: resident.id, event: "allocation.cancelled" } });
    expect(cancelled.map((n) => n.idempotencyKey)).toContain(`allocation.cancelled:${a.id}`);

    await prisma.notification.deleteMany({ where: { recipientId: resident.id } });
    await prisma.staffProfile.update({ where: { id: ids.s4 }, data: { userId: null } });
  });
});

describe("cancel", () => {
  it("cancels a confirmed allocation with a reason and frees the bed", async () => {
    const c = await cancel({ allocationId: ids.s4current, actorId, reason: "Joiner withdrew" });
    expect(c.status).toBe("CANCELLED");
    expect((await findAvailableBeds({ startDate: plus(20), endDate: plus(50), buildingId: ids.building })).map((b) => b.code)).toContain("ALT-R1-2");
    await expectError(cancel({ allocationId: ids.s4current, actorId, reason: "again" }), "INVALID_STATE");
    await expectError(cancel({ allocationId: ids.s2current, actorId, reason: "checked in" }), "INVALID_STATE");
  });
});
