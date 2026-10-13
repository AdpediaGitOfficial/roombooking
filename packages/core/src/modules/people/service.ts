// Staff directory (document 4, People): profiles, verification queue, eligibility and entitlement,
// dependents, guest and trainee profiles, duplicate matching and merging, rehire.
import type { GenderPolicy, Prisma, StaffProfileType, StaffSource } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { actorCan, principalOf, type ActorLike } from "../../lib/permissions/actor";
import { dataScope } from "../../lib/permissions/engine";
import { personLevel, viewPerson, type PersonRecord } from "../../lib/permissions/privacy";
import { OCCUPYING_STATUSES } from "../accommodation/occupancy";
import { clearanceBlockers } from "../allocations/service";
import { PeopleError } from "./errors";

type Db = Prisma.TransactionClient;

export const PROFILE_TYPES: StaffProfileType[] = ["EMPLOYEE", "CONTRACT_WORKER", "GUEST", "TRAINEE"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Resident lifecycle (document section 8)
// ---------------------------------------------------------------------------

export type StayStatus = "UNVERIFIED" | "ELIGIBLE" | "WAITLISTED" | "REQUESTED" | "RESERVED" | "PROVISIONAL" | "CHECKED_IN" | "CHECKOUT_DUE" | "OVERSTAY" | "CHECKED_OUT" | "ARCHIVED";

type StayInput = {
  verificationStatus: string;
  archivedAt: Date | null;
  allocations: Array<{ status: string; startDate: Date; endDate: Date | null; provisional: boolean }>;
  waitlist: Array<{ status: string }>;
  exits: Array<{ status: string; lastDay: Date }>;
  joiners?: Array<{ status: string }>;
};

/** Unverified -> Eligible -> Requested -> Reserved -> Checked in -> Checkout due -> Checked out -> Archived (plus Waitlisted, Provisional, Overstay). */
export function stayStatus(p: StayInput, today: string): StayStatus {
  if (p.archivedAt) return "ARCHIVED";
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const checkedIn = p.allocations.find((a) => a.status === "CHECKED_IN");
  if (checkedIn) {
    if (checkedIn.provisional) return "PROVISIONAL";
    const exit = p.exits.find((e) => e.status !== "CLEARED" && e.status !== "CANCELLED");
    if (checkedIn.endDate && iso(checkedIn.endDate) < today) return "OVERSTAY";
    if ((checkedIn.endDate && Date.parse(iso(checkedIn.endDate)) - Date.parse(today) <= 3 * 86400000) || exit?.status === "CHECKOUT_DUE") return "CHECKOUT_DUE";
    return "CHECKED_IN";
  }
  if (p.verificationStatus === "UNVERIFIED") return "UNVERIFIED";
  if (p.allocations.some((a) => a.status === "CONFIRMED")) return "RESERVED";
  if (p.waitlist.some((w) => w.status === "WAITING" || w.status === "OFFERED")) return "WAITLISTED";
  if (p.joiners?.some((j) => j.status === "EXPECTED")) return "REQUESTED";
  if (p.allocations.some((a) => a.status === "CHECKED_OUT")) return "CHECKED_OUT";
  return "ELIGIBLE";
}

export const STAY_LABEL: Record<StayStatus, string> = {
  UNVERIFIED: "Unverified", ELIGIBLE: "Eligible", WAITLISTED: "Waitlisted", REQUESTED: "Requested", RESERVED: "Reserved",
  PROVISIONAL: "Provisional (emergency)", CHECKED_IN: "Checked in", CHECKOUT_DUE: "Checkout due", OVERSTAY: "Overstay", CHECKED_OUT: "Checked out", ARCHIVED: "Archived",
};

// ---------------------------------------------------------------------------
// Directory
// ---------------------------------------------------------------------------

export type PeopleFilter = { q?: string | null; profileType?: StaffProfileType | null; verification?: "UNVERIFIED" | "VERIFIED" | null; archived?: boolean; siteScope?: string[] | null; take?: number };

const personInclude = {
  allocations: { where: { status: { in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] as const } }, orderBy: { startDate: "desc" as const }, take: 5, include: { bed: { include: { room: { include: { building: { include: { site: true } } } } } } } },
  waitlistEntries: { where: { status: { in: ["WAITING", "OFFERED"] as const } }, select: { status: true } },
  exitCases: { orderBy: { createdAt: "desc" as const }, take: 3, select: { status: true, lastDay: true, id: true } },
  joiners: { where: { status: "EXPECTED" as const }, select: { status: true } },
} satisfies Prisma.StaffProfileInclude;

