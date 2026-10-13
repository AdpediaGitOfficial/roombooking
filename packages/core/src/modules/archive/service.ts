// Soft delete everywhere (document principle 6): nothing is erased silently. Archiving hides a record and
// starts a restore window (default 30 days). Only the Super Admin can hard delete, and only after the window
// has passed or for a data-erasure request. Every archive, restore and purge is audited.
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { actorCan, type ActorLike } from "../../lib/permissions/actor";
import { clearanceBlockers } from "../allocations/service";
import { OCCUPYING_STATUSES } from "../accommodation/occupancy";
import { restoreWindowDays } from "../structure/service";

export class ArchiveError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "FORBIDDEN" | "INVALID_STATE" | "VALIDATION", message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

export type ArchiveKind = "STAFF" | "VENDOR" | "FACILITY" | "INVENTORY_ITEM" | "KEY" | "MASTER_ITEM" | "CONTRACTOR_WORKER";
export const ARCHIVE_KINDS: ArchiveKind[] = ["STAFF", "VENDOR", "FACILITY", "INVENTORY_ITEM", "KEY", "MASTER_ITEM", "CONTRACTOR_WORKER"];

const CAPABILITY: Record<ArchiveKind, string> = {
  STAFF: "people.verify",
  VENDOR: "maint.vendor_manage",
  FACILITY: "fac.configure",
  INVENTORY_ITEM: "inv.masters",
  KEY: "keys.register",
  MASTER_ITEM: "setup.org_masters",
  CONTRACTOR_WORKER: "maint.workers",
};

type Row = { label: string; archivedAt: Date | null; siteId: string | null };

async function load(kind: ArchiveKind, id: string): Promise<Row> {
  switch (kind) {
    case "STAFF": { const x = await prisma.staffProfile.findUnique({ where: { id } }); if (x) return { label: `${x.firstName} ${x.lastName} (${x.employeeId})`, archivedAt: x.archivedAt, siteId: null }; break; }
    case "VENDOR": { const x = await prisma.vendor.findUnique({ where: { id } }); if (x) return { label: x.name, archivedAt: x.archivedAt, siteId: null }; break; }
    case "FACILITY": { const x = await prisma.facility.findUnique({ where: { id } }); if (x) return { label: x.name, archivedAt: x.archivedAt, siteId: x.siteId }; break; }
    case "INVENTORY_ITEM": { const x = await prisma.inventoryItem.findUnique({ where: { id } }); if (x) return { label: `${x.name} (${x.sku})`, archivedAt: x.archivedAt, siteId: x.siteId }; break; }
    case "KEY": { const x = await prisma.key.findUnique({ where: { id } }); if (x) return { label: `Key ${x.code}`, archivedAt: x.archivedAt, siteId: x.siteId }; break; }
    case "MASTER_ITEM": { const x = await prisma.masterItem.findUnique({ where: { id } }); if (x) return { label: `${x.kind.toLowerCase().replace(/_/g, " ")}: ${x.name}`, archivedAt: x.archivedAt, siteId: x.siteId }; break; }
    case "CONTRACTOR_WORKER": { const x = await prisma.contractorWorker.findUnique({ where: { id } }); if (x) return { label: x.name, archivedAt: x.archivedAt, siteId: null }; break; }
  }
  throw new ArchiveError("NOT_FOUND", "Record not found.");
}

/** Reasons the record cannot be archived yet (open work, occupants, items out). */
async function blockers(kind: ArchiveKind, id: string): Promise<string[]> {
  const out: string[] = [];
  switch (kind) {
    case "STAFF": {
      const live = await prisma.allocation.count({ where: { staffId: id, status: { in: OCCUPYING_STATUSES } } });
      if (live) out.push("They still have a current or upcoming allocation: check them out first.");
      for (const b of await clearanceBlockers(id)) out.push(`Still holding: ${b.label}.`);
      break;
    }
    case "VENDOR": {
      const open = await prisma.workOrder.count({ where: { vendorId: id, status: { notIn: ["CLOSED", "CANCELLED"] } } });
      if (open) out.push(`${open} open work order${open === 1 ? "" : "s"} are assigned to this vendor.`);
      break;
    }
    case "FACILITY": {
      const upcoming = await prisma.facilityBooking.count({ where: { facilityId: id, startsAt: { gt: new Date() }, status: { in: ["CONFIRMED", "PENDING_APPROVAL"] } } });
      if (upcoming) out.push(`${upcoming} upcoming booking${upcoming === 1 ? "" : "s"}: cancel them first.`);
      break;
    }
    case "INVENTORY_ITEM": {
      const out_ = await prisma.assetAssignment.count({ where: { itemId: id, endedAt: null } });
      if (out_) out.push("The item is still issued: take it back first.");
      break;
    }
    case "KEY": {
      const issued = await prisma.keyTransaction.count({ where: { keyId: id, type: "ISSUE", returnedAt: null } });
      if (issued) out.push("The key is still out: record its return first.");
      break;
    }
    default: break;
  }
  return out;
}

