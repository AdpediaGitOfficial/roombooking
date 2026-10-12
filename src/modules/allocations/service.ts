// Allocation engine: search, allocate, check in, check out, transfer, cancel.
// Every mutation runs in one transaction; the database exclusion constraint
// on Allocation is the final guard against two people getting one bed.
import type { GenderPolicy, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { enqueueNotification } from "@/lib/notifications";
import { OCCUPYING_STATUSES, isoDate, todayInTimezone } from "@/modules/accommodation/occupancy";
import { AllocationError } from "./errors";

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
};

async function allocateTx(tx: Tx, input: AllocateInput) {
  const endDate = input.endDate || null;
  assertDates(input.startDate, endDate);

  const staff = await tx.staffProfile.findUnique({ where: { id: input.staffId } });
  if (!staff) throw new AllocationError("NOT_FOUND", "Staff member not found.");
  if (staff.employmentStatus !== "ACTIVE") {
    throw new AllocationError("STAFF_INACTIVE", `${staff.firstName} ${staff.lastName} is ${staff.employmentStatus.toLowerCase().replace("_", " ")} and cannot be allocated.`);
  }

  const bed = await tx.bed.findUnique({ where: { id: input.bedId }, include: bedWithLocation });
  if (!bed) throw new AllocationError("NOT_FOUND", "Bed not found.");
  if (bed.status !== "ACTIVE") throw new AllocationError("BED_UNAVAILABLE", `Bed ${bed.code} is ${bed.status.toLowerCase()}.`);
  if (bed.room.status !== "ACTIVE") throw new AllocationError("BED_UNAVAILABLE", `Room ${bed.room.code} is ${bed.room.status.toLowerCase()}.`);
  if (bed.room.building.status !== "ACTIVE") throw new AllocationError("BED_UNAVAILABLE", `${bed.room.building.name} is inactive.`);
  if (bed.room.genderPolicy !== "ANY" && staff.gender !== "ANY" && staff.gender !== bed.room.genderPolicy) {
    throw new AllocationError("GENDER_POLICY", `Room ${bed.room.code} is reserved for ${bed.room.genderPolicy.toLowerCase()} residents.`);
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
    },
  });

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

export type CheckInInput = { allocationId: string; actorId: string; notes?: string | null; today?: string };

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
      ...(input.notes ? { notes: input.notes } : {}),
      ...(earlyArrival ? { startDate: toDate(today) } : {}),
    },
  });
  await recordAudit(
    { actorId: input.actorId, action: "ALLOCATION_CHECKED_IN", entityType: "Allocation", entityId: allocation.id, after: { bedCode: allocation.bed.code, checkedInAt: now.toISOString(), earlyArrival, notes: input.notes ?? null } },
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
  const [keys, assets] = await Promise.all([
    db.keyTransaction.findMany({ where: { holderId: staffId, type: "ISSUE", returnedAt: null }, include: { key: true } }),
    db.assetAssignment.findMany({ where: { staffId, endedAt: null }, include: { item: true } }),
  ]);
  return [
    ...keys.map((k) => ({ type: "KEY" as const, label: `Key ${k.key.code}${k.key.label ? ` (${k.key.label})` : ""}` })),
    ...assets.map((a) => ({ type: "ASSET" as const, label: `${a.item.name}${a.item.serialNumber ? ` #${a.item.serialNumber}` : ""}` })),
  ];
}

export type CheckOutInput = {
  allocationId: string;
  actorId: string;
  notes?: string | null;
  today?: string;
  overrideReason?: string | null;
  canOverride?: boolean;
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
  }

  const now = new Date();
  const keepEnd = allocation.endDate && isoDate(allocation.endDate) <= today;
  const updated = await tx.allocation.update({
    where: { id: allocation.id },
    data: {
      status: "CHECKED_OUT",
      checkedOutAt: now,
      ...(keepEnd ? {} : { endDate: toDate(today) }),
      ...(input.notes ? { notes: input.notes } : {}),
    },
  });
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

      await recordAudit(
        { actorId: input.actorId, action: "ALLOCATION_TRANSFERRED", entityType: "Allocation", entityId: current.id, after: { fromBedCode: current.bed.code, toBedId: input.toBedId, toAllocationId: created.id, effectiveDate: input.effectiveDate, reason } },
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

export async function listAllocations(filter: AllocationListFilter) {
  const where: Prisma.AllocationWhereInput =
    filter === "active"
      ? { status: "CHECKED_IN" }
      : filter === "upcoming"
        ? { status: "CONFIRMED" }
        : filter === "history"
          ? { status: { in: ["CHECKED_OUT", "CANCELLED", "REJECTED", "EXPIRED"] } }
          : {};
  return prisma.allocation.findMany({
    where,
    include: { staff: true, bed: { include: bedWithLocation } },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
}