export type PersonRow = Prisma.StaffProfileGetPayload<{ include: typeof personInclude }>;

/** Lists staff for the directory. Site-scoped admins see people at their sites plus those not yet placed anywhere. */
export async function listPeople(actor: ActorLike, filter: PeopleFilter = {}) {
  const scope = dataScope(principalOf(actor), "people.view");
  const where: Prisma.StaffProfileWhereInput = { archivedAt: filter.archived ? { not: null } : null, mergedIntoId: null };
  if (filter.profileType) where.profileType = filter.profileType;
  if (filter.verification) where.verificationStatus = filter.verification;
  const q = filter.q?.trim();
  if (q) where.OR = [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { employeeId: { contains: q, mode: "insensitive" } }, { department: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }];
  if (!scope.all) {
    const sites = filter.siteScope ?? scope.siteIds;
    where.AND = [{ OR: [{ allocations: { none: { status: { in: OCCUPYING_STATUSES } } } }, { allocations: { some: { status: { in: OCCUPYING_STATUSES }, bed: { room: { building: { siteId: { in: sites } } } } } } }] }];
  }
  const rows = await prisma.staffProfile.findMany({ where, include: personInclude, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: filter.take ?? 200 });
  const level = personLevel(actor);
  return rows.map((r) => ({ row: r, view: viewPerson(level, r as unknown as PersonRecord) }));
}

export async function getPerson(actor: ActorLike, id: string) {
  const row = await prisma.staffProfile.findUnique({
    where: { id },
    include: { ...personInclude, dependents: { where: { archivedAt: null }, orderBy: { createdAt: "asc" } }, user: { select: { id: true, username: true, status: true } } },
  });
  if (!row) throw new PeopleError("NOT_FOUND", "Staff record not found.");
  const siteId = row.allocations.find((a) => a.status === "CHECKED_IN" || a.status === "CONFIRMED")?.bed.room.building.siteId ?? null;
  const level = personLevel(actor, { siteId });
  if (level === "NONE") throw new PeopleError("FORBIDDEN", "Your role does not allow viewing staff records.");
  return { row, view: viewPerson(level, row as unknown as PersonRecord)!, level, siteId };
}

// ---------------------------------------------------------------------------
// Add, verify, edit
// ---------------------------------------------------------------------------

export type StaffInput = {
  employeeId: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string | null;
  gender?: GenderPolicy;
  department?: string | null;
  company?: string | null;
  grade?: string | null;
  designation?: string | null;
  idType?: string | null;
  idNumber?: string | null;
  nationality?: string | null;
  joiningDate?: string | null;
  profileType?: StaffProfileType;
  profileEndDate?: string | null;
  source?: StaffSource;
  hrmsId?: string | null;
};

function parseDate(v: string | null | undefined, field: string): Date | null {
  if (!v) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new PeopleError("VALIDATION", "Enter a valid date.", { [field]: "Invalid date." });
  return d;
}

function validateStaff(input: StaffInput) {
  const errors: Record<string, string> = {};
  if (!input.employeeId?.trim()) errors.employeeId = "Enter an employee or reference ID.";
  if (!input.firstName?.trim()) errors.firstName = "Enter the first name.";
  if (!input.lastName?.trim()) errors.lastName = "Enter the last name.";
  if (input.email && !EMAIL.test(input.email.trim())) errors.email = "Enter a valid email address.";
  const type = input.profileType ?? "EMPLOYEE";
  if ((type === "GUEST" || type === "TRAINEE") && !input.profileEndDate) errors.profileEndDate = "Guests and trainees need a fixed end date.";
  if (Object.keys(errors).length) throw new PeopleError("VALIDATION", "Please correct the highlighted fields.", errors);
}

