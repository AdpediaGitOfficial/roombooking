import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/db";
import { LostFoundError } from "../src/modules/lost-found/errors";
import { decideClaim, disposeItem, getItem, handOver, isDueForDisposal, keywords, listItems, lostFoundSummary, myClaims, publicItems, registerItem, similarItems, storeItem, submitClaim, updateItem, withdrawClaim, type Actor } from "../src/modules/lost-found/service";

let siteId: string;
let opId: string;
let adminId: string;
let residentUserId: string;
let residentStaffId: string;
let otherUserId: string;
const op = (): Actor => ({ id: opId, isOperator: true, isManager: false });
const admin = (): Actor => ({ id: adminId, isOperator: true, isManager: true });
const resident = (): Actor => ({ id: residentUserId, isOperator: false, isManager: false });
const NOW = new Date("2026-10-13T10:00:00.000Z");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

async function expectError<T>(p: Promise<T>, code: string) {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(LostFoundError);
    expect((e as LostFoundError).code).toBe(code);
    return e as LostFoundError;
  }
  throw new Error(`expected LostFoundError ${code}`);
}

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  const mk = async (email: string, name: string) => (await prisma.user.upsert({ where: { email }, update: { status: "ACTIVE" }, create: { organizationId: org.id, email, name, status: "ACTIVE" } })).id;
  opId = await mk("lf-officer@example.com", "LF Officer");
  adminId = await mk("lf-admin@example.com", "LF Admin");
  residentUserId = await mk("lf-resident@example.com", "LF Resident");
  otherUserId = await mk("lf-other@example.com", "Other Resident");
  siteId = (await prisma.site.upsert({ where: { organizationId_code: { organizationId: org.id, code: "LF" } }, update: {}, create: { organizationId: org.id, code: "LF", name: "Lost Found Site", timezone: "UTC" } })).id;
  residentStaffId = (await prisma.staffProfile.upsert({ where: { organizationId_employeeId: { organizationId: org.id, employeeId: "LF-1" } }, update: { userId: residentUserId }, create: { organizationId: org.id, employeeId: "LF-1", firstName: "Lost", lastName: "Owner", userId: residentUserId } })).id;
  process.env.UPLOAD_DIR ??= "uploads";
});

afterAll(async () => { await prisma.$disconnect(); });

describe("register and store", () => {
  it("assigns sequential references, sets retention, stores photos and validates input", async () => {
    const a = await registerItem({ siteId, actorId: opId, description: "Black leather wallet with cards", category: "Wallet / cards / ID", foundLocation: "Canteen", foundAt: "2026-10-12T18:30:00.000Z", foundByName: "Cleaner", photos: [{ bytes: PNG, fileName: "wallet.png" }], now: NOW });
    const b = await registerItem({ siteId, actorId: opId, description: "Blue umbrella", foundLocation: "Lobby", foundAt: "2026-10-12T08:00:00.000Z", storageLocation: "Reception cupboard", retentionDays: 30, now: NOW });
    expect(a.reference).toMatch(/^LF-\d{6}$/);
    expect(Number(b.reference.slice(3))).toBe(Number(a.reference.slice(3)) + 1);
    expect(a.status).toBe("REPORTED");
    expect(b.status).toBe("STORED");
    expect(b.retainUntil?.toISOString()).toBe("2026-11-11T08:00:00.000Z");
    const detail = (await getItem(a.id))!;
    expect(detail.photos).toHaveLength(1);
    expect(detail.item.events.map((e) => e.type)).toEqual(["REGISTERED"]);
    await expectError(registerItem({ siteId, actorId: opId, description: "", foundAt: "2026-10-12T08:00:00.000Z", now: NOW }), "VALIDATION");
    await expectError(registerItem({ siteId, actorId: opId, description: "Future thing", foundAt: "2026-10-14T08:00:00.000Z", now: NOW }), "VALIDATION");
    const bad = await expectError(registerItem({ siteId, actorId: opId, description: "Not an image", foundAt: "2026-10-12T08:00:00.000Z", photos: [{ bytes: new Uint8Array([1, 2, 3]), fileName: "x.txt" }], now: NOW }), "VALIDATION");
    expect(bad.fieldErrors.photos).toBeTruthy();
  });

  it("moves a reported item into storage with the actor as custodian and allows edits until closed", async () => {
    const item = await registerItem({ siteId, actorId: opId, description: "Grey hoodie", category: "Clothing", foundAt: "2026-10-11T08:00:00.000Z", now: NOW });
    await expectError(storeItem({ itemId: item.id, actorId: adminId, storageLocation: "" }), "VALIDATION");
    const stored = await storeItem({ itemId: item.id, actorId: adminId, storageLocation: "Store room A, shelf 1" });
    expect(stored.status).toBe("STORED");
    expect(stored.custodianId).toBe(adminId);
    const edited = await updateItem({ itemId: item.id, actorId: opId, description: "Grey hoodie, size M", category: "Clothing", retainUntil: "2026-12-31" });
    expect(edited.retainUntil?.toISOString().slice(0, 10)).toBe("2026-12-31");
    expect((await getItem(item.id))!.item.events.map((e) => e.type)).toEqual(["UPDATED", "STORED", "REGISTERED"]);
  });

  it("finds similar open items by category and shared words within 14 days", async () => {
    await registerItem({ siteId, actorId: opId, description: "Red Samsung phone with cracked screen", category: "Phone / electronics", foundAt: "2026-10-10T08:00:00.000Z", now: NOW });
    expect(keywords("Red Samsung phone with a cracked screen")).toEqual(["red", "samsung", "phone", "cracked", "screen"]);
    const matches = await similarItems({ description: "Samsung phone, red case", category: "Phone / electronics", foundAt: "2026-10-12T08:00:00.000Z", siteId });
    expect(matches[0]?.item.description).toContain("Samsung");
    expect(matches[0]?.shared).toEqual(expect.arrayContaining(["samsung", "phone"]));
    expect(await similarItems({ description: "Samsung phone", foundAt: "2026-12-01T08:00:00.000Z", siteId })).toHaveLength(0);
  });
});