export async function archiveRecord(actor: ActorLike, kind: ArchiveKind, id: string, reason: string) {
  if (!reason?.trim()) throw new ArchiveError("VALIDATION", "Give a reason.");
  const row = await load(kind, id);
  if (!actorCan(actor, CAPABILITY[kind], row.siteId ? { siteId: row.siteId } : {})) throw new ArchiveError("FORBIDDEN", "Your role does not allow archiving this.");
  if (row.archivedAt) throw new ArchiveError("INVALID_STATE", "That record is already archived.");
  const why = await blockers(kind, id);
  if (why.length) throw new ArchiveError("INVALID_STATE", `${row.label} cannot be archived yet. ${why.join(" ")}`);
  const data = { archivedAt: new Date(), archivedById: actor.id, archiveReason: reason.trim() };
  await prisma.$transaction(async (tx) => {
    switch (kind) {
      case "STAFF": await tx.staffProfile.update({ where: { id }, data }); break;
      case "VENDOR": await tx.vendor.update({ where: { id }, data: { ...data, status: "ARCHIVED" } }); break;
      case "FACILITY": await tx.facility.update({ where: { id }, data: { ...data, status: "ARCHIVED" } }); break;
      case "INVENTORY_ITEM": await tx.inventoryItem.update({ where: { id }, data: { ...data, status: "ARCHIVED" } }); break;
      case "KEY": await tx.key.update({ where: { id }, data: { ...data, status: "RETIRED" } }); break;
      case "MASTER_ITEM": await tx.masterItem.update({ where: { id }, data: { ...data, status: "ARCHIVED" } }); break;
      case "CONTRACTOR_WORKER": await tx.contractorWorker.update({ where: { id }, data: { archivedAt: data.archivedAt, status: "REMOVED" } }); break;
    }
    await recordAudit({ actorId: actor.id, action: `${kind}_ARCHIVED`, entityType: kind, entityId: id, after: { reason: reason.trim(), label: row.label } }, tx);
  });
}

export async function restoreArchived(actor: ActorLike, kind: ArchiveKind, id: string, now: Date = new Date()) {
  const row = await load(kind, id);
  if (!row.archivedAt) throw new ArchiveError("INVALID_STATE", "That record is not archived.");
  if (!actorCan(actor, "setup.restore", row.siteId ? { siteId: row.siteId } : {})) throw new ArchiveError("FORBIDDEN", "Your role does not allow restoring records.");
  const days = await restoreWindowDays();
  if (now.getTime() - row.archivedAt.getTime() > days * 86400000 && !actor.roles.includes("SYSTEM_ADMIN")) {
    throw new ArchiveError("FORBIDDEN", `The ${days}-day restore window has passed; ask a Super Admin to restore it.`);
  }
  const data = { archivedAt: null, archivedById: null, archiveReason: null };
  await prisma.$transaction(async (tx) => {
    switch (kind) {
      case "STAFF": await tx.staffProfile.update({ where: { id }, data }); break;
      case "VENDOR": await tx.vendor.update({ where: { id }, data: { ...data, status: "ACTIVE" } }); break;
      case "FACILITY": await tx.facility.update({ where: { id }, data: { ...data, status: "ACTIVE" } }); break;
      case "INVENTORY_ITEM": await tx.inventoryItem.update({ where: { id }, data: { ...data, status: "ACTIVE" } }); break;
      case "KEY": await tx.key.update({ where: { id }, data: { ...data, status: "AVAILABLE" } }); break;
      case "MASTER_ITEM": await tx.masterItem.update({ where: { id }, data: { ...data, status: "ACTIVE" } }); break;
      case "CONTRACTOR_WORKER": await tx.contractorWorker.update({ where: { id }, data: { archivedAt: null, status: "PENDING" } }); break;
    }
    await recordAudit({ actorId: actor.id, action: `${kind}_RESTORED`, entityType: kind, entityId: id, after: { label: row.label } }, tx);
  });
}

