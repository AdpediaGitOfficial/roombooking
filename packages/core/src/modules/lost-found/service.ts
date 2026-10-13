// Lost and found (SRS 5.8, status model 8.6). Found items get a unique
// reference and move Reported → Stored → Claim pending → Returned, or are
// Disposed once their retention period has passed. Claims and the timeline
// are permanent; claimant details are only shown to authorised users.
import type { ClaimOutcome, LostFoundStatus, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { storeImage, UploadError } from "../../lib/uploads";
import { pageArgs, toPaged, type PageRequest } from "../../lib/paging";
import { LostFoundError } from "./errors";
import { OPEN, RETENTION_DAYS, claimantLabel, itemInclude, keywords, type Actor, type ItemFilter } from "./rules";

export * from "./rules";

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;

function translateDbError(error: unknown): never {
  const e = error as { code?: string; message?: string; meta?: { target?: unknown } };
  if (e?.code === "P2002" && /one_pending_per_user|claimantUserId/.test(`${JSON.stringify(e.meta?.target ?? "")} ${e.message ?? ""}`)) throw new LostFoundError("CONFLICT", "You already have a claim pending on this item.");
  throw error;
}

async function nextReference(tx: Tx): Promise<string> {
  const [{ nextval }] = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('"LostFoundItem_ref_seq"')`;
  return `LF-${String(nextval).padStart(6, "0")}`;
}

async function logEvent(tx: Tx, itemId: string, type: string, actorId: string, from: LostFoundStatus | null, to: LostFoundStatus | null, notes?: string | null) {
  await tx.lostFoundEvent.create({ data: { itemId, type, actorId, fromStatus: from, toStatus: to, notes: notes?.trim() || null } });
}

// ---------------------------------------------------------------------------
// Register and store (LF-01, LF-02)
// ---------------------------------------------------------------------------

export type RegisterInput = {
  siteId: string; actorId: string; description: string; category?: string | null; foundLocation?: string | null; foundAt: string; foundByName?: string | null;
  storageLocation?: string | null; notes?: string | null; retentionDays?: number | null; photos?: Array<{ bytes: Uint8Array; fileName: string }>; now?: Date;
};

export async function registerItem(input: RegisterInput) {
  const now = input.now ?? new Date();
  const errors: Record<string, string> = {};
  if (!input.description.trim()) errors.description = "Describe the item.";
  const foundAt = new Date(input.foundAt);
  if (!input.foundAt || Number.isNaN(foundAt.getTime())) errors.foundAt = "Enter when it was found.";
  else if (foundAt > new Date(now.getTime() + 5 * 60000)) errors.foundAt = "The found time cannot be in the future.";
  if (input.retentionDays != null && (!Number.isInteger(input.retentionDays) || input.retentionDays < 1)) errors.retentionDays = "Enter a whole number of days.";
  if (Object.keys(errors).length) throw new LostFoundError("VALIDATION", "Please correct the highlighted fields.", errors);
  const days = input.retentionDays ?? RETENTION_DAYS;
  const stored = !!input.storageLocation?.trim();
  try {
    return await prisma.$transaction(async (tx) => {
      const item = await tx.lostFoundItem.create({
        data: {
          siteId: input.siteId, reference: await nextReference(tx), description: input.description.trim(), category: input.category?.trim() || null, foundLocation: input.foundLocation?.trim() || null,
          foundAt, foundByName: input.foundByName?.trim() || null, custodianId: input.actorId, registeredById: input.actorId, storageLocation: input.storageLocation?.trim() || null,
          status: stored ? "STORED" : "REPORTED", notes: input.notes?.trim() || null, retainUntil: new Date(foundAt.getTime() + days * 86400000),
        },
      });
      for (const photo of input.photos ?? []) await storeImage(tx, { bytes: photo.bytes, fileName: photo.fileName, entityType: "LostFoundItem", entityId: item.id, uploadedById: input.actorId });
      await logEvent(tx, item.id, "REGISTERED", input.actorId, null, item.status, stored ? `Stored at ${item.storageLocation}` : null);
      await recordAudit({ actorId: input.actorId, action: "LOST_FOUND_REGISTERED", entityType: "LostFoundItem", entityId: item.id, after: { reference: item.reference, description: item.description, category: item.category, foundLocation: item.foundLocation, foundAt: foundAt.toISOString(), status: item.status, photos: input.photos?.length ?? 0 } }, tx);
      return item;
    });
  } catch (e) {
    if (e instanceof UploadError) throw new LostFoundError("VALIDATION", e.message, { photos: e.message });
    throw e;
  }
}

export type UpdateInput = { itemId: string; actorId: string; description: string; category?: string | null; foundLocation?: string | null; foundByName?: string | null; notes?: string | null; retainUntil?: string | null };

export async function updateItem(input: UpdateInput) {
  if (!input.description.trim()) throw new LostFoundError("VALIDATION", "Describe the item.", { description: "Required." });
  const retainUntil = input.retainUntil ? new Date(`${input.retainUntil}T23:59:59.000Z`) : undefined;
  if (retainUntil && Number.isNaN(retainUntil.getTime())) throw new LostFoundError("VALIDATION", "Enter a valid retention date.", { retainUntil: "Invalid date." });
  return prisma.$transaction(async (tx) => {
    const before = await tx.lostFoundItem.findUnique({ where: { id: input.itemId } });
    if (!before) throw new LostFoundError("NOT_FOUND", "Item not found.");
    if (before.status === "RETURNED" || before.status === "DISPOSED") throw new LostFoundError("INVALID_STATE", "Closed items cannot be edited.");
    const after = await tx.lostFoundItem.update({ where: { id: input.itemId }, data: { description: input.description.trim(), category: input.category?.trim() || null, foundLocation: input.foundLocation?.trim() || null, foundByName: input.foundByName?.trim() || null, notes: input.notes?.trim() || null, ...(retainUntil ? { retainUntil } : {}) } });
    await logEvent(tx, after.id, "UPDATED", input.actorId, null, null, "Details updated");
    await recordAudit({ actorId: input.actorId, action: "LOST_FOUND_UPDATED", entityType: "LostFoundItem", entityId: after.id, before: { description: before.description, category: before.category, foundLocation: before.foundLocation, retainUntil: before.retainUntil?.toISOString() ?? null }, after: { description: after.description, category: after.category, foundLocation: after.foundLocation, retainUntil: after.retainUntil?.toISOString() ?? null } }, tx);
    return after;
  });
}

/** Puts the item into storage (or moves it) and makes the actor its custodian. */
export async function storeItem(input: { itemId: string; actorId: string; storageLocation: string; notes?: string | null }) {
  if (!input.storageLocation.trim()) throw new LostFoundError("VALIDATION", "Enter where the item is stored.", { storageLocation: "Required." });
  return prisma.$transaction(async (tx) => {
    const item = await tx.lostFoundItem.findUnique({ where: { id: input.itemId } });
    if (!item) throw new LostFoundError("NOT_FOUND", "Item not found.");
    if (!["REPORTED", "STORED", "CLAIM_PENDING"].includes(item.status)) throw new LostFoundError("INVALID_STATE", "Closed items cannot be moved.");
    const to: LostFoundStatus = item.status === "REPORTED" ? "STORED" : item.status;
    const updated = await tx.lostFoundItem.update({ where: { id: item.id }, data: { storageLocation: input.storageLocation.trim(), custodianId: input.actorId, status: to } });
    await logEvent(tx, item.id, "STORED", input.actorId, item.status, to, `Stored at ${updated.storageLocation}${input.notes?.trim() ? ` · ${input.notes.trim()}` : ""}`);
    await recordAudit({ actorId: input.actorId, action: "LOST_FOUND_STORED", entityType: "LostFoundItem", entityId: item.id, before: { status: item.status, storageLocation: item.storageLocation, custodianId: item.custodianId }, after: { status: to, storageLocation: updated.storageLocation, custodianId: input.actorId } }, tx);
    return updated;
  });
}

export async function addPhoto(input: { itemId: string; actorId: string; photo: { bytes: Uint8Array; fileName: string } }) {
  try {
    return await prisma.$transaction(async (tx) => {
      const item = await tx.lostFoundItem.findUnique({ where: { id: input.itemId } });
      if (!item) throw new LostFoundError("NOT_FOUND", "Item not found.");
      const a = await storeImage(tx, { bytes: input.photo.bytes, fileName: input.photo.fileName, entityType: "LostFoundItem", entityId: item.id, uploadedById: input.actorId });
      await logEvent(tx, item.id, "PHOTO_ADDED", input.actorId, null, null, a.fileName);
      return a;
    });
  } catch (e) {
    if (e instanceof UploadError) throw new LostFoundError("VALIDATION", e.message, { photo: e.message });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Claims (LF-03)
// ---------------------------------------------------------------------------

export type ClaimInput = {
  itemId: string; actor: Actor; evidence: string;
  /** Resident claiming for themselves (self-service) or recorded by an operator. */
  claimantId?: string | null; claimantUserId?: string | null; claimantName?: string | null; claimantContact?: string | null;
};

export async function submitClaim(input: ClaimInput) {
  const errors: Record<string, string> = {};
  if (!input.evidence.trim() || input.evidence.trim().length < 10) errors.evidence = "Describe the item in enough detail to show it is yours (at least 10 characters).";
  if (!input.claimantId && !input.claimantUserId && !input.claimantName?.trim()) errors.claimantName = "Enter the claimant's name.";
  if (Object.keys(errors).length) throw new LostFoundError("VALIDATION", Object.values(errors)[0], errors);
  try {
    return await prisma.$transaction(async (tx) => {
      const item = await tx.lostFoundItem.findUnique({ where: { id: input.itemId } });
      if (!item) throw new LostFoundError("NOT_FOUND", "Item not found.");
      if (!["REPORTED", "STORED", "CLAIM_PENDING"].includes(item.status)) throw new LostFoundError("INVALID_STATE", "This item is no longer available to claim.");
      const claim = await tx.lostFoundClaim.create({ data: { itemId: item.id, claimantId: input.claimantId || null, claimantUserId: input.claimantUserId || null, claimantName: input.claimantName?.trim() || null, claimantContact: input.claimantContact?.trim() || null, evidence: input.evidence.trim() } });
      await tx.lostFoundItem.update({ where: { id: item.id }, data: { status: "CLAIM_PENDING" } });
      await logEvent(tx, item.id, "CLAIM_SUBMITTED", input.actor.id, item.status, "CLAIM_PENDING", `Claim by ${input.claimantName?.trim() || "a resident"}`);
      await recordAudit({ actorId: input.actor.id, action: "LOST_FOUND_CLAIM_SUBMITTED", entityType: "LostFoundItem", entityId: item.id, after: { claimId: claim.id, claimantId: input.claimantId ?? null, claimantUserId: input.claimantUserId ?? null } }, tx);
      return claim;
    });
  } catch (e) { translateDbError(e); }
}

/** Operator verifies or rejects a claim. Rejection needs a reason; the item stays pending while other claims are open. */
export async function decideClaim(input: { claimId: string; actor: Actor; verified: boolean; note?: string | null }) {
  if (!input.actor.isOperator) throw new LostFoundError("FORBIDDEN", "Only lost and found staff can verify claims.");
  if (!input.verified && !input.note?.trim()) throw new LostFoundError("VALIDATION", "Give a reason for rejecting the claim.", { note: "Required." });
  return prisma.$transaction(async (tx) => {
    const claim = await tx.lostFoundClaim.findUnique({ where: { id: input.claimId }, include: { item: true, claimant: true } });
    if (!claim) throw new LostFoundError("NOT_FOUND", "Claim not found.");
    if (claim.outcome !== "PENDING") throw new LostFoundError("INVALID_STATE", "This claim has already been decided.");
    if (claim.item.status !== "CLAIM_PENDING") throw new LostFoundError("INVALID_STATE", "The item is no longer awaiting a claim decision.");
    const outcome: ClaimOutcome = input.verified ? "VERIFIED" : "REJECTED";
    const now = new Date();
    const updated = await tx.lostFoundClaim.update({ where: { id: claim.id }, data: { outcome, decidedById: input.actor.id, decidedAt: now, decisionNote: input.note?.trim() || null } });
    let itemStatus: LostFoundStatus = claim.item.status;
    if (input.verified) {
      // Other open claims on the item lose: the owner has been identified.
      const losers = await tx.lostFoundClaim.findMany({ where: { itemId: claim.itemId, outcome: "PENDING", id: { not: claim.id } }, include: { claimant: { select: { userId: true } } } });
      await tx.lostFoundClaim.updateMany({ where: { id: { in: losers.map((l) => l.id) } }, data: { outcome: "REJECTED", decidedById: input.actor.id, decidedAt: now, decisionNote: "Another claim was verified" } });
      for (const l of losers) {
        const to = l.claimantUserId ?? l.claimant?.userId ?? null;
        if (to) await enqueueNotification(tx, { recipientId: to, event: "lostfound.claim_rejected", idempotencyKey: `lostfound.claim:${l.id}:REJECTED`, payload: { itemId: claim.itemId, reference: claim.item.reference, description: claim.item.description, reason: "Another claim was verified" } });
      }
      await tx.lostFoundItem.update({ where: { id: claim.itemId }, data: { resolvedClaimId: claim.id } });
    } else if ((await tx.lostFoundClaim.count({ where: { itemId: claim.itemId, outcome: "PENDING" } })) === 0) {
      itemStatus = claim.item.storageLocation ? "STORED" : "REPORTED";
      await tx.lostFoundItem.update({ where: { id: claim.itemId }, data: { status: itemStatus } });
    }
    await logEvent(tx, claim.itemId, input.verified ? "CLAIM_VERIFIED" : "CLAIM_REJECTED", input.actor.id, claim.item.status, itemStatus, input.note);
    await recordAudit({ actorId: input.actor.id, action: input.verified ? "LOST_FOUND_CLAIM_VERIFIED" : "LOST_FOUND_CLAIM_REJECTED", entityType: "LostFoundItem", entityId: claim.itemId, after: { claimId: claim.id, note: input.note ?? null } }, tx);
    const recipient = claim.claimantUserId ?? claim.claimant?.userId ?? null;
    if (recipient) await enqueueNotification(tx, { recipientId: recipient, event: input.verified ? "lostfound.claim_verified" : "lostfound.claim_rejected", idempotencyKey: `lostfound.claim:${claim.id}:${outcome}`, payload: { itemId: claim.itemId, reference: claim.item.reference, description: claim.item.description, storageLocation: claim.item.storageLocation, reason: input.note ?? null } });
    return updated;
  });
}

export async function withdrawClaim(input: { claimId: string; actor: Actor }) {
  return prisma.$transaction(async (tx) => {
    const claim = await tx.lostFoundClaim.findUnique({ where: { id: input.claimId }, include: { item: true } });
    if (!claim) throw new LostFoundError("NOT_FOUND", "Claim not found.");
    if (claim.claimantUserId !== input.actor.id && !input.actor.isOperator) throw new LostFoundError("FORBIDDEN", "You can only withdraw your own claim.");
    if (claim.outcome !== "PENDING") throw new LostFoundError("INVALID_STATE", "This claim has already been decided.");
    await tx.lostFoundClaim.update({ where: { id: claim.id }, data: { outcome: "WITHDRAWN", decidedAt: new Date(), decidedById: input.actor.id } });
    let itemStatus = claim.item.status;
    if ((await tx.lostFoundClaim.count({ where: { itemId: claim.itemId, outcome: "PENDING" } })) === 0 && claim.item.status === "CLAIM_PENDING") {
      itemStatus = claim.item.storageLocation ? "STORED" : "REPORTED";
      await tx.lostFoundItem.update({ where: { id: claim.itemId }, data: { status: itemStatus } });
    }
    await logEvent(tx, claim.itemId, "CLAIM_WITHDRAWN", input.actor.id, claim.item.status, itemStatus);
    await recordAudit({ actorId: input.actor.id, action: "LOST_FOUND_CLAIM_WITHDRAWN", entityType: "LostFoundItem", entityId: claim.itemId, after: { claimId: claim.id } }, tx);
  });
}

// ---------------------------------------------------------------------------
// Handover and disposal (LF-04)
// ---------------------------------------------------------------------------

export async function handOver(input: { itemId: string; actor: Actor; recipientName?: string | null; note?: string | null; evidence?: { bytes: Uint8Array; fileName: string } | null }) {
  if (!input.actor.isOperator) throw new LostFoundError("FORBIDDEN", "Only lost and found staff can record a handover.");
  try {
    return await prisma.$transaction(async (tx) => {
      const item = await tx.lostFoundItem.findUnique({ where: { id: input.itemId }, include: { resolvedClaim: { include: { claimant: true, claimantUser: true } } } });
      if (!item) throw new LostFoundError("NOT_FOUND", "Item not found.");
      if (item.status === "RETURNED" || item.status === "DISPOSED") throw new LostFoundError("INVALID_STATE", "This item is already closed.");
      if (!item.resolvedClaim || item.resolvedClaim.outcome !== "VERIFIED") throw new LostFoundError("INVALID_STATE", "Verify the owner's claim before handing the item over.");
      const recipient = input.recipientName?.trim() || claimantLabel(item.resolvedClaim);
      const now = new Date();
      const updated = await tx.lostFoundItem.update({ where: { id: item.id }, data: { status: "RETURNED", handedOverAt: now, handedOverToName: recipient, handedOverById: input.actor.id, handoverNote: input.note?.trim() || null } });
      if (input.evidence) await storeImage(tx, { bytes: input.evidence.bytes, fileName: input.evidence.fileName, entityType: "LostFoundItem", entityId: item.id, uploadedById: input.actor.id });
      await logEvent(tx, item.id, "RETURNED", input.actor.id, item.status, "RETURNED", `Handed to ${recipient}${input.note?.trim() ? ` · ${input.note.trim()}` : ""}`);
      await recordAudit({ actorId: input.actor.id, action: "LOST_FOUND_RETURNED", entityType: "LostFoundItem", entityId: item.id, before: { status: item.status }, after: { status: "RETURNED", recipient, claimId: item.resolvedClaim.id, evidence: !!input.evidence } }, tx);
      const recipientUser = item.resolvedClaim.claimantUserId ?? item.resolvedClaim.claimant?.userId ?? null;
      if (recipientUser) await enqueueNotification(tx, { recipientId: recipientUser, event: "lostfound.returned", idempotencyKey: `lostfound.returned:${item.id}`, payload: { itemId: item.id, reference: item.reference, description: item.description } });
      return updated;
    });
  } catch (e) {
    if (e instanceof UploadError) throw new LostFoundError("VALIDATION", e.message, { evidence: e.message });
    throw e;
  }
}

export async function disposeItem(input: { itemId: string; actor: Actor; method: string; note: string; now?: Date }) {
  if (!input.actor.isManager) throw new LostFoundError("FORBIDDEN", "Only an accommodation administrator can authorise disposal.");
  if (!input.method.trim()) throw new LostFoundError("VALIDATION", "Choose how the item was disposed of.", { method: "Required." });
  if (!input.note.trim()) throw new LostFoundError("VALIDATION", "Record why the item is being disposed of.", { note: "Required." });
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const item = await tx.lostFoundItem.findUnique({ where: { id: input.itemId } });
    if (!item) throw new LostFoundError("NOT_FOUND", "Item not found.");
    if (item.status === "RETURNED" || item.status === "DISPOSED") throw new LostFoundError("INVALID_STATE", "This item is already closed.");
    if (item.status === "CLAIM_PENDING") throw new LostFoundError("INVALID_STATE", "Decide the pending claim before disposing of the item.");
    if (item.retainUntil && item.retainUntil > now) throw new LostFoundError("INVALID_STATE", `This item is kept until ${item.retainUntil.toISOString().slice(0, 10)} under the retention policy.`);
    const updated = await tx.lostFoundItem.update({ where: { id: item.id }, data: { status: "DISPOSED", disposedAt: now, disposalMethod: input.method.trim(), disposalAuthorisedById: input.actor.id, disposalNote: input.note.trim() } });
    await logEvent(tx, item.id, "DISPOSED", input.actor.id, item.status, "DISPOSED", `${input.method.trim()} · ${input.note.trim()}`);
    await recordAudit({ actorId: input.actor.id, action: "LOST_FOUND_DISPOSED", entityType: "LostFoundItem", entityId: item.id, before: { status: item.status }, after: { status: "DISPOSED", method: input.method, note: input.note } }, tx);
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Queries (LF-05 similar search, register, resident view)
// ---------------------------------------------------------------------------

export async function listItems(opts: { filter?: ItemFilter; q?: string | null; siteId?: string | null; now?: Date } = {}, req: PageRequest = {}) {
  const now = opts.now ?? new Date();
  const paging = pageArgs(req);
  const filter = opts.filter ?? "open";
  const where: Prisma.LostFoundItemWhereInput = {
    ...(opts.siteId ? { siteId: opts.siteId } : {}),
    ...(opts.q ? { OR: [{ reference: { contains: opts.q, mode: "insensitive" } }, { description: { contains: opts.q, mode: "insensitive" } }, { category: { contains: opts.q, mode: "insensitive" } }, { foundLocation: { contains: opts.q, mode: "insensitive" } }] } : {}),
    ...(filter === "open" ? { status: { in: OPEN } } : filter === "reported" ? { status: "REPORTED" } : filter === "stored" ? { status: "STORED" } : filter === "claims" ? { status: "CLAIM_PENDING" } : filter === "returned" ? { status: "RETURNED" } : filter === "disposed" ? { status: "DISPOSED" } : filter === "due" ? { status: { in: ["REPORTED", "STORED"] }, retainUntil: { lte: now } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.lostFoundItem.findMany({ where, include: { site: { select: { name: true } }, custodian: { select: { name: true } }, claims: { where: { outcome: "PENDING" }, select: { id: true } } }, orderBy: [{ foundAt: "desc" }, { id: "asc" }], skip: paging.skip, take: paging.take }),
    prisma.lostFoundItem.count({ where }),
  ]);
  return toPaged(rows, total, paging);
}

export async function getItem(id: string, db: Db = prisma) {
  const item = await db.lostFoundItem.findUnique({ where: { id }, include: itemInclude });
  if (!item) return null;
  const photos = await db.attachment.findMany({ where: { entityType: "LostFoundItem", entityId: id }, orderBy: { createdAt: "asc" } });
  return { item, photos };
}

/** Open items that look like the same thing: same category or shared description words, found within 14 days (LF-05). */
export async function similarItems(input: { description: string; category?: string | null; foundAt: Date | string; siteId?: string | null; excludeId?: string | null }, db: Db = prisma) {
  const words = keywords(input.description);
  const foundAt = new Date(input.foundAt);
  const window = 14 * 86400000;
  const candidates = await db.lostFoundItem.findMany({
    where: {
      ...(input.siteId ? { siteId: input.siteId } : {}), ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      status: { in: OPEN }, foundAt: { gte: new Date(foundAt.getTime() - window), lte: new Date(foundAt.getTime() + window) },
      OR: [...(input.category ? [{ category: input.category }] : []), ...words.map((w) => ({ description: { contains: w, mode: "insensitive" as const } }))],
    },
    include: { site: { select: { name: true } } }, orderBy: { foundAt: "desc" }, take: 10,
  });
  return candidates
    .map((c) => ({ item: c, shared: keywords(c.description).filter((w) => words.includes(w)), sameCategory: !!input.category && c.category === input.category }))
    .filter((c) => c.shared.length > 0 || c.sameCategory)
    .sort((a, b) => b.shared.length + (b.sameCategory ? 1 : 0) - (a.shared.length + (a.sameCategory ? 1 : 0)));
}

/** What a resident may see of found items: no claimant details, no storage location. */
export async function publicItems(opts: { siteId?: string | null; q?: string | null } = {}) {
  const rows = await prisma.lostFoundItem.findMany({
    where: { status: { in: OPEN }, ...(opts.siteId ? { siteId: opts.siteId } : {}), ...(opts.q ? { OR: [{ description: { contains: opts.q, mode: "insensitive" } }, { category: { contains: opts.q, mode: "insensitive" } }, { foundLocation: { contains: opts.q, mode: "insensitive" } }] } : {}) },
    select: { id: true, reference: true, description: true, category: true, foundLocation: true, foundAt: true, status: true, site: { select: { name: true } } },
    orderBy: { foundAt: "desc" }, take: 200,
  });
  return rows;
}

export async function myClaims(userId: string) {
  return prisma.lostFoundClaim.findMany({ where: { claimantUserId: userId }, include: { item: { select: { id: true, reference: true, description: true, category: true, status: true, foundAt: true, handedOverAt: true } } }, orderBy: { createdAt: "desc" } });
}

export async function lostFoundSummary(siteId?: string | null, now: Date = new Date()) {
  const where = siteId ? { siteId } : {};
  const [open, claims, due, returned30, disposed30] = await Promise.all([
    prisma.lostFoundItem.count({ where: { ...where, status: { in: OPEN } } }),
    prisma.lostFoundItem.count({ where: { ...where, status: "CLAIM_PENDING" } }),
    prisma.lostFoundItem.count({ where: { ...where, status: { in: ["REPORTED", "STORED"] }, retainUntil: { lte: now } } }),
    prisma.lostFoundItem.count({ where: { ...where, status: "RETURNED", handedOverAt: { gte: new Date(now.getTime() - 30 * 86400000) } } }),
    prisma.lostFoundItem.count({ where: { ...where, status: "DISPOSED", disposedAt: { gte: new Date(now.getTime() - 30 * 86400000) } } }),
  ]);
  return { open, claims, due, returned30, disposed30 };
}


// ---------------------------------------------------------------------------
// Views and actions for the API
// ---------------------------------------------------------------------------

/** The register for a filter together with its summary tiles. */
export async function getRegisterView(opts: { filter?: ItemFilter; q?: string | null }, req: PageRequest = {}, now: Date = new Date()) {
  const [items, summary] = await Promise.all([listItems({ ...opts, now }, req), lostFoundSummary(null, now)]);
  return { items, summary, now };
}

/** Sites and residents the register and claim forms pick from. */
export async function registerOptions() {
  const [sites, staff] = await Promise.all([
    prisma.site.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
    prisma.staffProfile.findMany({ where: { employmentStatus: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
  ]);
  return { sites: sites.map((s) => ({ id: s.id, label: s.name })), staff: staff.map((s) => ({ id: s.id, label: `${s.lastName}, ${s.firstName} (${s.employeeId})`, userId: s.userId })) };
}

/** One item for staff: full record with claims and timeline, photos, and look-alike open items. */
export async function getItemView(id: string, now: Date = new Date()) {
  const detail = await getItem(id);
  if (!detail) throw new LostFoundError("NOT_FOUND", "Item not found.");
  const { item } = detail;
  const similar = OPEN.includes(item.status)
    ? await similarItems({ description: item.description, category: item.category, foundAt: item.foundAt, siteId: item.siteId, excludeId: item.id })
    : [];
  return { ...detail, similar, now };
}

/** What a resident sees of one item: the public description and their own claim only. */
export async function getMyItemView(userId: string, id: string) {
  const item = await prisma.lostFoundItem.findUnique({
    where: { id },
    select: { id: true, reference: true, description: true, category: true, foundLocation: true, foundAt: true, status: true, handedOverAt: true, site: { select: { name: true } }, claims: { where: { claimantUserId: userId }, orderBy: { createdAt: "desc" } } },
  });
  if (!item) throw new LostFoundError("NOT_FOUND", "Item not found.");
  const photos = await prisma.attachment.findMany({ where: { entityType: "LostFoundItem", entityId: id }, orderBy: { createdAt: "asc" } });
  return { item, photos };
}

/** A resident's browse page: open found items (searchable) and their own claims. */
export async function getMyPortal(userId: string, q?: string | null) {
  const [items, claims] = await Promise.all([publicItems({ q: q || null }), myClaims(userId)]);
  return { items, claims };
}

/** An operator records a claim for a resident (looked up by staff id) or a named walk-in. */
export async function recordClaim(input: { itemId: string; actor: Actor; evidence: string; claimantStaffId?: string | null; claimantName?: string | null; claimantContact?: string | null }) {
  const staff = input.claimantStaffId ? await prisma.staffProfile.findUnique({ where: { id: input.claimantStaffId } }) : null;
  return submitClaim({ itemId: input.itemId, actor: input.actor, evidence: input.evidence, claimantId: staff?.id ?? null, claimantUserId: staff?.userId ?? null, claimantName: staff ? null : input.claimantName, claimantContact: input.claimantContact });
}

/** A resident claims an item for themselves. */
export async function submitMyClaim(input: { itemId: string; actor: Actor; user: { id: string; name: string; email: string }; evidence: string; claimantContact?: string | null }) {
  const staff = await prisma.staffProfile.findUnique({ where: { userId: input.user.id } });
  return submitClaim({ itemId: input.itemId, actor: input.actor, evidence: input.evidence, claimantId: staff?.id ?? null, claimantUserId: input.user.id, claimantName: staff ? null : input.user.name, claimantContact: input.claimantContact || input.user.email });
}