describe("claims, handover and disposal", () => {
  let itemId: string;
  let claimId: string;

  it("records a resident's claim, one pending per person, and keeps claimant details off the public list", async () => {
    const item = await registerItem({ siteId, actorId: opId, description: "Silver watch with brown strap", category: "Jewellery / watch", foundLocation: "Gym", foundAt: "2026-10-12T07:00:00.000Z", storageLocation: "Safe", now: NOW });
    itemId = item.id;
    await expectError(submitClaim({ itemId, actor: resident(), evidence: "mine", claimantId: residentStaffId, claimantUserId: residentUserId }), "VALIDATION");
    const claim = await submitClaim({ itemId, actor: resident(), evidence: "Engraved 'To R. from M.' on the back, strap has a small cut", claimantId: residentStaffId, claimantUserId: residentUserId });
    claimId = claim.id;
    expect(claim.outcome).toBe("PENDING");
    expect((await prisma.lostFoundItem.findUniqueOrThrow({ where: { id: itemId } })).status).toBe("CLAIM_PENDING");
    await expectError(submitClaim({ itemId, actor: resident(), evidence: "Second attempt on the same item", claimantId: residentStaffId, claimantUserId: residentUserId }), "CONFLICT");
    // Another person may also claim; operators can record a walk-in claimant by name.
    await submitClaim({ itemId, actor: { id: otherUserId, isOperator: false, isManager: false }, evidence: "It is a silver watch I lost at the gym", claimantUserId: otherUserId });
    await submitClaim({ itemId, actor: op(), evidence: "Visitor says it is theirs", claimantName: "Walk-in visitor", claimantContact: "050 000 0000" });
    const pub = await publicItems({ siteId });
    const row = pub.find((p) => p.id === itemId)!;
    expect(row.status).toBe("CLAIM_PENDING");
    expect(Object.keys(row)).not.toContain("storageLocation");
    expect((await myClaims(residentUserId)).some((c) => c.id === claimId)).toBe(true);
    expect((await listItems({ filter: "claims", siteId })).rows.some((i) => i.id === itemId && i.claims.length === 3)).toBe(true);
  });

  it("rejects with a reason, verifies one claim (closing the others), notifies the claimant and hands over", async () => {
    await expectError(decideClaim({ claimId, actor: resident(), verified: true }), "FORBIDDEN");
    await expectError(decideClaim({ claimId, actor: op(), verified: false }), "VALIDATION");
    await expectError(handOver({ itemId, actor: op() }), "INVALID_STATE");
    const walkIn = await prisma.lostFoundClaim.findFirstOrThrow({ where: { itemId, claimantName: "Walk-in visitor" } });
    await decideClaim({ claimId: walkIn.id, actor: op(), verified: false, note: "Could not describe the engraving" });
    expect((await prisma.lostFoundItem.findUniqueOrThrow({ where: { id: itemId } })).status).toBe("CLAIM_PENDING");
    const verified = await decideClaim({ claimId, actor: op(), verified: true, note: "Engraving matches" });
    expect(verified.outcome).toBe("VERIFIED");
    const detail = (await getItem(itemId))!;
    expect(detail.item.resolvedClaimId).toBe(claimId);
    expect(detail.item.claims.filter((c) => c.outcome === "REJECTED")).toHaveLength(2);
    expect(await prisma.notification.findFirst({ where: { recipientId: residentUserId, event: "lostfound.claim_verified" } })).not.toBeNull();
    expect(await prisma.notification.findFirst({ where: { recipientId: otherUserId, event: "lostfound.claim_rejected" } })).not.toBeNull();
    await expectError(decideClaim({ claimId, actor: op(), verified: true }), "INVALID_STATE");
    await expectError(handOver({ itemId, actor: resident() }), "FORBIDDEN");
    const returned = await handOver({ itemId, actor: op(), note: "ID checked", evidence: { bytes: PNG, fileName: "signature.png" } });
    expect(returned.status).toBe("RETURNED");
    expect(returned.handedOverToName).toBe("Lost Owner (LF-1)");
    expect((await getItem(itemId))!.photos).toHaveLength(1);
    await expectError(updateItem({ itemId, actorId: opId, description: "x" }), "INVALID_STATE");
    await expectError(submitClaim({ itemId, actor: op(), evidence: "Too late, it is gone now", claimantName: "Late" }), "INVALID_STATE");
    expect(await prisma.notification.findFirst({ where: { recipientId: residentUserId, event: "lostfound.returned" } })).not.toBeNull();
  });

  it("withdrawing the only pending claim returns the item to storage; rejecting all does too", async () => {
    const item = await registerItem({ siteId, actorId: opId, description: "Pair of reading glasses", category: "Glasses", foundAt: "2026-10-12T07:00:00.000Z", storageLocation: "Drawer 2", now: NOW });
    const c = await submitClaim({ itemId: item.id, actor: resident(), evidence: "Black frames with a scratch on the left lens", claimantUserId: residentUserId });
    await expectError(withdrawClaim({ claimId: c.id, actor: { id: otherUserId, isOperator: false, isManager: false } }), "FORBIDDEN");
    await withdrawClaim({ claimId: c.id, actor: resident() });
    expect((await prisma.lostFoundItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("STORED");
    const c2 = await submitClaim({ itemId: item.id, actor: resident(), evidence: "Black frames, scratch on the left lens, second try", claimantUserId: residentUserId });
    await decideClaim({ claimId: c2.id, actor: op(), verified: false, note: "Different brand" });
    expect((await prisma.lostFoundItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("STORED");
    await expect(prisma.lostFoundClaim.deleteMany({ where: { itemId: item.id } })).rejects.toThrow(/cannot be deleted/);
  });

  it("disposal needs an administrator, no pending claim and an expired retention period", async () => {
    const item = await registerItem({ siteId, actorId: opId, description: "Single black sock", category: "Clothing", foundAt: "2026-07-01T07:00:00.000Z", storageLocation: "Bin 3", retentionDays: 30, now: new Date("2026-07-02T00:00:00.000Z") });
    expect(isDueForDisposal(item, NOW)).toBe(true);
    expect((await listItems({ filter: "due", siteId, now: NOW })).rows.some((i) => i.id === item.id)).toBe(true);
    await expectError(disposeItem({ itemId: item.id, actor: op(), method: "Recycled", note: "Unclaimed", now: NOW }), "FORBIDDEN");
    await expectError(disposeItem({ itemId: item.id, actor: admin(), method: "", note: "Unclaimed", now: NOW }), "VALIDATION");
    await expectError(disposeItem({ itemId: item.id, actor: admin(), method: "Recycled", note: "Unclaimed", now: new Date("2026-07-10T00:00:00.000Z") }), "INVALID_STATE");
    const c = await submitClaim({ itemId: item.id, actor: op(), evidence: "Visitor claims the sock", claimantName: "Visitor" });
    await expectError(disposeItem({ itemId: item.id, actor: admin(), method: "Recycled", note: "Unclaimed", now: NOW }), "INVALID_STATE");
    await decideClaim({ claimId: c.id, actor: op(), verified: false, note: "Not theirs" });
    const disposed = await disposeItem({ itemId: item.id, actor: admin(), method: "Recycled", note: "Unclaimed after retention", now: NOW });
    expect(disposed.status).toBe("DISPOSED");
    expect(disposed.disposalAuthorisedById).toBe(adminId);
    const summary = await lostFoundSummary(siteId, NOW);
    expect(summary.disposed30).toBeGreaterThanOrEqual(1);
    expect(summary.returned30).toBeGreaterThanOrEqual(1);
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: item.id, action: "LOST_FOUND_DISPOSED" } });
    expect(audit).not.toBeNull();
  });
});
