// Key management (SRS 5.6, 8.5). Issue/return history is append-only at the
// database level; a key can have one open issue at a time.
import type { KeyStatus, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { enqueueNotification } from "@/lib/notifications";
import { KeyError } from "./errors";

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;

export const keyInclude = {
  site: true,
  room: { include: { building: true } },
  facility: true,
  replaces: { select: { id: true, code: true } },
  replacedBy: { select: { id: true, code: true } },
  transactions: {
    include: { holder: { select: { id: true, employeeId: true, firstName: true, lastName: true, userId: true } }, custodian: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.KeyInclude;

export type KeyRecord = Prisma.KeyGetPayload<{ include: typeof keyInclude }>;
export type KeyTransactionRecord = KeyRecord["transactions"][number];

export const CONDITIONS = ["Good", "Worn", "Damaged"] as const;

export function openIssue(key: Pick<KeyRecord, "transactions">): KeyTransactionRecord | null {
  return key.transactions.find((t) => t.type === "ISSUE" && t.returnedAt === null) ?? null;
}

export function holderLabel(t: Pick<KeyTransactionRecord, "holder" | "holderName">): string {
  return t.holder ? `${t.holder.firstName} ${t.holder.lastName} (${t.holder.employeeId})` : (t.holderName ?? "Unknown holder");
}

export function isOverdue(t: Pick<KeyTransactionRecord, "expectedReturnAt" | "returnedAt">, now: Date = new Date()): boolean {
  return t.returnedAt === null && !!t.expectedReturnAt && t.expectedReturnAt < now;
}

function translateDbError(error: unknown): never {
  const e = error as { code?: string; message?: string; meta?: { target?: unknown; modelName?: string } };
  if (e?.code === "P2002") {
    const target = `${e.meta?.modelName ?? ""} ${JSON.stringify(e.meta?.target ?? "")} ${e.message ?? ""}`;
    if (/KeyTransaction|one_open_issue/.test(target)) throw new KeyError("CONFLICT", "This key was issued to someone else a moment ago.");
    if (/\bKey\b|siteId|code/.test(target)) throw new KeyError("VALIDATION", "A key with that code already exists at this site.", { code: "Already used at this site." });
  }
  throw error;
}

// ---------------------------------------------------------------------------
// Register (KEY-01)
// ---------------------------------------------------------------------------

export type RegisterInput = { siteId: string; code: string; label?: string | null; roomId?: string | null; facilityId?: string | null; allowCopies?: boolean; notes?: string | null; actorId: string; replacesKeyId?: string | null };

async function registerTx(tx: Tx, input: RegisterInput) {
  const code = input.code.trim();
  const errors: Record<string, string> = {};
  if (!code) errors.code = "Enter a key code.";
  if (code.length > 40) errors.code = "Key code is too long.";
  if (input.roomId && input.facilityId) errors.roomId = "Link a key to a room or a facility, not both.";
  if (Object.keys(errors).length) throw new KeyError("VALIDATION", "Please correct the highlighted fields.", errors);
  // A key linked to a room or facility belongs to that location's site.
  let siteId = input.siteId;
  if (input.roomId) {
    const room = await tx.room.findUnique({ where: { id: input.roomId }, include: { building: true } });
    if (!room) throw new KeyError("VALIDATION", "Unknown room.", { roomId: "Unknown room." });
    siteId = room.building.siteId;
  } else if (input.facilityId) {
    const facility = await tx.facility.findUnique({ where: { id: input.facilityId } });
    if (!facility) throw new KeyError("VALIDATION", "Unknown facility.", { facilityId: "Unknown facility." });
    siteId = facility.siteId;
  }
  if (!siteId) throw new KeyError("VALIDATION", "Choose a site, room or facility.", { siteId: "Required." });
  const key = await tx.key.create({
    data: { siteId, code, label: input.label?.trim() || null, roomId: input.roomId || null, facilityId: input.facilityId || null, allowCopies: !!input.allowCopies, notes: input.notes?.trim() || null, replacesKeyId: input.replacesKeyId ?? null },
  });
  await recordAudit({ actorId: input.actorId, action: "KEY_REGISTERED", entityType: "Key", entityId: key.id, after: { code, roomId: key.roomId, facilityId: key.facilityId, replacesKeyId: key.replacesKeyId } }, tx);
  return key;
}

export async function registerKey(input: RegisterInput) {
  try {
    return await prisma.$transaction((tx) => registerTx(tx, input));
  } catch (error) {
    translateDbError(error);
  }
}

// ---------------------------------------------------------------------------
// Issue / return (KEY-02, KEY-03)
// ---------------------------------------------------------------------------

export type IssueInput = { keyId: string; actorId: string; holderStaffId?: string | null; holderName?: string | null; condition?: string | null; expectedReturnAt?: string | null; notes?: string | null };

export async function issueKey(input: IssueInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const key = await tx.key.findUnique({ where: { id: input.keyId }, include: keyInclude });
      if (!key) throw new KeyError("NOT_FOUND", "Key not found.");
      if (key.status !== "AVAILABLE") throw new KeyError("INVALID_STATE", `Key ${key.code} is ${key.status.toLowerCase().replace("_", " ")} and cannot be issued.`);
      if (openIssue(key)) throw new KeyError("INVALID_STATE", `Key ${key.code} is already held by ${holderLabel(openIssue(key)!)}.`);
      const holderName = input.holderName?.trim() || null;
      if (!input.holderStaffId && !holderName) throw new KeyError("VALIDATION", "Choose a resident or enter the holder's name.", { holder: "Required." });
      let holderUserId: string | null = null;
      if (input.holderStaffId) {
        const staff = await tx.staffProfile.findUnique({ where: { id: input.holderStaffId } });
        if (!staff) throw new KeyError("VALIDATION", "Unknown staff member.", { holder: "Unknown staff member." });
        if (staff.employmentStatus !== "ACTIVE") throw new KeyError("VALIDATION", `${staff.firstName} ${staff.lastName} is not an active employee.`, { holder: "Not active." });
        holderUserId = staff.userId;
      }
      let expectedReturnAt: Date | null = null;
      if (input.expectedReturnAt) {
        if (Number.isNaN(Date.parse(input.expectedReturnAt))) throw new KeyError("VALIDATION", "Enter a valid expected return date.", { expectedReturnAt: "Invalid date." });
        expectedReturnAt = new Date(`${input.expectedReturnAt}T23:59:59.000Z`);
      }
      const txn = await tx.keyTransaction.create({
        data: { keyId: key.id, type: "ISSUE", holderId: input.holderStaffId || null, holderName: input.holderStaffId ? null : holderName, custodianId: input.actorId, condition: input.condition?.trim() || "Good", expectedReturnAt, notes: input.notes?.trim() || null },
      });
      await tx.key.update({ where: { id: key.id }, data: { status: "ISSUED" } });
      await recordAudit({ actorId: input.actorId, action: "KEY_ISSUED", entityType: "Key", entityId: key.id, after: { transactionId: txn.id, holderId: txn.holderId, holderName: txn.holderName, expectedReturnAt: input.expectedReturnAt ?? null } }, tx);
      if (holderUserId) {
        await enqueueNotification(tx, { recipientId: holderUserId, event: "key.issued", idempotencyKey: `key.issued:${txn.id}`, payload: { keyId: key.id, code: key.code, label: key.label, expectedReturnAt: input.expectedReturnAt ?? null } });
      }
      return txn;
    });
  } catch (error) {
    translateDbError(error);
  }
}

export type ReturnInput = { keyId: string; actorId: string; condition?: string | null; notes?: string | null };

export async function returnKey(input: ReturnInput) {
  return prisma.$transaction(async (tx) => {
    const key = await tx.key.findUnique({ where: { id: input.keyId }, include: keyInclude });
    if (!key) throw new KeyError("NOT_FOUND", "Key not found.");
    const issue = openIssue(key);
    if (!issue) throw new KeyError("INVALID_STATE", `Key ${key.code} is not currently issued.`);
    if (key.status === "LOST") throw new KeyError("INVALID_STATE", "This key was reported lost. If it has been found, record it as found first.");
    const condition = input.condition?.trim() || "Good";
    const damaged = condition.toLowerCase() === "damaged";
    const now = new Date();
    await tx.keyTransaction.update({ where: { id: issue.id }, data: { returnedAt: now } });
    const txn = await tx.keyTransaction.create({ data: { keyId: key.id, type: "RETURN", holderId: issue.holderId, holderName: issue.holderName, custodianId: input.actorId, condition, notes: input.notes?.trim() || null, returnedAt: now } });
    if (damaged) {
      await tx.keyTransaction.create({ data: { keyId: key.id, type: "DAMAGED", holderId: issue.holderId, holderName: issue.holderName, custodianId: input.actorId, condition, notes: "Returned damaged", returnedAt: now } });
    }
    await tx.key.update({ where: { id: key.id }, data: { status: damaged ? "DAMAGED" : "AVAILABLE" } });
    await recordAudit({ actorId: input.actorId, action: "KEY_RETURNED", entityType: "Key", entityId: key.id, after: { transactionId: txn.id, condition, damaged, overdue: isOverdue(issue, now) } }, tx);
    if (issue.holder?.userId) {
      await enqueueNotification(tx, { recipientId: issue.holder.userId, event: "key.returned", idempotencyKey: `key.returned:${txn.id}`, payload: { keyId: key.id, code: key.code, condition } });
    }
    return txn;
  });
}

// ---------------------------------------------------------------------------
// Exceptions (KEY-04): lost, damaged, repair, replacement, retirement
// ---------------------------------------------------------------------------

export type ExceptionInput = { keyId: string; actorId: string; notes: string; incidentRef?: string | null };

/** Marks a key lost. An open issue stays open so the holder remains accountable until replacement. */
export async function reportLost(input: ExceptionInput) {
  return prisma.$transaction(async (tx) => {
    const key = await tx.key.findUnique({ where: { id: input.keyId }, include: keyInclude });
    if (!key) throw new KeyError("NOT_FOUND", "Key not found.");
    if (key.status === "LOST" || key.status === "RETIRED") throw new KeyError("INVALID_STATE", `Key ${key.code} is already ${key.status.toLowerCase()}.`);
    const notes = input.notes?.trim();
    if (!notes) throw new KeyError("VALIDATION", "Describe the incident.", { notes: "Required." });
    const issue = openIssue(key);
    const txn = await tx.keyTransaction.create({ data: { keyId: key.id, type: "LOST", holderId: issue?.holderId ?? null, holderName: issue?.holderName ?? null, custodianId: input.actorId, notes: input.incidentRef ? `${notes} (incident ${input.incidentRef.trim()})` : notes } });
    await tx.key.update({ where: { id: key.id }, data: { status: "LOST" } });
    await recordAudit({ actorId: input.actorId, action: "KEY_LOST", entityType: "Key", entityId: key.id, before: { status: key.status }, after: { transactionId: txn.id, holderId: issue?.holderId ?? null, notes } }, tx);
    return txn;
  });
}

/** A lost key that turns up: closes the exception and makes it available (or returns it if still issued). */
export async function markFound(input: ExceptionInput) {
  return prisma.$transaction(async (tx) => {
    const key = await tx.key.findUnique({ where: { id: input.keyId }, include: keyInclude });
    if (!key) throw new KeyError("NOT_FOUND", "Key not found.");
    if (key.status !== "LOST") throw new KeyError("INVALID_STATE", `Key ${key.code} is not recorded as lost.`);
    const issue = openIssue(key);
    const now = new Date();
    if (issue) {
      await tx.keyTransaction.update({ where: { id: issue.id }, data: { returnedAt: now } });
      await tx.keyTransaction.create({ data: { keyId: key.id, type: "RETURN", holderId: issue.holderId, holderName: issue.holderName, custodianId: input.actorId, condition: "Good", notes: `Found: ${input.notes?.trim() || ""}`.trim(), returnedAt: now } });
    } else {
      await tx.keyTransaction.create({ data: { keyId: key.id, type: "REPAIR", custodianId: input.actorId, notes: `Found: ${input.notes?.trim() || ""}`.trim() } });
    }
    await tx.key.update({ where: { id: key.id }, data: { status: "AVAILABLE" } });
    await recordAudit({ actorId: input.actorId, action: "KEY_FOUND", entityType: "Key", entityId: key.id, after: { notes: input.notes } }, tx);
  });
}

export async function reportDamaged(input: ExceptionInput) {
  return prisma.$transaction(async (tx) => {
    const key = await tx.key.findUnique({ where: { id: input.keyId }, include: keyInclude });
    if (!key) throw new KeyError("NOT_FOUND", "Key not found.");
    if (key.status !== "AVAILABLE") throw new KeyError("INVALID_STATE", `Only an available key can be marked damaged (this one is ${key.status.toLowerCase().replace("_", " ")}). Return an issued key as damaged instead.`);
    const notes = input.notes?.trim();
    if (!notes) throw new KeyError("VALIDATION", "Describe the damage.", { notes: "Required." });
    await tx.keyTransaction.create({ data: { keyId: key.id, type: "DAMAGED", custodianId: input.actorId, condition: "Damaged", notes } });
    await tx.key.update({ where: { id: key.id }, data: { status: "DAMAGED" } });
    await recordAudit({ actorId: input.actorId, action: "KEY_DAMAGED", entityType: "Key", entityId: key.id, after: { notes } }, tx);
  });
}

export async function setRepairState(input: { keyId: string; actorId: string; state: "UNDER_REPAIR" | "AVAILABLE"; notes?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const key = await tx.key.findUnique({ where: { id: input.keyId } });
    if (!key) throw new KeyError("NOT_FOUND", "Key not found.");
    const valid = (input.state === "UNDER_REPAIR" && key.status === "DAMAGED") || (input.state === "AVAILABLE" && key.status === "UNDER_REPAIR");
    if (!valid) throw new KeyError("INVALID_STATE", `Cannot move a ${key.status.toLowerCase().replace("_", " ")} key to ${input.state.toLowerCase().replace("_", " ")}.`);
    await tx.keyTransaction.create({ data: { keyId: key.id, type: "REPAIR", custodianId: input.actorId, notes: input.state === "UNDER_REPAIR" ? `Sent for repair${input.notes ? `: ${input.notes.trim()}` : ""}` : `Back from repair${input.notes ? `: ${input.notes.trim()}` : ""}` } });
    await tx.key.update({ where: { id: key.id }, data: { status: input.state } });
    await recordAudit({ actorId: input.actorId, action: "KEY_REPAIR", entityType: "Key", entityId: key.id, before: { status: key.status }, after: { status: input.state, notes: input.notes ?? null } }, tx);
  });
}

