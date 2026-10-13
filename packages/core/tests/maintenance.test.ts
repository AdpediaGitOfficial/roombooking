import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { detectImageType, validateImageUpload, UploadError } from "../src/lib/uploads";
import { createSessionRecord, resolveSession } from "../src/lib/auth/session-store";
import { MaintenanceError } from "../src/modules/maintenance/errors";
import { addNote, allowedTransitions, assignWorkOrder, changeStatus, createWorkOrder, getWorkOrder, isOverdue, listAttachments, listWorkOrders, slaDueAt, triageWorkOrder, visibleNotes, type Actor } from "../src/modules/maintenance/service";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);

let orgId: string;
let siteId: string;
let roomId: string;
let vendorId: string;
const actors: Record<string, Actor> = {};

async function expectError<T>(p: Promise<T>, code: string) {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(MaintenanceError);
    expect((e as MaintenanceError).code).toBe(code);
    return e as MaintenanceError;
  }
  throw new Error(`expected MaintenanceError ${code}`);
}

async function ensureUser(key: string, email: string, roles: Role[], vendor?: string) {
  const user = await prisma.user.upsert({ where: { email }, update: { status: "ACTIVE", vendorId: vendor ?? null, accessExpiresAt: null }, create: { organizationId: orgId, email, name: key, status: "ACTIVE", vendorId: vendor ?? null } });
  await prisma.roleAssignment.deleteMany({ where: { userId: user.id } });
  for (const role of roles) await prisma.roleAssignment.create({ data: { userId: user.id, role } });
  actors[key] = { id: user.id, roles, vendorId: vendor ?? null };
  return user;
}

beforeAll(async () => {
  process.env.UPLOAD_DIR = process.env.UPLOAD_DIR ?? "uploads";
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  orgId = org.id;
  const site = await prisma.site.upsert({ where: { organizationId_code: { organizationId: orgId, code: "MNT" } }, update: {}, create: { organizationId: orgId, code: "MNT", name: "Maintenance Site", timezone: "UTC" } });
  siteId = site.id;
  const building = await prisma.building.upsert({ where: { siteId_code: { siteId, code: "MNT-B" } }, update: {}, create: { siteId, code: "MNT-B", name: "Maintenance Block" } });
  roomId = (await prisma.room.upsert({ where: { buildingId_code: { buildingId: building.id, code: "MNT-R1" } }, update: {}, create: { buildingId: building.id, code: "MNT-R1" } })).id;
  const vendor = await prisma.vendor.upsert({ where: { id: "mnt-vendor" }, update: { status: "ACTIVE" }, create: { id: "mnt-vendor", organizationId: orgId, name: "Test Vendor" } });
  vendorId = vendor.id;
  await ensureUser("resident", "mnt-resident@example.com", ["STAFF"]);
  await ensureUser("other", "mnt-other@example.com", ["STAFF"]);
  await ensureUser("coordinator", "mnt-coord@example.com", ["MAINTENANCE_COORDINATOR"]);
  await ensureUser("engineer", "mnt-engineer@example.com", ["TECHNICIAN"]);
  await ensureUser("engineer2", "mnt-engineer2@example.com", ["TECHNICIAN"]);
  await ensureUser("vendor", "mnt-vendor@example.com", ["VENDOR"], vendorId);
  await prisma.workOrderNote.deleteMany({ where: { workOrder: { siteId } } });
  await prisma.attachment.deleteMany({ where: { entityType: "WorkOrder", entityId: { in: (await prisma.workOrder.findMany({ where: { siteId }, select: { id: true } })).map((w) => w.id) } } });
  await prisma.workOrder.deleteMany({ where: { siteId } });
});

afterAll(async () => { await prisma.$disconnect(); });

describe("uploads", () => {
  it("detects image types from bytes and rejects everything else", () => {
    expect(detectImageType(PNG)?.mimeType).toBe("image/png");
    expect(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.mimeType).toBe("image/jpeg");
    expect(detectImageType(new TextEncoder().encode("<script>alert(1)</script>"))).toBeNull();
    expect(() => validateImageUpload(new TextEncoder().encode("GIF89a"), "x.png")).toThrow(UploadError);
    expect(() => validateImageUpload(new Uint8Array(0), "x.png")).toThrow(/empty/);
  });
});

