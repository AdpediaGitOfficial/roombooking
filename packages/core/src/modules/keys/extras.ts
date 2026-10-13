// Key management extras from the Roles, Permissions & Module Map (5.5, 6): sensitive keys and the Key supervisor,
// job keys for technicians and vendors, emergency keys, loss approval with a lock-change work order,
// audit / reconciliation, bulk creation, and sensitive-key history.
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { actorAccess, actorCan, type ActorLike } from "../../lib/permissions/actor";
import { createWorkOrder } from "../maintenance/service";
import { KeyError } from "./errors";
import { issueKey, replaceKey, reportLost, returnKey, type IssueInput } from "./service";
import { raiseCharge } from "../charges/service";

type Tx = Prisma.TransactionClient;

export const isEmergencyKey = (k: { cabinet: string | null }) => /emergency/i.test(k.cabinet ?? "");

/** Whether a technician or vendor holds an open job in the key's room (the only time they may draw its key). */
async function hasJobFor(actor: ActorLike, key: { roomId: string | null; facilityId: string | null; siteId: string }): Promise<boolean> {
  if (!key.roomId) return false;
  return (await prisma.workOrder.count({
    where: { roomId: key.roomId, status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "WAITING_PARTS", "WAITING_ACCESS", "WAITING_STAFF"] }, OR: [{ assigneeId: actor.id }, ...(actor.vendorId ? [{ vendorId: actor.vendorId }] : [])] },
  })) > 0;
}

/**
 * Checks the actor may issue this key: standard keys with keys.standard, sensitive keys with keys.sensitive (the Key
 * supervisor grant for officers), emergency keys with keys.emergency and a reason, technicians and vendors only for the
 * room they hold a job in, and Security only with the night grant.
 */
export async function assertCanIssue(actor: ActorLike, key: { id: string; code: string; siteId: string; roomId: string | null; facilityId: string | null; sensitive: boolean; cabinet: string | null }, notes?: string | null) {
  const ctx = { siteId: key.siteId };
  const access = actorAccess(actor, key.sensitive ? "keys.sensitive" : "keys.standard", ctx);
  if (isEmergencyKey(key)) {
    if (!actorCan(actor, "keys.emergency", ctx)) throw new KeyError("FORBIDDEN", "Emergency keys can only be issued by an Accommodation Admin.");
    if (!notes?.trim()) throw new KeyError("VALIDATION", "Record the reason for issuing an emergency key.", { notes: "Required." });
    return;
  }
  if (!access) throw new KeyError("FORBIDDEN", key.sensitive ? "Sensitive keys can only be issued by a Key supervisor or an Admin." : "Your role does not allow issuing keys.");
  if ((access.tag ?? "").toLowerCase().includes("job")) {
    if (!(await hasJobFor(actor, key))) throw new KeyError("FORBIDDEN", "You can only draw keys for a room where you hold an open job.");
  }
}

export async function issueKeyAs(actor: ActorLike, input: Omit<IssueInput, "actorId">) {
  const key = await prisma.key.findUnique({ where: { id: input.keyId } });
  if (!key) throw new KeyError("NOT_FOUND", "Key not found.");
  await assertCanIssue(actor, key, input.notes);
  // A contractor drawing a job key is accountable through their vendor.
  const holderVendorId = input.holderVendorId ?? (actor.vendorId && !input.holderStaffId ? actor.vendorId : null);
  return issueKey({ ...input, holderVendorId, actorId: actor.id });
}

export async function returnKeyAs(actor: ActorLike, input: { keyId: string; condition?: string | null; notes?: string | null }) {
  const key = await prisma.key.findUnique({ where: { id: input.keyId } });
  if (!key) throw new KeyError("NOT_FOUND", "Key not found.");
  const access = actorAccess(actor, key.sensitive ? "keys.sensitive" : "keys.standard", { siteId: key.siteId });
  if (!access) throw new KeyError("FORBIDDEN", key.sensitive ? "Sensitive keys are returned through a Key supervisor or an Admin." : "Your role does not allow returning keys.");
  return returnKey({ ...input, actorId: actor.id });
}

export async function setSensitive(actor: ActorLike, keyId: string, sensitive: boolean) {
  const key = await prisma.key.findUnique({ where: { id: keyId } });
  if (!key) throw new KeyError("NOT_FOUND", "Key not found.");
  if (!actorCan(actor, "keys.register", { siteId: key.siteId })) throw new KeyError("FORBIDDEN", "Only an Admin can change how a key is classified.");
  await prisma.key.update({ where: { id: keyId }, data: { sensitive } });
  await recordAudit({ actorId: actor.id, action: sensitive ? "KEY_MARKED_SENSITIVE" : "KEY_MARKED_STANDARD", entityType: "Key", entityId: keyId });
}

