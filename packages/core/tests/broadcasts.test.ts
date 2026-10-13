import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/db";
import { BroadcastError } from "../src/modules/broadcasts/errors";
import { broadcastDelivery, cancelBroadcast, createBroadcast, describeAudience, myAnnouncements, openAnnouncement, parseAudience, resolveAudience, sendBroadcast, updateBroadcast } from "../src/modules/broadcasts/service";
import { renderEmail } from "../src/modules/notifications/templates";
import { renderWhatsApp } from "../src/modules/notifications/whatsapp-templates";

const stamp = Date.now().toString(36);
let orgId: string;
let adminId: string;
let siteA: string; let siteB: string; let blockA1: string; let blockA2: string;
let residentA1: string; let residentB: string;

async function expectError<T>(p: Promise<T>, code: string) {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(BroadcastError); expect((e as BroadcastError).code).toBe(code); return e as BroadcastError; }
  throw new Error(`expected BroadcastError ${code}`);
}

beforeAll(async () => {
  // A separate organisation so audiences are deterministic.
  const org = await prisma.organization.upsert({ where: { code: `BC-${stamp}` }, update: {}, create: { code: `BC-${stamp}`, name: "Broadcast Org" } });
  orgId = org.id;
  const site = async (code: string) => (await prisma.site.create({ data: { organizationId: orgId, code, name: `Site ${code}`, timezone: "UTC" } })).id;
  siteA = await site("A"); siteB = await site("B");
  const building = async (sid: string, code: string) => (await prisma.building.create({ data: { siteId: sid, code, name: `Block ${code}` } })).id;
  blockA1 = await building(siteA, "A1"); blockA2 = await building(siteA, "A2"); const blockB1 = await building(siteB, "B1");
  const bed = async (bid: string, code: string) => { const room = await prisma.room.create({ data: { buildingId: bid, code: `R-${code}` } }); return (await prisma.bed.create({ data: { roomId: room.id, code: `${code}-1` } })).id; };
  let n = 0;
  const user = async (name: string, roles: Array<{ role: "STAFF" | "ACCOMMODATION_OFFICER" | "MAINTENANCE" | "SYSTEM_ADMIN"; siteId?: string; buildingId?: string }>, home?: string) => {
    const u = await prisma.user.create({ data: { organizationId: orgId, email: `bc-${stamp}-${n++}@example.com`, name, status: "ACTIVE", roleAssignments: { create: roles.map((r) => ({ role: r.role, siteId: r.siteId ?? null, buildingId: r.buildingId ?? null })) } } });
    if (home) {
      const staff = await prisma.staffProfile.create({ data: { organizationId: orgId, employeeId: `BC-${stamp}-${n}`, firstName: name, lastName: "Test", userId: u.id } });
      await prisma.allocation.create({ data: { staffId: staff.id, bedId: await bed(home, `${stamp}${n}`), startDate: new Date("2026-01-01"), status: "CHECKED_IN" } });
    }
    return u.id;
  };
  adminId = await user("Admin", [{ role: "SYSTEM_ADMIN" }]);
  residentA1 = await user("Resident A1", [{ role: "STAFF" }], blockA1);
  await user("Resident A2", [{ role: "STAFF" }], blockA2);
  residentB = await user("Resident B", [{ role: "STAFF" }], blockB1);
  await user("Resident Nowhere", [{ role: "STAFF" }]);
  await user("Officer A", [{ role: "ACCOMMODATION_OFFICER", siteId: siteA }]);
  await user("Officer Global", [{ role: "ACCOMMODATION_OFFICER" }]);
  await user("Engineer B", [{ role: "MAINTENANCE", siteId: siteB }]);
  await prisma.user.create({ data: { organizationId: orgId, email: `bc-${stamp}-gone@example.com`, name: "Deactivated", status: "DEACTIVATED", roleAssignments: { create: [{ role: "STAFF" }] } } });
});

afterAll(async () => { await prisma.$disconnect(); });

describe("audience", () => {
  it("resolves everyone, roles, sites and buildings, with residents placed by their current bed and staff by role scope", async () => {
    const names = async (a: Parameters<typeof resolveAudience>[1]) => (await resolveAudience(orgId, a)).map((r) => r.name).sort();
    expect(await names({ roles: [], siteIds: [], buildingIds: [] })).toEqual(["Admin", "Engineer B", "Officer A", "Officer Global", "Resident A1", "Resident A2", "Resident B", "Resident Nowhere"]);
    expect(await names({ roles: ["STAFF"], siteIds: [], buildingIds: [] })).toEqual(["Resident A1", "Resident A2", "Resident B", "Resident Nowhere"]);
    expect(await names({ roles: ["STAFF"], siteIds: [siteA], buildingIds: [] })).toEqual(["Resident A1", "Resident A2"]);
    expect(await names({ roles: ["STAFF"], siteIds: [], buildingIds: [blockA2] })).toEqual(["Resident A2"]);
    expect(await names({ roles: [], siteIds: [siteA], buildingIds: [] })).toEqual(["Admin", "Officer A", "Officer Global", "Resident A1", "Resident A2"]);
    expect(await names({ roles: ["ACCOMMODATION_OFFICER", "MAINTENANCE"], siteIds: [siteB], buildingIds: [] })).toEqual(["Engineer B", "Officer Global"]);
    expect(await names({ roles: ["ACCOMMODATION_OFFICER"], siteIds: [], buildingIds: [blockA1] })).toEqual(["Officer A", "Officer Global"]);
    expect(parseAudience({ roles: ["STAFF", "NOPE", 3], siteIds: ["x", ""], buildingIds: null })).toEqual({ roles: ["STAFF"], siteIds: ["x"], buildingIds: [] });
    expect(await describeAudience({ roles: ["STAFF"], siteIds: [siteA], buildingIds: [] })).toBe("residents at Site A");
    expect(await describeAudience({ roles: [], siteIds: [], buildingIds: [] })).toBe("everyone at all sites");
  });
});