/**
 * Permanent removal: Super Admin only, after the restore window or for an approved erasure request. Records
 * that other records still refer to cannot be removed; they are anonymised through the erasure process instead.
 */
export async function hardDelete(actor: ActorLike, kind: ArchiveKind, id: string, opts: { erasureRequestId?: string | null; now?: Date } = {}) {
  if (!actorCan(actor, "setup.hard_delete")) throw new ArchiveError("FORBIDDEN", "Only a Super Admin can permanently delete records.");
  const row = await load(kind, id);
  if (!row.archivedAt) throw new ArchiveError("INVALID_STATE", "Archive the record first: only archived records can be deleted permanently.");
  const days = await restoreWindowDays();
  const now = opts.now ?? new Date();
  const waited = now.getTime() - row.archivedAt.getTime() > days * 86400000;
  if (!waited && !opts.erasureRequestId) throw new ArchiveError("INVALID_STATE", `The ${days}-day restore window has not passed yet. Hard delete is only allowed after it, or for an approved erasure request.`);
  if (opts.erasureRequestId) {
    const req = await prisma.dataRequest.findUnique({ where: { id: opts.erasureRequestId } });
    if (!req || req.kind !== "ERASURE" || req.status !== "COMPLIANCE_APPROVED") throw new ArchiveError("INVALID_STATE", "The erasure request has not been approved by Compliance.");
  }
  try {
    await prisma.$transaction(async (tx) => {
      switch (kind) {
        case "STAFF": await tx.staffProfile.delete({ where: { id } }); break;
        case "VENDOR": await tx.vendor.delete({ where: { id } }); break;
        case "FACILITY": await tx.facility.delete({ where: { id } }); break;
        case "INVENTORY_ITEM": await tx.inventoryItem.delete({ where: { id } }); break;
        case "KEY": await tx.key.delete({ where: { id } }); break;
        case "MASTER_ITEM": await tx.masterItem.delete({ where: { id } }); break;
        case "CONTRACTOR_WORKER": await tx.contractorWorker.delete({ where: { id } }); break;
      }
      await recordAudit({ actorId: actor.id, action: `${kind}_PURGED`, entityType: kind, entityId: id, after: { label: row.label, erasureRequestId: opts.erasureRequestId ?? null } }, tx);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new ArchiveError("INVALID_STATE", `${row.label} is referred to by other records (history), so it cannot be deleted permanently. Keep it archived, or use the erasure process to anonymise personal data.`);
    }
    throw error;
  }
}

export type ArchivedRow = { kind: ArchiveKind; id: string; label: string; archivedAt: Date; archivedBy: string | null; reason: string | null; daysLeft: number; purgeable: boolean };

/** Everything archived, newest first, with how long the restore window has left. */
export async function listArchived(now: Date = new Date()): Promise<ArchivedRow[]> {
  const days = await restoreWindowDays();
  const [staff, vendors, facilities, items, keys, masters] = await Promise.all([
    prisma.staffProfile.findMany({ where: { archivedAt: { not: null } }, orderBy: { archivedAt: "desc" }, take: 100 }),
    prisma.vendor.findMany({ where: { archivedAt: { not: null } }, orderBy: { archivedAt: "desc" }, take: 100 }),
    prisma.facility.findMany({ where: { archivedAt: { not: null } }, orderBy: { archivedAt: "desc" }, take: 100 }),
    prisma.inventoryItem.findMany({ where: { archivedAt: { not: null } }, orderBy: { archivedAt: "desc" }, take: 100 }),
    prisma.key.findMany({ where: { archivedAt: { not: null } }, orderBy: { archivedAt: "desc" }, take: 100 }),
    prisma.masterItem.findMany({ where: { archivedAt: { not: null } }, orderBy: { archivedAt: "desc" }, take: 100 }),
  ]);
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...staff, ...vendors, ...facilities, ...items, ...keys, ...masters].map((r) => r.archivedById).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const rows: Array<Omit<ArchivedRow, "daysLeft" | "purgeable">> = [
    ...staff.map((x) => ({ kind: "STAFF" as const, id: x.id, label: `${x.firstName} ${x.lastName} (${x.employeeId})`, archivedAt: x.archivedAt!, archivedBy: users.get(x.archivedById ?? "") ?? null, reason: x.archiveReason })),
    ...vendors.map((x) => ({ kind: "VENDOR" as const, id: x.id, label: x.name, archivedAt: x.archivedAt!, archivedBy: users.get(x.archivedById ?? "") ?? null, reason: x.archiveReason })),
    ...facilities.map((x) => ({ kind: "FACILITY" as const, id: x.id, label: x.name, archivedAt: x.archivedAt!, archivedBy: users.get(x.archivedById ?? "") ?? null, reason: x.archiveReason })),
    ...items.map((x) => ({ kind: "INVENTORY_ITEM" as const, id: x.id, label: `${x.name} (${x.sku})`, archivedAt: x.archivedAt!, archivedBy: users.get(x.archivedById ?? "") ?? null, reason: x.archiveReason })),
    ...keys.map((x) => ({ kind: "KEY" as const, id: x.id, label: `Key ${x.code}`, archivedAt: x.archivedAt!, archivedBy: users.get(x.archivedById ?? "") ?? null, reason: x.archiveReason })),
    ...masters.map((x) => ({ kind: "MASTER_ITEM" as const, id: x.id, label: `${x.kind.toLowerCase().replace(/_/g, " ")}: ${x.name}`, archivedAt: x.archivedAt!, archivedBy: users.get(x.archivedById ?? "") ?? null, reason: x.archiveReason })),
  ];
  return rows
    .sort((a, b) => b.archivedAt.getTime() - a.archivedAt.getTime())
    .map((r) => {
      const left = Math.ceil((r.archivedAt.getTime() + days * 86400000 - now.getTime()) / 86400000);
      return { ...r, daysLeft: Math.max(0, left), purgeable: left <= 0 };
    });
}