/**
 * Adds a staff profile. People added by someone who cannot verify (an Officer with the grant, for walk-ins) stay
 * Unverified until an Accommodation Admin verifies them; Admins' own additions are verified at once.
 */
export async function addStaff(actor: ActorLike, organizationId: string, input: StaffInput) {
  if (!actorCan(actor, "people.add")) throw new PeopleError("FORBIDDEN", "Your role does not allow adding staff.");
  validateStaff(input);
  const type = input.profileType ?? "EMPLOYEE";
  if (type !== "EMPLOYEE" && !actorCan(actor, "people.guest") && !actorCan(actor, "people.verify")) throw new PeopleError("FORBIDDEN", "Your role does not allow adding guest or contract profiles.");
  const employeeId = input.employeeId.trim();
  if (await prisma.staffProfile.findUnique({ where: { organizationId_employeeId: { organizationId, employeeId } } })) throw new PeopleError("CONFLICT", "That employee ID already exists.", { employeeId: "Already in use." });
  const verified = actorCan(actor, "people.verify");
  return prisma.$transaction(async (tx) => {
    const staff = await tx.staffProfile.create({
      data: {
        organizationId, employeeId, firstName: input.firstName.trim(), lastName: input.lastName.trim(), phone: input.phone?.trim() || null, email: input.email?.trim().toLowerCase() || null,
        gender: input.gender ?? "ANY", department: input.department?.trim() || null, company: input.company?.trim() || null, grade: input.grade?.trim() || null, designation: input.designation?.trim() || null,
        idType: input.idType?.trim() || null, idNumber: input.idNumber?.trim() || null, nationality: input.nationality?.trim() || null, joiningDate: parseDate(input.joiningDate, "joiningDate"),
        profileType: type, profileEndDate: parseDate(input.profileEndDate, "profileEndDate"), source: input.source ?? "MANUAL", hrmsId: input.hrmsId ?? null,
        verificationStatus: verified ? "VERIFIED" : "UNVERIFIED", verifiedAt: verified ? new Date() : null, verifiedById: verified ? actor.id : null,
      },
    });
    await recordAudit({ actorId: actor.id, action: "STAFF_ADDED", entityType: "StaffProfile", entityId: staff.id, after: { employeeId, profileType: type, verification: staff.verificationStatus, source: staff.source } }, tx);
    return staff;
  });
}

/** Verifies an unverified profile. Whoever added it cannot also verify it (decide, execute, verify are separated). */
export async function verifyStaff(actor: ActorLike, staffId: string) {
  if (!actorCan(actor, "people.verify")) throw new PeopleError("FORBIDDEN", "Only an Accommodation Admin can verify staff records.");
  const staff = await prisma.staffProfile.findUnique({ where: { id: staffId } });
  if (!staff) throw new PeopleError("NOT_FOUND", "Staff record not found.");
  if (staff.verificationStatus === "VERIFIED") throw new PeopleError("INVALID_STATE", "That profile is already verified.");
  const added = await prisma.auditEvent.findFirst({ where: { action: "STAFF_ADDED", entityId: staffId }, orderBy: { createdAt: "asc" } });
  if (added?.actorId === actor.id) throw new PeopleError("FORBIDDEN", "You added this profile, so someone else must verify it.");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.staffProfile.update({ where: { id: staffId }, data: { verificationStatus: "VERIFIED", verifiedAt: new Date(), verifiedById: actor.id } });
    await recordAudit({ actorId: actor.id, action: "STAFF_VERIFIED", entityType: "StaffProfile", entityId: staffId, after: { employeeId: staff.employeeId } }, tx);
    return updated;
  });
}

