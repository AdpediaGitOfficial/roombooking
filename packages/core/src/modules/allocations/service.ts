// Allocation engine: search, allocate, check in, check out, transfer, cancel.
// Every mutation runs in one transaction; the database exclusion constraint
// on Allocation is the final guard against two people getting one bed.
import type { GenderPolicy, Prisma, PrismaClient, StayType } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { OCCUPYING_STATUSES, isoDate, todayInTimezone } from "../accommodation/occupancy";
import { itemsHeldBy } from "../inventory/service";
import { AllocationError } from "./errors";
import { fulfilRoomChangeTx } from "../requests/service";
import { actorCan, type ActorLike } from "../../lib/permissions/actor";
import { checkEligibility } from "./eligibility";
import { effectivePolicy } from "../structure/service";

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;

const INFINITY = "9999-12-31";

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** Calendar date string to the UTC-midnight Date that @db.Date columns store. */
export function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Half-open ranges [start, end); a null end is open-ended. */
export function rangesOverlap(aStart: string, aEnd: string | null, bStart: string, bEnd: string | null): boolean {
  return aStart < (bEnd ?? INFINITY) && bStart < (aEnd ?? INFINITY);
}

function assertDates(startDate: string, endDate: string | null) {
  if (!isIsoDate(startDate)) throw new AllocationError("INVALID_DATES", "Enter a valid start date.");
  if (endDate !== null) {
    if (!isIsoDate(endDate)) throw new AllocationError("INVALID_DATES", "Enter a valid end date.");
    if (endDate <= startDate) throw new AllocationError("INVALID_DATES", "The end date must be after the start date.");
  }
}

/** Allocations that hold a bed during [startDate, endDate). */
function overlapFilter(startDate: string, endDate: string | null, excludeId?: string | null): Prisma.AllocationWhereInput {
  return {
    status: { in: OCCUPYING_STATUSES },
    ...(excludeId ? { id: { not: excludeId } } : {}),
    OR: [{ endDate: null }, { endDate: { gt: toDate(startDate) } }],
    ...(endDate ? { startDate: { lt: toDate(endDate) } } : {}),
  };
}

function translateDbError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Allocation_no_overlap")) {
    throw new AllocationError("BED_OCCUPIED", "That bed was taken by another allocation at the same moment. Choose another bed.");
  }
  throw error;
}

const bedWithLocation = {
  room: { include: { building: { include: { site: true } } } },
} satisfies Prisma.BedInclude;

async function siteTodayForBed(db: Db, bedId: string): Promise<string> {
  const bed = await db.bed.findUnique({ where: { id: bedId }, include: bedWithLocation });
  return todayInTimezone(bed?.room.building.site.timezone ?? "UTC");
}

// ---------------------------------------------------------------------------
// Search (ACM-04)
// ---------------------------------------------------------------------------

export type AvailabilityQuery = {
  startDate: string;
  endDate?: string | null;
  siteId?: string | null;
  buildingId?: string | null;
  gender?: GenderPolicy | null;
  excludeBedId?: string | null;
};

export async function findAvailableBeds(query: AvailabilityQuery, db: Db = prisma) {
  const endDate = query.endDate || null;
  assertDates(query.startDate, endDate);
  return db.bed.findMany({
    where: {
      status: "ACTIVE",
      ...(query.excludeBedId ? { id: { not: query.excludeBedId } } : {}),
      room: {
        status: "ACTIVE",
        ...(query.gender && query.gender !== "ANY" ? { genderPolicy: { in: ["ANY", query.gender] } } : {}),
        building: {
          status: "ACTIVE",
          ...(query.buildingId ? { id: query.buildingId } : {}),
          ...(query.siteId ? { siteId: query.siteId } : {}),
        },
      },
      allocations: { none: overlapFilter(query.startDate, endDate) },
    },
    include: bedWithLocation,
    orderBy: [{ room: { building: { code: "asc" } } }, { room: { code: "asc" } }, { code: "asc" }],
  });
}