/** Full issue history is only for a Key supervisor, Admin or Auditor when the key is sensitive. */
export async function keyHistory(actor: ActorLike, keyId: string) {
  const key = await prisma.key.findUnique({ where: { id: keyId } });
  if (!key) throw new KeyError("NOT_FOUND", "Key not found.");
  if (key.sensitive && !actorCan(actor, "keys.sensitive_history", { siteId: key.siteId }) && !actorAccess(actor, "keys.sensitive_history", { siteId: key.siteId })) throw new KeyError("FORBIDDEN", "The history of a sensitive key is limited to Key supervisors, Admins and Auditors.");
  return prisma.keyTransaction.findMany({ where: { keyId }, orderBy: { createdAt: "desc" }, take: 200 });
}

// ---------------------------------------------------------------------------
// Loss: report -> approval -> lock-change work order -> replacement key
// ---------------------------------------------------------------------------

export async function reportLoss(actor: ActorLike, keyId: string, note: string) {
  const key = await prisma.key.findUnique({ where: { id: keyId } });
  if (!key) throw new KeyError("NOT_FOUND", "Key not found.");
  if (!actorCan(actor, "keys.report_lost", { siteId: key.siteId }) && !(actorAccess(actor, "keys.report_lost", { siteId: key.siteId }))) throw new KeyError("FORBIDDEN", "Your role does not allow reporting lost keys.");
  await reportLost({ keyId, actorId: actor.id, notes: note });
  const lossCase = await prisma.keyLossCase.create({ data: { keyId, reportedById: actor.id, note: note.trim() } });
  const approvers = await prisma.user.findMany({ where: { status: "ACTIVE", roleAssignments: { some: { role: { in: ["ACCOMMODATION_ADMIN", "SYSTEM_ADMIN"] } } } }, select: { id: true } });
  await prisma.$transaction(async (tx) => {
    for (const a of approvers) await enqueueNotification(tx, { recipientId: a.id, event: "key.loss_reported", idempotencyKey: `key.loss:${lossCase.id}:${a.id}`, payload: { keyId, code: key.code, caseId: lossCase.id } });
    await recordAudit({ actorId: actor.id, action: "KEY_LOSS_REPORTED", entityType: "KeyLossCase", entityId: lossCase.id, after: { keyId, sensitive: key.sensitive } }, tx);
  });
  return lossCase;
}

/** Approve (and order a lock change) or reject a lost-key report. Not the person who reported it. */
export async function decideLoss(actor: ActorLike, caseId: string, approve: boolean, note?: string | null, opts: { orderLockChange?: boolean } = {}) {
  const c = await prisma.keyLossCase.findUnique({ where: { id: caseId } });
  if (!c) throw new KeyError("NOT_FOUND", "Loss case not found.");
  const key = await prisma.key.findUniqueOrThrow({ where: { id: c.keyId } });
  if (!actorCan(actor, "keys.loss_approve", { siteId: key.siteId })) throw new KeyError("FORBIDDEN", "Only a Key supervisor or an Admin can decide a key loss.");
  if (c.status !== "REPORTED") throw new KeyError("INVALID_STATE", "That loss has already been decided.");
  if (c.reportedById === actor.id) throw new KeyError("FORBIDDEN", "Someone else must decide a loss you reported.");
  if (!approve && !note?.trim()) throw new KeyError("VALIDATION", "Give a reason for rejecting.", { note: "Required." });
  let workOrderId: string | null = null;
  if (approve && opts.orderLockChange !== false) {
    const room = key.roomId ? await prisma.room.findUnique({ where: { id: key.roomId }, include: { building: true } }) : null;
    const wo = await createWorkOrder({ requesterId: actor.id, siteId: key.siteId, buildingId: room?.buildingId ?? null, roomId: key.roomId, locationNote: key.roomId ? null : `Lock for key ${key.code}`, category: "Doors and locks", description: `Change the lock for lost key ${key.code}${key.label ? ` (${key.label})` : ""}${key.sensitive ? ". SENSITIVE key: urgent." : "."}`, priority: key.sensitive ? "URGENT" : "HIGH" });
    workOrderId = wo.id;
  }
  // A contractor who loses a key: the charge goes to the vendor, not a resident (document 11).
  let chargeNote = "";
  if (approve) {
    const lost = await prisma.keyTransaction.findFirst({ where: { keyId: key.id, type: "LOST" }, orderBy: { createdAt: "desc" } });
    if (lost?.holderVendorId) {
      const org = await prisma.organization.findFirst({ select: { id: true } });
      const rate = await prisma.rate.findFirst({ where: { organizationId: org?.id, code: "KEY_LOSS", active: true } });
      if (rate) { await raiseCharge(actor, { vendorId: lost.holderVendorId, siteId: key.siteId, kind: rate.kind, description: `Lost key ${key.code}`, rateCode: "KEY_LOSS", sourceType: "KeyLossCase", sourceId: caseId }); chargeNote = "Charge raised against the vendor."; }
    }
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.keyLossCase.update({ where: { id: caseId }, data: { status: approve ? (workOrderId ? "LOCK_CHANGE_ORDERED" : "APPROVED") : "REJECTED", approvedById: actor.id, decidedAt: new Date(), decisionNote: [note?.trim(), chargeNote].filter(Boolean).join(" · ") || null, workOrderId } });
    await recordAudit({ actorId: actor.id, action: approve ? "KEY_LOSS_APPROVED" : "KEY_LOSS_REJECTED", entityType: "KeyLossCase", entityId: caseId, after: { workOrderId, note: note ?? null } }, tx);
    return updated;
  });
}