describe("create", () => {
  it("validates fields", async () => {
    const e = await expectError(createWorkOrder({ requesterId: actors.resident.id, category: "Nope", description: "short", priority: "MEDIUM" }), "VALIDATION");
    expect(Object.keys(e.fieldErrors).sort()).toEqual(["category", "description", "locationNote"]);
  });

  it("issues sequential ticket numbers, an SLA target by priority, stores the photo and acknowledges receipt", async () => {
    const a = await createWorkOrder({ requesterId: actors.resident.id, roomId, category: "Plumbing", description: "Shower drain is blocked and water pools", priority: "HIGH", photo: { bytes: PNG, fileName: "drain.png" } });
    const b = await createWorkOrder({ requesterId: actors.resident.id, roomId, category: "Electrical", description: "Socket near the bed sparks when used", priority: "URGENT" });
    expect(a.ticketNumber).toMatch(/^MR-\d{4}-\d{6}$/);
    expect(Number(b.ticketNumber.slice(-6))).toBe(Number(a.ticketNumber.slice(-6)) + 1);
    expect(a.siteId).toBe(siteId);
    expect(a.slaDueAt!.getTime() - a.createdAt.getTime()).toBe(24 * 3600 * 1000);
    expect(b.slaDueAt!.getTime() - b.createdAt.getTime()).toBe(4 * 3600 * 1000);
    expect((await listAttachments(a.id))).toHaveLength(1);
    expect(await prisma.notification.findFirst({ where: { recipientId: actors.resident.id, event: "maintenance.received", idempotencyKey: `maintenance.received:${a.id}` } })).not.toBeNull();
  });

  it("rejects a non-image photo without creating the ticket", async () => {
    const before = await prisma.workOrder.count({ where: { siteId } });
    const e = await expectError(createWorkOrder({ requesterId: actors.resident.id, roomId, category: "Other", description: "Something broke in the corridor", priority: "LOW", photo: { bytes: new TextEncoder().encode("not an image"), fileName: "x.jpg" } }), "VALIDATION");
    expect(e.fieldErrors.photo).toContain("not a JPEG");
    expect(await prisma.workOrder.count({ where: { siteId } })).toBe(before);
  });
});

describe("transitions and roles", () => {
  it("maps allowed transitions by status and relationship", () => {
    expect(allowedTransitions("NEW", "coordinator", { reopenWindowOpen: false })).toEqual(["TRIAGED", "CANCELLED"]);
    expect(allowedTransitions("NEW", "requester", { reopenWindowOpen: false })).toEqual(["CANCELLED"]);
    expect(allowedTransitions("ASSIGNED", "assignee", { reopenWindowOpen: false })).toEqual(["IN_PROGRESS", "WAITING_STAFF", "WAITING_PARTS", "WAITING_ACCESS", "RESOLVED"]);
    expect(allowedTransitions("ASSIGNED", "requester", { reopenWindowOpen: false })).toEqual([]);
    expect(allowedTransitions("RESOLVED", "requester", { reopenWindowOpen: true })).toEqual(["CLOSED", "REOPENED"]);
    expect(allowedTransitions("RESOLVED", "requester", { reopenWindowOpen: false })).toEqual(["CLOSED"]);
    expect(allowedTransitions("CLOSED", "coordinator", { reopenWindowOpen: false })).toEqual([]);
  });

  it("only coordinators assign, only to active maintenance members or vendors", async () => {
    const wo = await prisma.workOrder.findFirstOrThrow({ where: { siteId, category: "Plumbing" } });
    await expectError(assignWorkOrder({ workOrderId: wo.id, actor: actors.resident, assigneeId: actors.engineer.id }), "FORBIDDEN");
    await expectError(assignWorkOrder({ workOrderId: wo.id, actor: actors.coordinator, assigneeId: actors.other.id }), "VALIDATION");
    const assigned = await assignWorkOrder({ workOrderId: wo.id, actor: actors.coordinator, assigneeId: actors.engineer.id, note: "Bring the drain snake" });
    expect(assigned.status).toBe("ASSIGNED");
    expect(assigned.acknowledgedAt).not.toBeNull();
    const full = await getWorkOrder(wo.id);
    expect(full?.notes.some((n) => n.type === "ASSIGNMENT" && n.note.includes("engineer"))).toBe(true);
    expect(await prisma.notification.findFirst({ where: { recipientId: actors.resident.id, event: "maintenance.assigned" } })).not.toBeNull();
  });

  it("the assignee works the ticket; resolution needs a note; the requester cannot resolve", async () => {
    const wo = await prisma.workOrder.findFirstOrThrow({ where: { siteId, category: "Plumbing" } });
    await expectError(changeStatus({ workOrderId: wo.id, actor: actors.engineer2, status: "IN_PROGRESS" }), "FORBIDDEN");
    await expectError(changeStatus({ workOrderId: wo.id, actor: actors.resident, status: "RESOLVED", note: "x" }), "INVALID_TRANSITION");
    const started = await changeStatus({ workOrderId: wo.id, actor: actors.engineer, status: "IN_PROGRESS" });
    expect(started.startedAt).not.toBeNull();
    await changeStatus({ workOrderId: wo.id, actor: actors.engineer, status: "WAITING_PARTS", note: "Need a new trap" });
    await expectError(changeStatus({ workOrderId: wo.id, actor: actors.engineer, status: "RESOLVED" }), "NOTE_REQUIRED");
    const resolved = await changeStatus({ workOrderId: wo.id, actor: actors.engineer, status: "RESOLVED", note: "Replaced the trap and cleared the line" });
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.resolutionNote).toContain("Replaced");
    expect(await prisma.notification.findFirst({ where: { recipientId: actors.resident.id, event: "maintenance.resolved" } })).not.toBeNull();
  });

  it("the requester can reopen within the window (with a reason) and later confirm closure", async () => {
    const wo = await prisma.workOrder.findFirstOrThrow({ where: { siteId, category: "Plumbing" } });
    await expectError(changeStatus({ workOrderId: wo.id, actor: actors.resident, status: "REOPENED" }), "NOTE_REQUIRED");
    const reopened = await changeStatus({ workOrderId: wo.id, actor: actors.resident, status: "REOPENED", note: "Still draining slowly" });
    expect(reopened.reopenCount).toBe(1);
    expect(reopened.resolvedAt).toBeNull();
    const again = await changeStatus({ workOrderId: wo.id, actor: actors.engineer, status: "RESOLVED", note: "Cleared the main stack as well" });
    expect(again.status).toBe("RESOLVED");
    // Outside the window the requester may only close.
    const late = new Date(Date.now() + 8 * 86400000);
    await expectError(changeStatus({ workOrderId: wo.id, actor: actors.resident, status: "REOPENED", note: "x", now: late }), "INVALID_TRANSITION");
    const closed = await changeStatus({ workOrderId: wo.id, actor: actors.resident, status: "CLOSED" });
    expect(closed.closedAt).not.toBeNull();
    await expectError(addNote({ workOrderId: wo.id, actor: actors.engineer, note: "too late" }), "INVALID_TRANSITION");
  });

  it("triage adjusts priority and SLA, and cancel needs a reason", async () => {
    const wo = await prisma.workOrder.findFirstOrThrow({ where: { siteId, category: "Electrical" } });
    const triaged = await triageWorkOrder({ workOrderId: wo.id, actor: actors.coordinator, priority: "LOW", markTriaged: true });
    expect(triaged.status).toBe("TRIAGED");
    expect(triaged.slaDueAt!.getTime() - wo.createdAt.getTime()).toBe(168 * 3600 * 1000);
    await expectError(changeStatus({ workOrderId: wo.id, actor: actors.coordinator, status: "CANCELLED" }), "NOTE_REQUIRED");
    const cancelled = await changeStatus({ workOrderId: wo.id, actor: actors.coordinator, status: "CANCELLED", note: "Duplicate of another ticket" });
    expect(cancelled.status).toBe("CANCELLED");
  });
});