// ---------------------------------------------------------------------------
// Allocate (ACM-05, ACM-06)
// ---------------------------------------------------------------------------

export type AllocateInput = {
  staffId: string;
  bedId: string;
  startDate: string;
  endDate?: string | null;
  reason?: string | null;
  actorId: string;
  previousAllocationId?: string | null;
  requestId?: string | null;
  stayType?: StayType;
  /** Who is acting, so the eligibility override can be checked against their grants (Admins only, with a reason). */
  actor?: ActorLike;
  /** Proceed despite failing the eligibility check; needs the Eligibility override grant and a reason. */
  eligibilityOverrideReason?: string | null;
  /** Emergency check-in: the stay is provisional until an Accommodation Admin approves it within 24 hours. */
  provisional?: boolean;
};

async function allocateTx(tx: Tx, input: AllocateInput) {
  const endDate = input.endDate || null;
  assertDates(input.startDate, endDate);

  const staff = await tx.staffProfile.findUnique({ where: { id: input.staffId } });
  if (!staff) throw new AllocationError("NOT_FOUND", "Staff member not found.");
  if (staff.employmentStatus !== "ACTIVE" || staff.archivedAt) {
    throw new AllocationError("STAFF_INACTIVE", `${staff.firstName} ${staff.lastName} is ${staff.archivedAt ? "archived" : staff.employmentStatus.toLowerCase().replace("_", " ")} and cannot be allocated.`);
  }
  // Staff added by an officer stay Unverified until an Accommodation Admin verifies them; only an emergency check-in may go ahead.
  if (staff.verificationStatus === "UNVERIFIED" && !input.provisional) {
    throw new AllocationError("STAFF_UNVERIFIED", `${staff.firstName} ${staff.lastName}'s profile is not verified yet. An Accommodation Admin must verify it before a bed is allocated.`);
  }

  const bed = await tx.bed.findUnique({ where: { id: input.bedId }, include: bedWithLocation });
  if (!bed) throw new AllocationError("NOT_FOUND", "Bed not found.");
  if (bed.status !== "ACTIVE") throw new AllocationError("BED_UNAVAILABLE", `Bed ${bed.code} is ${bed.status.toLowerCase()}.`);
  if (bed.room.status !== "ACTIVE") throw new AllocationError("BED_UNAVAILABLE", `Room ${bed.room.code} is ${bed.room.status.toLowerCase()}.`);
  if (bed.room.building.status !== "ACTIVE") throw new AllocationError("BED_UNAVAILABLE", `${bed.room.building.name} is ${bed.room.building.status === "INACTIVE" ? "inactive" : bed.room.building.status.toLowerCase()}.`);
  if (bed.room.building.site.status !== "ACTIVE") throw new AllocationError("BED_UNAVAILABLE", `${bed.room.building.site.name} is ${bed.room.building.site.status.toLowerCase()}.`);
  // Gender policy and eligibility are inherited from the building and site unless the room overrides them (document 7).
  const policy = effectivePolicy(bed.room, bed.room.building, bed.room.building.site);
  if (policy.genderPolicy !== "ANY" && staff.gender !== "ANY" && staff.gender !== policy.genderPolicy) {
    throw new AllocationError("GENDER_POLICY", `Room ${bed.room.code} is reserved for ${policy.genderPolicy.toLowerCase()} residents.`);
  }
  const eligibility = checkEligibility(staff, bed.room, policy.eligibility, { startDate: input.startDate, endDate });
  let eligibilityOverride: string | null = null;
  if (!eligibility.ok) {
    const why = input.eligibilityOverrideReason?.trim();
    if (!why) throw new AllocationError("NOT_ELIGIBLE", `${staff.firstName} ${staff.lastName} is not eligible for room ${bed.room.code}: ${eligibility.reasons.join(" ")}`, { reasons: eligibility.reasons });
    if (!input.actor || !actorCan(input.actor, "accom.eligibility_override", { siteId: bed.room.building.siteId, buildingId: bed.room.buildingId })) {
      throw new AllocationError("FORBIDDEN", "Only an Accommodation Admin with the Eligibility override grant can allocate outside eligibility.");
    }
    eligibilityOverride = why;
  }

  const staffClash = await tx.allocation.findFirst({
    where: { staffId: staff.id, ...overlapFilter(input.startDate, endDate, input.previousAllocationId) },
    include: { bed: true },
  });
  if (staffClash) {
    throw new AllocationError(
      "STAFF_ALREADY_ALLOCATED",
      `${staff.firstName} ${staff.lastName} already holds bed ${staffClash.bed.code} from ${isoDate(staffClash.startDate)}${staffClash.endDate ? ` to ${isoDate(staffClash.endDate)}` : ""}. Use a transfer instead.`,
    );
  }
  const bedClash = await tx.allocation.findFirst({ where: { bedId: bed.id, ...overlapFilter(input.startDate, endDate) } });
  if (bedClash) throw new AllocationError("BED_OCCUPIED", `Bed ${bed.code} is already allocated for those dates.`);

  const allocation = await tx.allocation.create({
    data: {
      staffId: staff.id,
      bedId: bed.id,
      startDate: toDate(input.startDate),
      endDate: endDate ? toDate(endDate) : null,
      status: "CONFIRMED",
      reason: input.reason || null,
      previousAllocationId: input.previousAllocationId ?? null,
      createdById: input.actorId,
      requestId: input.requestId ?? null,
      stayType: input.provisional ? "EMERGENCY" : (input.stayType ?? "PERMANENT"),
      provisional: input.provisional ?? false,
      provisionalApproveBy: input.provisional ? new Date(Date.now() + 24 * 3600000) : null,
    },
  });
  if (eligibilityOverride) {
    // Overrides are flagged: reason mandatory, shown in exception reports, approvers notified.
    await recordAudit({ actorId: input.actorId, action: "ELIGIBILITY_OVERRIDE", entityType: "Allocation", entityId: allocation.id, after: { reason: eligibilityOverride, failed: eligibility.reasons, staffId: staff.id, bedCode: bed.code } }, tx);
    const approvers = await tx.user.findMany({ where: { status: "ACTIVE", id: { not: input.actorId }, roleAssignments: { some: { role: "ACCOMMODATION_ADMIN" } } }, select: { id: true }, take: 20 });
    for (const a of approvers) await enqueueNotification(tx, { recipientId: a.id, event: "override.flagged", idempotencyKey: `override:${allocation.id}:${a.id}`, payload: { what: "Eligibility override", reason: eligibilityOverride, allocationId: allocation.id } });
  }

  await recordAudit(
    {
      actorId: input.actorId,
      action: "ALLOCATION_CREATED",
      entityType: "Allocation",
      entityId: allocation.id,
      after: { staffId: staff.id, employeeId: staff.employeeId, bedId: bed.id, bedCode: bed.code, startDate: input.startDate, endDate, previousAllocationId: input.previousAllocationId ?? null },
    },
    tx,
  );
  if (staff.userId) {
    await enqueueNotification(tx, {
      recipientId: staff.userId,
      event: "allocation.confirmed",
      idempotencyKey: `allocation.confirmed:${allocation.id}`,
      payload: { allocationId: allocation.id, bed: bed.code, room: bed.room.code, building: bed.room.building.name, startDate: input.startDate, endDate },
    });
  }
  return allocation;
}