/** After the lock change: retire the lost key and register its replacement, closing the case. */
export async function completeLoss(actor: ActorLike, caseId: string, newCode: string) {
  const c = await prisma.keyLossCase.findUnique({ where: { id: caseId } });
  if (!c) throw new KeyError("NOT_FOUND", "Loss case not found.");
  const key = await prisma.key.findUniqueOrThrow({ where: { id: c.keyId } });
  if (!actorCan(actor, "keys.retire_replace", { siteId: key.siteId })) throw new KeyError("FORBIDDEN", "Only a Key supervisor or an Admin can replace a key.");
  if (c.status !== "APPROVED" && c.status !== "LOCK_CHANGE_ORDERED") throw new KeyError("INVALID_STATE", "Approve the loss first.");
  if (c.workOrderId) {
    const wo = await prisma.workOrder.findUnique({ where: { id: c.workOrderId }, select: { status: true } });
    if (wo && !["RESOLVED", "VERIFIED", "CLOSED"].includes(wo.status)) throw new KeyError("INVALID_STATE", "The lock-change work order is not finished yet.");
  }
  const replacement = await replaceKey({ keyId: key.id, actorId: actor.id, newCode, notes: "After lock change" });
  await prisma.keyLossCase.update({ where: { id: caseId }, data: { status: "CLOSED", replacementKeyId: replacement.id } });
  return replacement;
}

export async function listLossCases(opts: { open?: boolean } = {}) {
  const cases = await prisma.keyLossCase.findMany({ where: opts.open ? { status: { notIn: ["CLOSED", "REJECTED"] } } : {}, orderBy: { createdAt: "desc" }, take: 100 });
  const keys = new Map((await prisma.key.findMany({ where: { id: { in: cases.map((c) => c.keyId) } }, select: { id: true, code: true, label: true, sensitive: true, siteId: true } })).map((k) => [k.id, k]));
  return cases.map((c) => ({ ...c, key: keys.get(c.keyId)! }));
}

// ---------------------------------------------------------------------------
// Audit / reconciliation
// ---------------------------------------------------------------------------

type AuditSnapshot = Array<{ code: string; status: string; holder: string | null }>;

export async function startKeyAudit(actor: ActorLike, siteId: string) {
  if (!actorCan(actor, "keys.audit", { siteId })) throw new KeyError("FORBIDDEN", "Only a Key supervisor or an Admin can audit keys.");
  if (await prisma.keyAudit.findFirst({ where: { siteId, status: "IN_PROGRESS" } })) throw new KeyError("INVALID_STATE", "An audit is already in progress for this site.");
  const keys = await prisma.key.findMany({ where: { siteId, archivedAt: null, status: { not: "RETIRED" } }, include: { transactions: { where: { type: "ISSUE", returnedAt: null }, take: 1, include: { holder: true } } }, orderBy: { code: "asc" } });
  const expected: AuditSnapshot = keys.map((k) => ({ code: k.code, status: k.status, holder: k.transactions[0] ? (k.transactions[0].holder ? `${k.transactions[0].holder.firstName} ${k.transactions[0].holder.lastName}` : k.transactions[0].holderName) : null }));
  const audit = await prisma.keyAudit.create({ data: { siteId, startedById: actor.id, expected } });
  await recordAudit({ actorId: actor.id, action: "KEY_AUDIT_STARTED", entityType: "KeyAudit", entityId: audit.id, after: { keys: expected.length } });
  return audit;
}