/** Replaces a lost or damaged key: the old key is retired, any open issue closed, and a new key registered. */
export async function replaceKey(input: { keyId: string; actorId: string; newCode: string; notes?: string | null }) {
  try {
    return await prisma.$transaction(async (tx) => {
      const key = await tx.key.findUnique({ where: { id: input.keyId }, include: keyInclude });
      if (!key) throw new KeyError("NOT_FOUND", "Key not found.");
      if (!["LOST", "DAMAGED", "UNDER_REPAIR"].includes(key.status)) throw new KeyError("INVALID_STATE", `Only lost, damaged or under-repair keys can be replaced (this one is ${key.status.toLowerCase()}).`);
      const issue = openIssue(key);
      const now = new Date();
      if (issue) await tx.keyTransaction.update({ where: { id: issue.id }, data: { returnedAt: now, notes: [issue.notes, "Closed on replacement"].filter(Boolean).join(" · ") } });
      const replacement = await registerTx(tx, { siteId: key.siteId, code: input.newCode, label: key.label, roomId: key.roomId, facilityId: key.facilityId, allowCopies: key.allowCopies, notes: `Replaces ${key.code}`, actorId: input.actorId, replacesKeyId: key.id });
      await tx.keyTransaction.create({ data: { keyId: key.id, type: "REPLACED", holderId: issue?.holderId ?? null, holderName: issue?.holderName ?? null, custodianId: input.actorId, notes: `Replaced by ${replacement.code}${input.notes ? `: ${input.notes.trim()}` : ""}` } });
      await tx.key.update({ where: { id: key.id }, data: { status: "RETIRED" } });
      await recordAudit({ actorId: input.actorId, action: "KEY_REPLACED", entityType: "Key", entityId: key.id, after: { replacementId: replacement.id, replacementCode: replacement.code, closedIssueId: issue?.id ?? null } }, tx);
      return replacement;
    });
  } catch (error) {
    translateDbError(error);
  }
}