export async function allocate(input: AllocateInput) {
  try {
    return await prisma.$transaction((tx) => allocateTx(tx, input));
  } catch (error) {
    translateDbError(error);
  }
}

// ---------------------------------------------------------------------------
// Check-in (ACM-08)
// ---------------------------------------------------------------------------

export type CheckInInput = {
  allocationId: string;
  actorId: string;
  notes?: string | null;
  today?: string;
  /** Check-in checklist ticks (from the check-in template): item id to done, with the resident having seen room assets. */
  checklist?: Record<string, boolean | string> | null;
  /** Hand over a bed that is not marked ready (needs cleaning); flagged in the audit log. */
  acceptNotReady?: boolean;
};

async function checkInTx(tx: Tx, input: CheckInInput) {
  const allocation = await tx.allocation.findUnique({
    where: { id: input.allocationId },
    include: { bed: { include: { room: true } }, previous: true },
  });
  if (!allocation) throw new AllocationError("NOT_FOUND", "Allocation not found.");
  if (allocation.status !== "CONFIRMED") {
    throw new AllocationError("INVALID_STATE", `Only confirmed allocations can be checked in (this one is ${allocation.status.toLowerCase().replace("_", " ")}).`);
  }
  if (allocation.bed.status !== "ACTIVE" || allocation.bed.room.status !== "ACTIVE") {
    throw new AllocationError("BED_UNAVAILABLE", `Bed ${allocation.bed.code} is not in service. Transfer the resident first.`);
  }
  const today = input.today ?? (await siteTodayForBed(tx, allocation.bedId));
  if (allocation.endDate && isoDate(allocation.endDate) <= today) {
    throw new AllocationError("INVALID_DATES", "This allocation's end date has already passed. Create a new allocation.");
  }
  // A bed that still needs cleaning is not handed over unless the desk accepts it knowingly.
  const readiness = (allocation.bed as { readiness?: string }).readiness ?? "READY";
  if (readiness !== "READY" && !input.acceptNotReady) {
    throw new AllocationError("NOT_READY", `Bed ${allocation.bed.code} is marked ${readiness.toLowerCase().replace("_", " ")}. Mark it ready first, or accept it as it is.`);
  }
  const now = new Date();

  // Arriving at the destination of a transfer closes the previous stay.
  if (allocation.previous && allocation.previous.status === "CHECKED_IN") {
    const prev = allocation.previous;
    const keepEnd = prev.endDate && isoDate(prev.endDate) <= today;
    await tx.allocation.update({
      where: { id: prev.id },
      data: { status: "CHECKED_OUT", checkedOutAt: now, ...(keepEnd ? {} : { endDate: toDate(today) }) },
    });
    await recordAudit(
      { actorId: input.actorId, action: "ALLOCATION_CHECKED_OUT", entityType: "Allocation", entityId: prev.id, after: { reason: "transfer", toAllocationId: allocation.id, endDate: keepEnd ? isoDate(prev.endDate!) : today } },
      tx,
    );
  }

  const earlyArrival = isoDate(allocation.startDate) > today;
  const updated = await tx.allocation.update({
    where: { id: allocation.id },
    data: {
      status: "CHECKED_IN",
      checkedInAt: now,
      ...(input.checklist ? { checklist: { ...(typeof allocation.checklist === "object" && allocation.checklist ? (allocation.checklist as object) : {}), checkIn: input.checklist } as Prisma.InputJsonValue } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
      ...(earlyArrival ? { startDate: toDate(today) } : {}),
    },
  });
  await recordAudit(
    { actorId: input.actorId, action: "ALLOCATION_CHECKED_IN", entityType: "Allocation", entityId: allocation.id, after: { bedCode: allocation.bed.code, checkedInAt: now.toISOString(), earlyArrival, notes: input.notes ?? null, notReadyAccepted: readiness !== "READY" } },
    tx,
  );
  return updated;
}

export async function checkIn(input: CheckInInput) {
  try {
    return await prisma.$transaction((tx) => checkInTx(tx, input));
  } catch (error) {
    translateDbError(error);
  }
}

// ---------------------------------------------------------------------------
// Check-out (ACM-08, edge case "Check-out with outstanding key/assets")
// ---------------------------------------------------------------------------

export type ClearanceBlocker = { type: "KEY" | "ASSET"; label: string };

export async function clearanceBlockers(staffId: string, db: Db = prisma): Promise<ClearanceBlocker[]> {
  const [keys, items] = await Promise.all([
    db.keyTransaction.findMany({ where: { holderId: staffId, type: "ISSUE", returnedAt: null }, include: { key: true } }),
    itemsHeldBy({ staffId }, db),
  ]);
  return [
    ...keys.map((k) => ({ type: "KEY" as const, label: `Key ${k.key.code}${k.key.label ? ` (${k.key.label})` : ""}` })),
    ...items.map((a) => ({ type: "ASSET" as const, label: a.serialNumber ? `${a.name} #${a.serialNumber}` : `${a.quantity} × ${a.name}` })),
  ];
}

export type CheckOutInput = {
  allocationId: string;
  actorId: string;
  notes?: string | null;
  today?: string;
  overrideReason?: string | null;
  canOverride?: boolean;
  /** Check-out checklist ticks (room condition, keys, assets handed back). */
  checklist?: Record<string, boolean | string> | null;
};

async function checkOutTx(tx: Tx, input: CheckOutInput) {
  const allocation = await tx.allocation.findUnique({ where: { id: input.allocationId }, include: { bed: true, staff: true } });
  if (!allocation) throw new AllocationError("NOT_FOUND", "Allocation not found.");
  if (allocation.status !== "CHECKED_IN") {
    throw new AllocationError("INVALID_STATE", `Only checked-in residents can be checked out (this allocation is ${allocation.status.toLowerCase().replace("_", " ")}).`);
  }
  const today = input.today ?? (await siteTodayForBed(tx, allocation.bedId));

  const blockers = await clearanceBlockers(allocation.staffId, tx);
  const overrideReason = input.overrideReason?.trim() || null;
  if (blockers.length > 0) {
    if (!overrideReason) {
      throw new AllocationError("CLEARANCE_BLOCKED", `Outstanding items must be returned before check-out: ${blockers.map((b) => b.label).join(", ")}.`, { blockers });
    }
    if (!input.canOverride) throw new AllocationError("FORBIDDEN", "Only an accommodation administrator can override clearance blockers.");
    // An override is flagged and the approvers are told (document 3: reason mandatory, flagged, approver notified).
    await recordAudit({ actorId: input.actorId, action: "CLEARANCE_OVERRIDE", entityType: "Allocation", entityId: allocation.id, after: { reason: overrideReason, blockers: blockers.map((b) => b.label) } }, tx);
    const admins = await tx.user.findMany({ where: { status: "ACTIVE", id: { not: input.actorId }, roleAssignments: { some: { role: { in: ["ACCOMMODATION_ADMIN", "SYSTEM_ADMIN"] } } } }, select: { id: true }, take: 20 });
    for (const a of admins) await enqueueNotification(tx, { recipientId: a.id, event: "override.flagged", idempotencyKey: `override:clearance:${allocation.id}:${a.id}`, payload: { what: "Check-out clearance override", reason: overrideReason, allocationId: allocation.id } });
  }

  const now = new Date();
  const keepEnd = allocation.endDate && isoDate(allocation.endDate) <= today;
  const updated = await tx.allocation.update({
    where: { id: allocation.id },
    data: {
      status: "CHECKED_OUT",
      checkedOutAt: now,
      ...(keepEnd ? {} : { endDate: toDate(today) }),
      ...(input.checklist ? { checklist: { ...(typeof allocation.checklist === "object" && allocation.checklist ? (allocation.checklist as object) : {}), checkOut: input.checklist } as Prisma.InputJsonValue } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
    },
  });
  // The bed needs cleaning before the next arrival: flag it and open a housekeeping task.
  const bedRoom = await tx.bed.findUnique({ where: { id: allocation.bedId }, include: { room: { include: { building: true } } } });
  await tx.bed.update({ where: { id: allocation.bedId }, data: { readiness: "NEEDS_CLEANING", readinessUpdatedAt: now } });
  if (bedRoom) await tx.cleaningTask.create({ data: { siteId: bedRoom.room.building.siteId, roomId: bedRoom.roomId, bedId: bedRoom.id, reason: "CHECKOUT", dueAt: new Date(now.getTime() + 24 * 3600000) } });
  await recordAudit(
    {
      actorId: input.actorId,
      action: "ALLOCATION_CHECKED_OUT",
      entityType: "Allocation",
      entityId: allocation.id,
      after: { bedCode: allocation.bed.code, checkedOutAt: now.toISOString(), endDate: isoDate(updated.endDate!), blockers: blockers.map((b) => b.label), overrideReason, notes: input.notes ?? null },
    },
    tx,
  );
  if (allocation.staff.userId) {
    await enqueueNotification(tx, {
      recipientId: allocation.staff.userId,
      event: "allocation.checked_out",
      idempotencyKey: `allocation.checked_out:${allocation.id}`,
      payload: { allocationId: allocation.id, bed: allocation.bed.code, endDate: isoDate(updated.endDate!) },
    });
  }
  return updated;
}

export async function checkOut(input: CheckOutInput) {
  try {
    return await prisma.$transaction((tx) => checkOutTx(tx, input));
  } catch (error) {
    translateDbError(error);
  }
}

// ---------------------------------------------------------------------------
// Cancel before arrival
// ---------------------------------------------------------------------------

export type CancelInput = { allocationId: string; actorId: string; reason: string };

export async function cancel(input: CancelInput) {
  const reason = input.reason?.trim();
  if (!reason) throw new AllocationError("INVALID_STATE", "A reason is required to cancel an allocation.");
  return prisma.$transaction(async (tx) => {
    const allocation = await tx.allocation.findUnique({ where: { id: input.allocationId }, include: { bed: true, staff: true } });
    if (!allocation) throw new AllocationError("NOT_FOUND", "Allocation not found.");
    if (allocation.status !== "CONFIRMED") {
      throw new AllocationError("INVALID_STATE", `Only confirmed allocations can be cancelled (this one is ${allocation.status.toLowerCase().replace("_", " ")}).`);
    }
    const updated = await tx.allocation.update({ where: { id: allocation.id }, data: { status: "CANCELLED", reason } });
    await recordAudit(
      { actorId: input.actorId, action: "ALLOCATION_CANCELLED", entityType: "Allocation", entityId: allocation.id, before: { status: allocation.status }, after: { status: "CANCELLED", reason, bedCode: allocation.bed.code } },
      tx,
    );
    if (allocation.staff.userId) {
      await enqueueNotification(tx, {
        recipientId: allocation.staff.userId,
        event: "allocation.cancelled",
        idempotencyKey: `allocation.cancelled:${allocation.id}`,
        payload: { allocationId: allocation.id, bed: allocation.bed.code, reason },
      });
    }
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Transfer (ACM-07, SRS 6.2)
// ---------------------------------------------------------------------------

export type TransferInput = {
  allocationId: string;
  toBedId: string;
  effectiveDate: string;
  reason: string;
  actorId: string;
  today?: string;
  /** An APPROVED room-change request this move fulfils (WF-08). */
  requestId?: string | null;
};

export async function transfer(input: TransferInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.allocation.findUnique({ where: { id: input.allocationId }, include: { bed: true } });
      if (!current) throw new AllocationError("NOT_FOUND", "Allocation not found.");
      if (!OCCUPYING_STATUSES.includes(current.status)) {
        throw new AllocationError("INVALID_STATE", `Only confirmed or checked-in allocations can be transferred (this one is ${current.status.toLowerCase().replace("_", " ")}).`);
      }
      const reason = input.reason?.trim();
      if (!reason) throw new AllocationError("INVALID_STATE", "A reason is required for a transfer.");
      if (!isIsoDate(input.effectiveDate)) throw new AllocationError("INVALID_DATES", "Enter a valid effective date.");
      const today = input.today ?? (await siteTodayForBed(tx, current.bedId));
      if (input.effectiveDate < today) throw new AllocationError("INVALID_DATES", "A transfer cannot be backdated.");
      if (current.endDate && input.effectiveDate >= isoDate(current.endDate)) {
        throw new AllocationError("INVALID_DATES", `The current allocation ends on ${isoDate(current.endDate)}; choose an earlier effective date.`);
      }
      if (input.toBedId === current.bedId) throw new AllocationError("INVALID_DATES", "Choose a different bed.");

      const start = isoDate(current.startDate);
      const carriedEnd = current.endDate ? isoDate(current.endDate) : null;
      let created;

      if (current.status === "CONFIRMED" && input.effectiveDate <= start) {
        // Not yet arrived: replace the allocation outright, keeping its dates.
        await tx.allocation.update({ where: { id: current.id }, data: { status: "CANCELLED", reason: `Transferred before arrival: ${reason}` } });
        created = await allocateTx(tx, { staffId: current.staffId, bedId: input.toBedId, startDate: start, endDate: carriedEnd, reason, actorId: input.actorId, previousAllocationId: current.id });
      } else {
        if (input.effectiveDate < start) throw new AllocationError("INVALID_DATES", "The effective date cannot be before the current start date.");
        // Keep the current bed until the effective date (half-open end).
        await tx.allocation.update({ where: { id: current.id }, data: { endDate: toDate(input.effectiveDate) } });
        created = await allocateTx(tx, { staffId: current.staffId, bedId: input.toBedId, startDate: input.effectiveDate, endDate: carriedEnd, reason, actorId: input.actorId, previousAllocationId: current.id });
        if (current.status === "CHECKED_IN" && input.effectiveDate === today) {
          created = await checkInTx(tx, { allocationId: created.id, actorId: input.actorId, today, notes: "Same-day transfer" });
        }
      }

      if (input.requestId) {
        await fulfilRoomChangeTx(tx, { requestId: input.requestId, staffId: current.staffId, allocationId: created.id, actorId: input.actorId });
      }

      await recordAudit(
        { actorId: input.actorId, action: "ALLOCATION_TRANSFERRED", entityType: "Allocation", entityId: current.id, after: { fromBedCode: current.bed.code, toBedId: input.toBedId, toAllocationId: created.id, effectiveDate: input.effectiveDate, reason, requestId: input.requestId ?? null } },
        tx,
      );
      return created;
    });
  } catch (error) {
    translateDbError(error);
  }
}

// ---------------------------------------------------------------------------
// Read helpers for pages
// ---------------------------------------------------------------------------

export const allocationDetailInclude = {
  staff: { include: { user: { select: { email: true } } } },
  bed: { include: bedWithLocation },
  previous: { include: { bed: true } },
  next: { include: { bed: true }, orderBy: { createdAt: "asc" } },
  createdBy: { select: { name: true } },
} satisfies Prisma.AllocationInclude;

export async function getAllocation(id: string) {
  return prisma.allocation.findUnique({ where: { id }, include: allocationDetailInclude });
}

export type AllocationListFilter = "active" | "upcoming" | "history" | "all";

export async function listAllocations(filter: AllocationListFilter, staffId?: string | null, siteIds?: string[] | null) {
  const byStatus: Prisma.AllocationWhereInput =
    filter === "active"
      ? { status: "CHECKED_IN" }
      : filter === "upcoming"
        ? { status: "CONFIRMED" }
        : filter === "history"
          ? { status: { in: ["CHECKED_OUT", "CANCELLED", "REJECTED", "EXPIRED"] } }
          : {};
  const where: Prisma.AllocationWhereInput = { ...byStatus, ...(staffId ? { staffId } : {}), ...(siteIds ? { bed: { room: { building: { siteId: { in: siteIds } } } } } : {}) };
  return prisma.allocation.findMany({
    where,
    include: { staff: true, bed: { include: bedWithLocation } },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
}