/** `counted` lists the key codes physically found in the cabinet(s). Keys marked available but not found are missing. */
export async function completeKeyAudit(actor: ActorLike, auditId: string, counted: string[]) {
  const audit = await prisma.keyAudit.findUnique({ where: { id: auditId } });
  if (!audit) throw new KeyError("NOT_FOUND", "Audit not found.");
  if (!actorCan(actor, "keys.audit", { siteId: audit.siteId })) throw new KeyError("FORBIDDEN", "Only a Key supervisor or an Admin can audit keys.");
  if (audit.status !== "IN_PROGRESS") throw new KeyError("INVALID_STATE", "That audit is already complete.");
  const expected = audit.expected as unknown as AuditSnapshot;
  const found = new Set(counted.map((c) => c.trim()).filter(Boolean));
  const onShelf = expected.filter((e) => e.status === "AVAILABLE" || e.status === "UNDER_REPAIR");
  const missing = onShelf.filter((e) => !found.has(e.code)).map((e) => e.code);
  const unexpected = [...found].filter((c) => !onShelf.some((e) => e.code === c)).map((c) => ({ code: c, recorded: expected.find((e) => e.code === c)?.status ?? "NOT REGISTERED" }));
  const variances = { missing, unexpected, matched: onShelf.length - missing.length };
  return prisma.$transaction(async (tx) => {
    const done = await tx.keyAudit.update({ where: { id: auditId }, data: { status: "COMPLETED", counted: [...found], variances, completedAt: new Date(), completedById: actor.id } });
    await recordAudit({ actorId: actor.id, action: "KEY_AUDIT_COMPLETED", entityType: "KeyAudit", entityId: auditId, after: { missing: missing.length, unexpected: unexpected.length } }, tx);
    if (missing.length || unexpected.length) {
      const admins = await tx.user.findMany({ where: { status: "ACTIVE", roleAssignments: { some: { role: { in: ["ACCOMMODATION_ADMIN"] } } } }, select: { id: true } });
      for (const a of admins) await enqueueNotification(tx, { recipientId: a.id, event: "key.audit_variance", idempotencyKey: `key.audit:${auditId}:${a.id}`, payload: { auditId, missing: missing.length, unexpected: unexpected.length } });
    }
    return done;
  });
}

export const listKeyAudits = (siteIds?: string[] | null) => prisma.keyAudit.findMany({ where: siteIds ? { siteId: { in: siteIds } } : {}, orderBy: { startedAt: "desc" }, take: 30 });

// ---------------------------------------------------------------------------
// Bulk creation: copies per room
// ---------------------------------------------------------------------------

export async function bulkCreateKeys(actor: ActorLike, input: { siteId: string; buildingId?: string | null; roomIds?: string[]; copies: number; prefix?: string | null }) {
  if (!actorCan(actor, "keys.bulk_create", { siteId: input.siteId })) throw new KeyError("FORBIDDEN", "Bulk key creation needs an Accommodation Admin.");
  if (!Number.isInteger(input.copies) || input.copies < 1 || input.copies > 10) throw new KeyError("VALIDATION", "Copies must be between 1 and 10.", { copies: "1 to 10." });
  const rooms = await prisma.room.findMany({ where: { archivedAt: null, building: { siteId: input.siteId }, ...(input.roomIds?.length ? { id: { in: input.roomIds } } : input.buildingId ? { buildingId: input.buildingId } : {}) }, include: { building: true }, orderBy: [{ buildingId: "asc" }, { code: "asc" }], take: 2000 });
  if (rooms.length === 0) throw new KeyError("VALIDATION", "No rooms match.");
  let created = 0, skipped = 0;
  await prisma.$transaction(async (tx: Tx) => {
    for (const room of rooms) {
      for (let n = 1; n <= input.copies; n++) {
        const code = `${input.prefix?.trim() || ""}${room.code}-K${n}`;
        if (await tx.key.findUnique({ where: { siteId_code: { siteId: input.siteId, code } } })) { skipped++; continue; }
        await tx.key.create({ data: { siteId: input.siteId, code, label: `${room.building.name} ${room.code} copy ${n}`, roomId: room.id, allowCopies: input.copies > 1 } });
        created++;
      }
    }
    await recordAudit({ actorId: actor.id, action: "KEYS_BULK_CREATED", entityType: "Key", entityId: input.siteId, after: { rooms: rooms.length, copies: input.copies, created, skipped } }, tx);
  }, { timeout: 60_000 });
  return { rooms: rooms.length, created, skipped };
}