export async function updateStaff(actor: ActorLike, staffId: string, input: Partial<StaffInput>) {
  if (!actorCan(actor, "people.verify")) throw new PeopleError("FORBIDDEN", "Only an Accommodation Admin can edit staff master data.");
  const staff = await prisma.staffProfile.findUnique({ where: { id: staffId } });
  if (!staff) throw new PeopleError("NOT_FOUND", "Staff record not found.");
  if (input.email && !EMAIL.test(input.email.trim())) throw new PeopleError("VALIDATION", "Enter a valid email address.", { email: "Invalid email." });
  const data: Prisma.StaffProfileUpdateInput = {};
  const set = <K extends keyof StaffInput>(k: K, map: (v: NonNullable<StaffInput[K]>) => unknown = (v) => v) => { if (input[k] !== undefined) (data as Record<string, unknown>)[k as string] = input[k] ? map(input[k] as NonNullable<StaffInput[K]>) : null; };
  set("firstName", (v) => String(v).trim()); set("lastName", (v) => String(v).trim()); set("phone", (v) => String(v).trim()); set("email", (v) => String(v).trim().toLowerCase());
  set("department", (v) => String(v).trim()); set("company", (v) => String(v).trim()); set("grade", (v) => String(v).trim()); set("designation", (v) => String(v).trim());
  set("idType", (v) => String(v).trim()); set("idNumber", (v) => String(v).trim()); set("nationality", (v) => String(v).trim());
  if (input.gender) data.gender = input.gender;
  if (input.joiningDate !== undefined) data.joiningDate = parseDate(input.joiningDate, "joiningDate");
  if (input.profileEndDate !== undefined) data.profileEndDate = parseDate(input.profileEndDate, "profileEndDate");
  if (input.profileType) data.profileType = input.profileType;
  if (input.firstName === "" || input.lastName === "") throw new PeopleError("VALIDATION", "Names cannot be empty.", { firstName: "Required." });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.staffProfile.update({ where: { id: staffId }, data });
    await recordAudit({ actorId: actor.id, action: "STAFF_UPDATED", entityType: "StaffProfile", entityId: staffId, before: { firstName: staff.firstName, lastName: staff.lastName, grade: staff.grade, department: staff.department, profileType: staff.profileType }, after: { firstName: updated.firstName, lastName: updated.lastName, grade: updated.grade, department: updated.department, profileType: updated.profileType } }, tx);
    return updated;
  });
}