/** Structure records archived within the window (sites, buildings, floors, units, rooms, beds). */
export async function listArchivedStructure(now: Date = new Date()) {
  const days = await restoreWindowDays();
  const [sites, buildings, rooms, beds] = await Promise.all([
    prisma.site.findMany({ where: { archivedAt: { not: null } }, orderBy: { archivedAt: "desc" }, take: 50 }),
    prisma.building.findMany({ where: { archivedAt: { not: null } }, include: { site: true }, orderBy: { archivedAt: "desc" }, take: 50 }),
    prisma.room.findMany({ where: { archivedAt: { not: null } }, include: { building: true }, orderBy: { archivedAt: "desc" }, take: 50 }),
    prisma.bed.findMany({ where: { archivedAt: { not: null } }, include: { room: { include: { building: true } } }, orderBy: { archivedAt: "desc" }, take: 50 }),
  ]);
  const left = (d: Date | null) => (d ? Math.max(0, Math.ceil((d.getTime() + days * 86400000 - now.getTime()) / 86400000)) : 0);
  return [
    ...sites.map((x) => ({ level: "SITE" as const, id: x.id, label: x.name, archivedAt: x.archivedAt!, reason: x.archiveReason, daysLeft: left(x.archivedAt) })),
    ...buildings.map((x) => ({ level: "BUILDING" as const, id: x.id, label: `${x.name} (${x.site.name})`, archivedAt: x.archivedAt!, reason: x.archiveReason, daysLeft: left(x.archivedAt) })),
    ...rooms.map((x) => ({ level: "ROOM" as const, id: x.id, label: `Room ${x.code} (${x.building.name})`, archivedAt: x.archivedAt!, reason: x.archiveReason, daysLeft: left(x.archivedAt) })),
    ...beds.map((x) => ({ level: "BED" as const, id: x.id, label: `Bed ${x.code} (${x.room.building.name})`, archivedAt: x.archivedAt!, reason: x.archiveReason, daysLeft: left(x.archivedAt) })),
  ].sort((a, b) => b.archivedAt.getTime() - a.archivedAt.getTime());
}