describe("lifecycle", () => {
  let id: string;
  it("creates and edits a draft, refuses empty or oversized text, and cancels", async () => {
    await expectError(createBroadcast({ organizationId: orgId, actorId: adminId, title: "", body: "x", audience: { roles: [], siteIds: [], buildingIds: [] }, emailCopy: true, whatsappCopy: false }), "VALIDATION");
    await expectError(createBroadcast({ organizationId: orgId, actorId: adminId, title: "t", body: "x".repeat(2001), audience: { roles: [], siteIds: [], buildingIds: [] }, emailCopy: true, whatsappCopy: false }), "VALIDATION");
    const b = await createBroadcast({ organizationId: orgId, actorId: adminId, title: "Water off tomorrow", body: "Water will be off from 09:00 to 12:00.", audience: { roles: ["STAFF"], siteIds: [siteA], buildingIds: [] }, emailCopy: true, whatsappCopy: true });
    id = b.id;
    expect(b.status).toBe("DRAFT");
    const e = await updateBroadcast({ broadcastId: id, actorId: adminId, title: "Water off tomorrow", body: "Water will be off from 09:00 to 13:00.\nPlease fill containers tonight.", audience: { roles: ["STAFF"], siteIds: [siteA], buildingIds: [] }, emailCopy: true, whatsappCopy: false });
    expect(e.body).toContain("13:00");
    const c = await createBroadcast({ organizationId: orgId, actorId: adminId, title: "Scrap", body: "x", audience: { roles: [], siteIds: [], buildingIds: [] }, emailCopy: false, whatsappCopy: false });
    await cancelBroadcast({ broadcastId: c.id, actorId: adminId });
    await expectError(sendBroadcast({ broadcastId: c.id, actorId: adminId }), "INVALID_STATE");
    await expectError(updateBroadcast({ broadcastId: c.id, actorId: adminId, title: "t", body: "b", audience: { roles: [], siteIds: [], buildingIds: [] }, emailCopy: false, whatsappCopy: false }), "INVALID_STATE");
  });

  it("sends once per recipient with the chosen copies, is safe to re-run, and reports delivery", async () => {
    await prisma.user.update({ where: { id: residentA1 }, data: { whatsappNumber: "+971500000009", whatsappNotifications: true, whatsappConsentAt: new Date() } });
    const empty = await createBroadcast({ organizationId: orgId, actorId: adminId, title: "Nobody", body: "x", audience: { roles: ["VENDOR"], siteIds: [], buildingIds: [] }, emailCopy: false, whatsappCopy: false });
    await expectError(sendBroadcast({ broadcastId: empty.id, actorId: adminId }), "VALIDATION");
    const { recipients, broadcast } = await sendBroadcast({ broadcastId: id, actorId: adminId });
    expect(recipients).toBe(2);
    expect(broadcast.status).toBe("SENT");
    expect(broadcast.recipientCount).toBe(2);
    const rows = await prisma.notification.findMany({ where: { idempotencyKey: { startsWith: `broadcast:${id}:` } } });
    expect(rows.filter((r) => r.channel === "IN_APP")).toHaveLength(2);
    expect(rows.filter((r) => r.channel === "EMAIL")).toHaveLength(2);
    expect(rows.filter((r) => r.channel === "WHATSAPP")).toHaveLength(0); // whatsappCopy switched off in the edit
    expect(rows.every((r) => (r.payload as { title: string }).title === "Water off tomorrow")).toBe(true);
    await expectError(sendBroadcast({ broadcastId: id, actorId: adminId }), "INVALID_STATE");
    // Re-queuing the same keys (an interrupted send re-run) adds nothing.
    await prisma.broadcast.update({ where: { id }, data: { status: "DRAFT" } });
    await sendBroadcast({ broadcastId: id, actorId: adminId });
    expect(await prisma.notification.count({ where: { idempotencyKey: { startsWith: `broadcast:${id}:` } } })).toBe(4);
    const mine = await myAnnouncements(residentA1);
    expect(mine.map((m) => (m.payload as { broadcastId: string }).broadcastId)).toContain(id);
    expect(await openAnnouncement(residentB, id)).toBeNull();
    const opened = await openAnnouncement(residentA1, id);
    expect(opened?.title).toBe("Water off tomorrow");
    const d = await broadcastDelivery(id);
    expect(d).toMatchObject({ inApp: 2, read: 1, email: { QUEUED: 2 } });
    expect(await prisma.auditEvent.findFirst({ where: { entityType: "Broadcast", entityId: id, action: "BROADCAST_SENT" } })).not.toBeNull();
  });

  it("renders broadcast copies: full text by email, title only on WhatsApp", async () => {
    const mail = renderEmail("broadcast", { broadcastId: "b1", title: "Fire drill", body: "Drill at 10:00.\nAssemble at the car park." }, "Sample Resident");
    expect(mail.subject).toBe("Fire drill");
    expect(mail.text).toContain("Assemble at the car park.");
    expect(mail.text).toContain("/my/announcements/b1");
    const wa = renderWhatsApp("broadcast", { broadcastId: "b1", title: "Fire drill", body: "Drill at 10:00. Assemble at the car park." }, "Sample Resident", "1");
    expect(wa.parameters).toEqual(["Sample", "Fire drill"]);
    expect(wa.text).not.toContain("car park");
  });
});