export async function retireKey(input: ExceptionInput) {
  return prisma.$transaction(async (tx) => {
    const key = await tx.key.findUnique({ where: { id: input.keyId }, include: keyInclude });
    if (!key) throw new KeyError("NOT_FOUND", "Key not found.");
    if (key.status === "RETIRED") throw new KeyError("INVALID_STATE", "Already retired.");
    if (openIssue(key)) throw new KeyError("INVALID_STATE", "Return the key (or record it lost and replace it) before retiring it.");
    await tx.keyTransaction.create({ data: { keyId: key.id, type: "RETIRE", custodianId: input.actorId, notes: input.notes?.trim() || "Decommissioned" } });
    await tx.key.update({ where: { id: key.id }, data: { status: "RETIRED" } });
    await recordAudit({ actorId: input.actorId, action: "KEY_RETIRED", entityType: "Key", entityId: key.id, before: { status: key.status }, after: { notes: input.notes ?? null } }, tx);
  });
}

// ---------------------------------------------------------------------------
// Queries and reports (KEY-03, KEY-05, KEY-06)
// ---------------------------------------------------------------------------

export type KeyFilter = "all" | "available" | "issued" | "overdue" | "exceptions" | "retired";

export async function listKeys(filter: KeyFilter, siteId?: string | null, now: Date = new Date()) {
  const byStatus: Prisma.KeyWhereInput =
    filter === "available" ? { status: "AVAILABLE" }
    : filter === "issued" || filter === "overdue" ? { status: { in: ["ISSUED", "LOST"] }, transactions: { some: { type: "ISSUE", returnedAt: null } } }
    : filter === "exceptions" ? { status: { in: ["LOST", "DAMAGED", "UNDER_REPAIR"] } }
    : filter === "retired" ? { status: "RETIRED" }
    : { status: { not: "RETIRED" } };
  const keys = await prisma.key.findMany({ where: { ...byStatus, ...(siteId ? { siteId } : {}) }, include: keyInclude, orderBy: [{ site: { code: "asc" } }, { code: "asc" }] });
  const rows = keys.map((key) => ({ key, issue: openIssue(key) }));
  return filter === "overdue" ? rows.filter((r) => r.issue && isOverdue(r.issue, now)) : rows;
}

