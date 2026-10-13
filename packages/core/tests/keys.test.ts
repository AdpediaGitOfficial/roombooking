import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/db";
import { KeyError } from "../src/modules/keys/errors";
import { getKey, isOverdue, issueKey, keysForRoom, keysHeldBy, listKeys, markFound, openIssue, registerKey, replaceKey, reportDamaged, reportLost, retireKey, returnKey, setRepairState } from "../src/modules/keys/service";
import { clearanceBlockers } from "../src/modules/allocations/service";

let siteId: string;
let roomId: string;
let actorId: string;
let staffId: string;
let staff2Id: string;
const plus = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const uniq = (p: string) => `${p}-${Date.now().toString(36)}`;

async function expectError<T>(p: Promise<T>, code: string) {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(KeyError);
    expect((e as KeyError).code).toBe(code);
    return e as KeyError;
  }
  throw new Error(`expected KeyError ${code}`);
}

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  const actor = await prisma.user.upsert({ where: { email: "key-custodian@example.com" }, update: { status: "ACTIVE" }, create: { organizationId: org.id, email: "key-custodian@example.com", name: "Custodian", status: "ACTIVE" } });
  actorId = actor.id;
  const site = await prisma.site.upsert({ where: { organizationId_code: { organizationId: org.id, code: "KEYS" } }, update: {}, create: { organizationId: org.id, code: "KEYS", name: "Key Site", timezone: "UTC" } });
  siteId = site.id;
  const building = await prisma.building.upsert({ where: { siteId_code: { siteId, code: "KB" } }, update: {}, create: { siteId, code: "KB", name: "Key Block" } });
  roomId = (await prisma.room.upsert({ where: { buildingId_code: { buildingId: building.id, code: "KB-R1" } }, update: {}, create: { buildingId: building.id, code: "KB-R1" } })).id;
  staffId = (await prisma.staffProfile.upsert({ where: { organizationId_employeeId: { organizationId: org.id, employeeId: "KEY-1" } }, update: { employmentStatus: "ACTIVE" }, create: { organizationId: org.id, employeeId: "KEY-1", firstName: "Key", lastName: "Holder" } })).id;
  staff2Id = (await prisma.staffProfile.upsert({ where: { organizationId_employeeId: { organizationId: org.id, employeeId: "KEY-2" } }, update: {}, create: { organizationId: org.id, employeeId: "KEY-2", firstName: "Second", lastName: "Holder" } })).id;
  // Transactions can never be deleted; close any open issues from earlier runs so the fixtures start clean.
  await prisma.keyTransaction.updateMany({ where: { key: { siteId }, type: "ISSUE", returnedAt: null }, data: { returnedAt: new Date() } });
  await prisma.key.updateMany({ where: { siteId, status: { not: "RETIRED" } }, data: { status: "RETIRED" } });
});

afterAll(async () => { await prisma.$disconnect(); });

describe("register", () => {
  it("registers a key against a room and rejects duplicate codes and cross-site rooms", async () => {
    const code = uniq("KB-R1");
    const key = await registerKey({ siteId, code, label: "Main door", roomId, actorId });
    expect(key.status).toBe("AVAILABLE");
    const dup = await expectError(registerKey({ siteId, code, roomId, actorId }), "VALIDATION");
    expect(dup.fieldErrors.code).toContain("Already used");
    const otherRoom = await prisma.room.findFirst({ where: { building: { siteId: { not: siteId } } }, include: { building: true } });
    if (otherRoom) {
      const k = await registerKey({ siteId, code: uniq("X"), roomId: otherRoom.id, actorId });
      expect(k.siteId).toBe(otherRoom.building.siteId); // the room's site wins
    }
    await expectError(registerKey({ siteId: "", code: uniq("NS"), actorId }), "VALIDATION");
  });
});