/** Eligibility category and entitlement (room types, maximum stay) that the allocation engine checks. */
export async function setEntitlement(actor: ActorLike, staffId: string, input: { eligibilityCategory?: string | null; roomTypes?: string[]; maxDays?: number | null; maxSharing?: number | null }) {
  if (!actorCan(actor, "people.eligibility")) throw new PeopleError("FORBIDDEN", "Only an Accommodation Admin can set eligibility and entitlement.");
  const staff = await prisma.staffProfile.findUnique({ where: { id: staffId } });
  if (!staff) throw new PeopleError("NOT_FOUND", "Staff record not found.");
  if (input.maxDays != null && (!Number.isInteger(input.maxDays) || input.maxDays < 1)) throw new PeopleError("VALIDATION", "Maximum stay must be a whole number of days.", { maxDays: "Invalid." });
  const entitlement = { roomTypes: input.roomTypes ?? [], ...(input.maxDays ? { maxDays: input.maxDays } : {}), ...(input.maxSharing ? { maxSharing: input.maxSharing } : {}) };
  return prisma.$transaction(async (tx) => {
    const updated = await tx.staffProfile.update({ where: { id: staffId }, data: { eligibilityCategory: input.eligibilityCategory?.trim() || null, entitlement } });
    await recordAudit({ actorId: actor.id, action: "STAFF_ENTITLEMENT_SET", entityType: "StaffProfile", entityId: staffId, before: { eligibilityCategory: staff.eligibilityCategory, entitlement: staff.entitlement as Prisma.InputJsonValue }, after: { eligibilityCategory: updated.eligibilityCategory, entitlement } }, tx);
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Dependents (Resident requests, Admin verifies)
// ---------------------------------------------------------------------------

export async function addDependent(actor: ActorLike, staffId: string, input: { name: string; relationship: string; dateOfBirth?: string | null; idNumber?: string | null }, opts: { ownStaffId?: string | null } = {}) {
  const own = opts.ownStaffId === staffId; // a resident may only request for their own record
  if (!own && !actorCan(actor, "people.dependents")) throw new PeopleError("FORBIDDEN", "Your role does not allow adding dependents.");
  if (own && !actor.roles.includes("STAFF")) throw new PeopleError("FORBIDDEN", "Not allowed.");
  if (!input.name?.trim() || !input.relationship?.trim()) throw new PeopleError("VALIDATION", "Enter the dependent's name and relationship.", { name: "Required." });
  const staff = await prisma.staffProfile.findUnique({ where: { id: staffId } });
  if (!staff) throw new PeopleError("NOT_FOUND", "Staff record not found.");
  const verifiedNow = !own && actorCan(actor, "people.verify");
  return prisma.$transaction(async (tx) => {
    const dep = await tx.dependent.create({ data: { staffId, name: input.name.trim(), relationship: input.relationship.trim(), dateOfBirth: parseDate(input.dateOfBirth, "dateOfBirth"), idNumber: input.idNumber?.trim() || null, status: verifiedNow ? "VERIFIED" : "PENDING", requestedById: actor.id, verifiedById: verifiedNow ? actor.id : null } });
    await recordAudit({ actorId: actor.id, action: "DEPENDENT_ADDED", entityType: "Dependent", entityId: dep.id, after: { staffId, relationship: dep.relationship, status: dep.status } }, tx);
    return dep;
  });
}

export async function decideDependent(actor: ActorLike, dependentId: string, approve: boolean, note?: string | null) {
  if (!actorCan(actor, "people.verify")) throw new PeopleError("FORBIDDEN", "Only an Accommodation Admin can verify dependents.");
  const dep = await prisma.dependent.findUnique({ where: { id: dependentId } });
  if (!dep) throw new PeopleError("NOT_FOUND", "Dependent not found.");
  if (dep.status !== "PENDING") throw new PeopleError("INVALID_STATE", "That dependent has already been decided.");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.dependent.update({ where: { id: dependentId }, data: { status: approve ? "VERIFIED" : "REJECTED", verifiedById: actor.id } });
    await recordAudit({ actorId: actor.id, action: approve ? "DEPENDENT_VERIFIED" : "DEPENDENT_REJECTED", entityType: "Dependent", entityId: dependentId, after: { note: note ?? null } }, tx);
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Duplicate matching and merge
// ---------------------------------------------------------------------------

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const phoneNorm = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-9);

export type DuplicateGroup = { reason: string; people: Array<{ id: string; employeeId: string; name: string; phone: string | null; verification: string; source: string }> };

/** Candidate duplicates by ID number, phone number, or the same name and department. */
export async function findDuplicates(organizationId: string): Promise<DuplicateGroup[]> {
  const rows = await prisma.staffProfile.findMany({ where: { organizationId, archivedAt: null, mergedIntoId: null }, select: { id: true, employeeId: true, firstName: true, lastName: true, phone: true, idNumber: true, department: true, verificationStatus: true, source: true } });
  const groups: DuplicateGroup[] = [];
  const seen = new Set<string>();
  const add = (reason: string, members: typeof rows) => {
    if (members.length < 2) return;
    const key = members.map((m) => m.id).sort().join("|");
    if (seen.has(key)) return;
    seen.add(key);
    groups.push({ reason, people: members.map((m) => ({ id: m.id, employeeId: m.employeeId, name: `${m.firstName} ${m.lastName}`, phone: m.phone, verification: m.verificationStatus, source: m.source })) });
  };
  const bucket = (fn: (r: (typeof rows)[number]) => string) => {
    const map = new Map<string, typeof rows>();
    for (const r of rows) { const k = fn(r); if (!k) continue; map.set(k, [...(map.get(k) ?? []), r]); }
    return [...map.values()];
  };
  for (const g of bucket((r) => norm(r.idNumber))) add("Same ID number", g);
  for (const g of bucket((r) => (phoneNorm(r.phone).length >= 8 ? phoneNorm(r.phone) : ""))) add("Same phone number", g);
  for (const g of bucket((r) => (norm(r.firstName) && norm(r.lastName) ? `${norm(r.firstName)}${norm(r.lastName)}${norm(r.department)}` : ""))) add("Same name and department", g);
  return groups;
}

/** Moves everything that refers to the merged profile onto the kept one, then retires the duplicate. */
export async function mergeStaff(actor: ActorLike, keepId: string, mergeId: string) {
  if (!actorCan(actor, "people.merge")) throw new PeopleError("FORBIDDEN", "Only an Accommodation Admin can merge profiles.");
  if (keepId === mergeId) throw new PeopleError("VALIDATION", "Choose two different profiles.");
  return prisma.$transaction(async (tx) => {
    const [keep, dup] = await Promise.all([tx.staffProfile.findUnique({ where: { id: keepId } }), tx.staffProfile.findUnique({ where: { id: mergeId } })]);
    if (!keep || !dup) throw new PeopleError("NOT_FOUND", "Staff record not found.");
    if (keep.userId && dup.userId) throw new PeopleError("INVALID_STATE", "Both profiles have a user account; deactivate one account first.");
    // Two live stays would be a real conflict, not a duplicate.
    const live = await tx.allocation.count({ where: { staffId: { in: [keepId, mergeId] }, status: { in: OCCUPYING_STATUSES } } });
    if (live > 1) throw new PeopleError("INVALID_STATE", "Both profiles hold a bed. Check one of them out before merging.");
    const moved = {
      allocations: (await tx.allocation.updateMany({ where: { staffId: mergeId }, data: { staffId: keepId } })).count,
      keys: (await tx.keyTransaction.updateMany({ where: { holderId: mergeId }, data: { holderId: keepId } })).count,
      assets: (await tx.assetAssignment.updateMany({ where: { staffId: mergeId }, data: { staffId: keepId } })).count,
      inventory: (await tx.inventoryTransaction.updateMany({ where: { staffId: mergeId }, data: { staffId: keepId } })).count,
      claims: (await tx.lostFoundClaim.updateMany({ where: { claimantId: mergeId }, data: { claimantId: keepId } })).count,
      dependents: (await tx.dependent.updateMany({ where: { staffId: mergeId }, data: { staffId: keepId } })).count,
      joiners: (await tx.joiner.updateMany({ where: { staffId: mergeId }, data: { staffId: keepId } })).count,
      exits: (await tx.exitCase.updateMany({ where: { staffId: mergeId }, data: { staffId: keepId } })).count,
      waitlist: (await tx.waitlistEntry.updateMany({ where: { staffId: mergeId }, data: { staffId: keepId } })).count,
    };
    // Fill gaps in the kept profile from the duplicate; never overwrite what is already there.
    const fill: Prisma.StaffProfileUpdateInput = {};
    for (const f of ["phone", "email", "department", "company", "grade", "designation", "idType", "idNumber", "nationality", "emergencyContactName", "emergencyContactPhone"] as const) if (!keep[f] && dup[f]) (fill as Record<string, unknown>)[f] = dup[f];
    await tx.staffProfile.update({ where: { id: mergeId }, data: { userId: null, mergedIntoId: keepId, archivedAt: new Date(), archivedById: actor.id, archiveReason: `Merged into ${keep.employeeId}` } });
    if (dup.userId && !keep.userId) fill.user = { connect: { id: dup.userId } };
    await tx.staffProfile.update({ where: { id: keepId }, data: fill });
    await recordAudit({ actorId: actor.id, action: "STAFF_MERGED", entityType: "StaffProfile", entityId: keepId, after: { mergedId: mergeId, mergedEmployeeId: dup.employeeId, moved } }, tx);
    return { keepId, mergedId: mergeId, moved };
  });
}

// ---------------------------------------------------------------------------
// Rehire / reactivate
// ---------------------------------------------------------------------------

export async function rehireStaff(actor: ActorLike, staffId: string) {
  if (!actorCan(actor, "people.rehire")) throw new PeopleError("FORBIDDEN", "Only an Accommodation Admin can rehire or reactivate staff.");
  const staff = await prisma.staffProfile.findUnique({ where: { id: staffId } });
  if (!staff) throw new PeopleError("NOT_FOUND", "Staff record not found.");
  if (!staff.archivedAt && staff.employmentStatus !== "TERMINATED") throw new PeopleError("INVALID_STATE", "That person is not archived or terminated.");
  if (staff.mergedIntoId) throw new PeopleError("INVALID_STATE", "That profile was merged into another; reactivate the kept profile instead.");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.staffProfile.update({ where: { id: staffId }, data: { archivedAt: null, archivedById: null, archiveReason: null, employmentStatus: "ACTIVE", verificationStatus: "UNVERIFIED", verifiedAt: null, verifiedById: null } });
    await recordAudit({ actorId: actor.id, action: "STAFF_REHIRED", entityType: "StaffProfile", entityId: staffId, after: { employeeId: staff.employeeId } }, tx);
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Guest and trainee profiles
// ---------------------------------------------------------------------------

/** Quick add of a guest or trainee with a fixed end date; the reference ID is generated. */
export async function addGuestProfile(actor: ActorLike, organizationId: string, input: Omit<StaffInput, "employeeId"> & { profileType: "GUEST" | "TRAINEE"; profileEndDate: string }) {
  if (!actorCan(actor, "people.guest")) throw new PeopleError("FORBIDDEN", "Your role does not allow adding guest or trainee profiles.");
  const count = await prisma.staffProfile.count({ where: { organizationId, profileType: { in: ["GUEST", "TRAINEE"] } } });
  const employeeId = `${input.profileType === "GUEST" ? "GST" : "TRN"}-${String(count + 1).padStart(5, "0")}-${Date.now().toString(36).slice(-3).toUpperCase()}`;
  return addStaff({ ...actor, grants: [...(actor.grants ?? []), { userId: actor.id, capability: "people.add" }] }, organizationId, { ...input, employeeId });
}

/** Guest and trainee profiles past their end date are archived by the daily sweep. */
export async function sweepExpiredProfiles(now: Date = new Date()) {
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const due = await prisma.staffProfile.findMany({ where: { archivedAt: null, profileEndDate: { lt: today }, allocations: { none: { status: { in: OCCUPYING_STATUSES } } } }, select: { id: true, employeeId: true } });
  for (const s of due) {
    await prisma.$transaction(async (tx) => {
      await tx.staffProfile.update({ where: { id: s.id }, data: { archivedAt: now, archiveReason: "Profile end date passed", employmentStatus: "TERMINATED" } });
      await recordAudit({ action: "STAFF_ARCHIVED", entityType: "StaffProfile", entityId: s.id, after: { reason: "Profile end date passed" }, source: "system" }, tx);
    });
  }
  return due.length;
}

export async function verificationQueue() {
  return prisma.staffProfile.findMany({ where: { verificationStatus: "UNVERIFIED", archivedAt: null, mergedIntoId: null }, orderBy: { createdAt: "asc" }, take: 200 });
}

/** Staff the actor can pick from when allocating or joining: active, verified (or any, for emergencies), not archived. */
export async function staffOptions(opts: { includeUnverified?: boolean; q?: string | null } = {}) {
  const q = opts.q?.trim();
  return prisma.staffProfile.findMany({
    where: { archivedAt: null, mergedIntoId: null, employmentStatus: "ACTIVE", ...(opts.includeUnverified ? {} : { verificationStatus: "VERIFIED" }), ...(q ? { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { employeeId: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 300,
    select: { id: true, employeeId: true, firstName: true, lastName: true, profileType: true, verificationStatus: true },
  });
}

export { clearanceBlockers, enqueueNotification };