export async function getKey(id: string, db: Db = prisma) {
  return db.key.findUnique({ where: { id }, include: keyInclude });
}

/** Keys currently held by a resident (open issues), for My stay and clearance. */
export async function keysHeldBy(staffId: string, db: Db = prisma) {
  return db.keyTransaction.findMany({ where: { holderId: staffId, type: "ISSUE", returnedAt: null }, include: { key: { include: { room: { include: { building: true } }, facility: true } } }, orderBy: { createdAt: "asc" } });
}

/** Keys linked to a room, with their open issue, for handover at check-in/out (KEY-05). */
export async function keysForRoom(roomId: string, db: Db = prisma) {
  const keys = await db.key.findMany({ where: { roomId, status: { not: "RETIRED" } }, include: keyInclude, orderBy: { code: "asc" } });
  return keys.map((key) => ({ key, issue: openIssue(key) }));
}

export async function keySummary(siteId?: string | null, now: Date = new Date()) {
  const all = await listKeys("all", siteId, now);
  const issued = all.filter((r) => r.issue);
  return {
    total: all.length,
    available: all.filter((r) => r.key.status === "AVAILABLE").length,
    issued: issued.length,
    overdue: issued.filter((r) => isOverdue(r.issue!, now)).length,
    exceptions: all.filter((r) => ["LOST", "DAMAGED", "UNDER_REPAIR"].includes(r.key.status)).length,
  };
}

export function describeKeyStatus(status: KeyStatus): string {
  return { AVAILABLE: "Available", ISSUED: "Issued", LOST: "Lost", DAMAGED: "Damaged", UNDER_REPAIR: "Under repair", RETIRED: "Retired" }[status];
}

export function keyLocation(key: Pick<KeyRecord, "room" | "facility" | "site">): string {
  if (key.room) return `${key.room.building.name} · Room ${key.room.code}`;
  if (key.facility) return `Facility · ${key.facility.name}`;
  return key.site.name;
}