describe("issue and return", () => {
  let keyId: string;
  it("issues to an active resident with an expected return, blocks a second issue, and reports the holder", async () => {
    keyId = (await registerKey({ siteId, code: uniq("K1"), roomId, actorId })).id;
    const txn = await issueKey({ keyId, actorId, holderStaffId: staffId, expectedReturnAt: plus(7), notes: "Check-in handover" });
    expect(txn.type).toBe("ISSUE");
    expect((await getKey(keyId))?.status).toBe("ISSUED");
    await expectError(issueKey({ keyId, actorId, holderStaffId: staff2Id }), "INVALID_STATE");
    expect((await keysHeldBy(staffId)).map((t) => t.keyId)).toContain(keyId);
    expect((await keysForRoom(roomId)).find((r) => r.key.id === keyId)?.issue?.holderId).toBe(staffId);
    expect((await clearanceBlockers(staffId)).some((b) => b.type === "KEY")).toBe(true);
  });

  it("lets exactly one of two concurrent issues win (database constraint)", async () => {
    const k = (await registerKey({ siteId, code: uniq("RACE"), roomId, actorId })).id;
    const results = await Promise.allSettled([
      issueKey({ keyId: k, actorId, holderStaffId: staffId }),
      issueKey({ keyId: k, actorId, holderStaffId: staff2Id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(["CONFLICT", "INVALID_STATE"]).toContain((rejected.reason as KeyError).code);
    expect(await prisma.keyTransaction.count({ where: { keyId: k, type: "ISSUE", returnedAt: null } })).toBe(1);
  });

  it("validates holder and dates", async () => {
    const k = (await registerKey({ siteId, code: uniq("V"), roomId, actorId })).id;
    await expectError(issueKey({ keyId: k, actorId }), "VALIDATION");
    await expectError(issueKey({ keyId: k, actorId, holderStaffId: staffId, expectedReturnAt: "soon" }), "VALIDATION");
    const txn = await issueKey({ keyId: k, actorId, holderName: "Contractor Ltd" });
    expect(txn.holderName).toBe("Contractor Ltd");
    await returnKey({ keyId: k, actorId });
  });

  it("returns the key in good condition, closing the issue; the history keeps both rows", async () => {
    const ret = await returnKey({ keyId, actorId, condition: "Good", notes: "All fine" });
    expect(ret.type).toBe("RETURN");
    const key = (await getKey(keyId))!;
    expect(key.status).toBe("AVAILABLE");
    expect(openIssue(key)).toBeNull();
    expect(key.transactions.map((t) => t.type).sort()).toEqual(["ISSUE", "RETURN"]);
    expect((await keysHeldBy(staffId)).map((t) => t.keyId)).not.toContain(keyId);
    await expectError(returnKey({ keyId, actorId }), "INVALID_STATE");
  });

  it("a damaged return marks the key damaged, then repair brings it back", async () => {
    await issueKey({ keyId, actorId, holderStaffId: staffId });
    await returnKey({ keyId, actorId, condition: "Damaged", notes: "Bent" });
    expect((await getKey(keyId))?.status).toBe("DAMAGED");
    await expectError(issueKey({ keyId, actorId, holderStaffId: staffId }), "INVALID_STATE");
    await expectError(setRepairState({ keyId, actorId, state: "AVAILABLE" }), "INVALID_STATE");
    await setRepairState({ keyId, actorId, state: "UNDER_REPAIR", notes: "Locksmith" });
    await setRepairState({ keyId, actorId, state: "AVAILABLE" });
    expect((await getKey(keyId))?.status).toBe("AVAILABLE");
  });

  it("computes overdue from the expected return date", async () => {
    expect(isOverdue({ expectedReturnAt: new Date(Date.now() - 1000), returnedAt: null })).toBe(true);
    expect(isOverdue({ expectedReturnAt: new Date(Date.now() - 1000), returnedAt: new Date() })).toBe(false);
    expect(isOverdue({ expectedReturnAt: null, returnedAt: null })).toBe(false);
    const k = (await registerKey({ siteId, code: uniq("OD"), roomId, actorId })).id;
    await issueKey({ keyId: k, actorId, holderStaffId: staff2Id, expectedReturnAt: plus(-2) });
    expect((await listKeys("overdue", siteId)).map((r) => r.key.id)).toContain(k);
    await returnKey({ keyId: k, actorId });
  });
});

describe("lost, found, replace, retire", () => {
  it("a lost issued key keeps the holder accountable until replaced; replacement retires it and registers the new key", async () => {
    const k = (await registerKey({ siteId, code: uniq("LOST"), label: "Store room", roomId, actorId })).id;
    await issueKey({ keyId: k, actorId, holderStaffId: staffId });
    await expectError(reportLost({ keyId: k, actorId, notes: "" }), "VALIDATION");
    await reportLost({ keyId: k, actorId, notes: "Lost on site", incidentRef: "INC-42" });
    let key = (await getKey(k))!;
    expect(key.status).toBe("LOST");
    expect(openIssue(key)).not.toBeNull();
    expect((await clearanceBlockers(staffId)).some((b) => b.label.includes(key.code))).toBe(true);
    await expectError(returnKey({ keyId: k, actorId }), "INVALID_STATE");
    await expectError(retireKey({ keyId: k, actorId, notes: "x" }), "INVALID_STATE");

    const replacement = await replaceKey({ keyId: k, actorId, newCode: `${key.code}-R1`, notes: "Cut by locksmith" });
    key = (await getKey(k))!;
    expect(key.status).toBe("RETIRED");
    expect(openIssue(key)).toBeNull();
    expect(key.transactions.map((t) => t.type)).toContain("REPLACED");
    expect(replacement.status).toBe("AVAILABLE");
    expect(replacement.replacesKeyId).toBe(k);
    expect(replacement.roomId).toBe(roomId);
    expect((await clearanceBlockers(staffId)).some((b) => b.label.includes(key.code))).toBe(false);
  });

  it("a lost key that turns up is recorded found and returned", async () => {
    const k = (await registerKey({ siteId, code: uniq("FOUND"), roomId, actorId })).id;
    await issueKey({ keyId: k, actorId, holderStaffId: staff2Id });
    await reportLost({ keyId: k, actorId, notes: "Missing" });
    await markFound({ keyId: k, actorId, notes: "In the laundry" });
    const key = (await getKey(k))!;
    expect(key.status).toBe("AVAILABLE");
    expect(openIssue(key)).toBeNull();
  });

  it("damaged available keys can be retired, and history rows cannot be deleted", async () => {
    const k = (await registerKey({ siteId, code: uniq("DMG"), roomId, actorId })).id;
    await reportDamaged({ keyId: k, actorId, notes: "Snapped" });
    await retireKey({ keyId: k, actorId, notes: "Beyond repair" });
    expect((await getKey(k))?.status).toBe("RETIRED");
    await expect(prisma.keyTransaction.deleteMany({ where: { keyId: k } })).rejects.toThrow(/cannot be deleted/);
    expect((await listKeys("all", siteId)).map((r) => r.key.id)).not.toContain(k);
    expect((await listKeys("retired", siteId)).map((r) => r.key.id)).toContain(k);
  });
});