describe("vendors and visibility", () => {
  it("vendor users see only tickets assigned to their vendor, with internal notes hidden", async () => {
    const wo = await createWorkOrder({ requesterId: actors.other.id, roomId, category: "Air conditioning", description: "AC unit leaks water onto the floor", priority: "MEDIUM" });
    expect((await listWorkOrders(actors.vendor, "all")).map((w) => w.id)).not.toContain(wo.id);
    await assignWorkOrder({ workOrderId: wo.id, actor: actors.coordinator, vendorId });
    expect((await listWorkOrders(actors.vendor, "open")).map((w) => w.id)).toContain(wo.id);
    await addNote({ workOrderId: wo.id, actor: actors.coordinator, note: "Resident complained twice before", internal: true });
    await addNote({ workOrderId: wo.id, actor: actors.coordinator, note: "Please attend tomorrow morning" });
    const full = (await getWorkOrder(wo.id))!;
    expect(visibleNotes(full, "vendor").map((n) => n.note)).not.toContain("Resident complained twice before");
    expect(visibleNotes(full, "requester").map((n) => n.note)).not.toContain("Resident complained twice before");
    expect(visibleNotes(full, "coordinator").map((n) => n.note)).toContain("Resident complained twice before");
    const done = await changeStatus({ workOrderId: wo.id, actor: actors.vendor, status: "RESOLVED", note: "Drain line unblocked" });
    expect(done.status).toBe("RESOLVED");
    // A requester's internal flag is ignored: their notes are always visible.
    const n = await addNote({ workOrderId: wo.id, actor: actors.other, note: "Thanks", internal: true });
    expect(n.internal).toBe(false);
  });

  it("residents only see their own tickets in the queue scope and overdue is computed from the SLA", async () => {
    const mine = await listWorkOrders(actors.resident, "all");
    expect(mine.every((w) => w.requesterId === actors.resident.id)).toBe(true);
    expect(isOverdue({ status: "ASSIGNED", slaDueAt: new Date(Date.now() - 1000) })).toBe(true);
    expect(isOverdue({ status: "CLOSED", slaDueAt: new Date(Date.now() - 1000) })).toBe(false);
    expect(slaDueAt("LOW", new Date(0)).getTime()).toBe(168 * 3600 * 1000);
  });

  it("expired contractor access ends the session", async () => {
    const { token } = await createSessionRecord(actors.vendor.id);
    expect(await resolveSession(token)).not.toBeNull();
    await prisma.user.update({ where: { id: actors.vendor.id }, data: { accessExpiresAt: new Date(Date.now() - 1000) } });
    expect(await resolveSession(token)).toBeNull();
    await prisma.user.update({ where: { id: actors.vendor.id }, data: { accessExpiresAt: null } });
  });
});
