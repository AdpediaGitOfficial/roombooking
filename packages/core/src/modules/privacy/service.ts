// Privacy and retention (document sections 9 and 12; DPDP Act 2023): consent at first login, residents viewing their data
// and asking for correction or erasure (Compliance approves, the Super Admin executes), and retention periods per record type.
import type { DataRequestKind, Prisma, RetentionAction } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { actorCan, type ActorLike } from "../../lib/permissions/actor";
import { registerChangeApplier, submitChange } from "../admin/change-requests";

export class PrivacyError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "INVALID_STATE", message: string) {
    super(message);
    this.name = "PrivacyError";
  }
}

export const CONSENT_VERSION = process.env.CONSENT_VERSION ?? "2026-10";
export const CONSENT_TEXT = [
  "We hold your name, employee ID, contact details, stay history, requests, visitors and, where used, charges, to run your accommodation.",
  "Reception, your accommodation officers and, for emergencies and entry, Security see only what their role needs. ID numbers and HR details are masked for everyone except Accommodation Admins.",
  "Records are kept for the retention periods set by your organisation and then archived or anonymised.",
  "You can see your data on your profile page and ask for a correction or for erasure at any time.",
];

export const consentNeeded = (u: { consentAcceptedAt: Date | null; consentVersion: string | null }) => !u.consentAcceptedAt || u.consentVersion !== CONSENT_VERSION;

export async function acceptConsent(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { consentAcceptedAt: new Date(), consentVersion: CONSENT_VERSION } });
  await recordAudit({ actorId: userId, action: "CONSENT_ACCEPTED", entityType: "User", entityId: userId, after: { version: CONSENT_VERSION } });
}

// ---------------------------------------------------------------------------
// Data-subject requests
// ---------------------------------------------------------------------------

export async function submitDataRequest(userId: string, kind: DataRequestKind, detail?: string | null) {
  if ((kind === "CORRECTION" || kind === "ERASURE") && !detail?.trim()) throw new PrivacyError("VALIDATION", kind === "ERASURE" ? "Say why you want your data erased." : "Say what needs correcting.");
  if (await prisma.dataRequest.findFirst({ where: { userId, kind, status: { in: ["REQUESTED", "COMPLIANCE_APPROVED"] } } })) throw new PrivacyError("INVALID_STATE", "You already have an open request of that kind.");
  const req = await prisma.dataRequest.create({ data: { userId, kind, detail: detail?.trim() || null } });
  await recordAudit({ actorId: userId, action: "DATA_REQUEST_SUBMITTED", entityType: "DataRequest", entityId: req.id, after: { kind } });
  const deciders = await prisma.user.findMany({ where: { status: "ACTIVE", roleAssignments: { some: { role: { in: ["ACCOMMODATION_ADMIN"] } } } }, select: { id: true } });
  await prisma.$transaction(async (tx) => { for (const a of deciders) await enqueueNotification(tx, { recipientId: a.id, event: "data_request.pending", idempotencyKey: `dr:${req.id}:${a.id}`, payload: { requestId: req.id, kind } }); });
  return req;
}

export const myDataRequests = (userId: string) => prisma.dataRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 });

export async function listDataRequests(opts: { open?: boolean } = {}) {
  const rows = await prisma.dataRequest.findMany({ where: opts.open ? { status: { in: ["REQUESTED", "COMPLIANCE_APPROVED"] } } : {}, orderBy: { createdAt: "desc" }, take: 200 });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true, username: true } })).map((u) => [u.id, u]));
  return rows.map((r) => ({ ...r, user: users.get(r.userId) ?? null }));
}

/** Compliance (an Accommodation Admin holding the Compliance set) approves or rejects. Not for a request about themselves. */
export async function decideDataRequest(actor: ActorLike, requestId: string, approve: boolean, note?: string | null) {
  const r = await prisma.dataRequest.findUnique({ where: { id: requestId } });
  if (!r) throw new PrivacyError("NOT_FOUND", "Request not found.");
  if (!actorCan(actor, "priv.decide")) throw new PrivacyError("FORBIDDEN", "Only Compliance can decide data requests.");
  if (r.userId === actor.id) throw new PrivacyError("FORBIDDEN", "You cannot decide a request about yourself.");
  if (r.status !== "REQUESTED") throw new PrivacyError("INVALID_STATE", "That request has already been decided.");
  if (!approve && !note?.trim()) throw new PrivacyError("VALIDATION", "Give a reason for rejecting.");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.dataRequest.update({ where: { id: requestId }, data: { status: approve ? "COMPLIANCE_APPROVED" : "REJECTED", decidedById: actor.id, decidedAt: new Date(), decisionNote: note?.trim() || null } });
    await recordAudit({ actorId: actor.id, action: approve ? "DATA_REQUEST_APPROVED" : "DATA_REQUEST_REJECTED", entityType: "DataRequest", entityId: requestId, after: { kind: r.kind, note: note ?? null } }, tx);
    await enqueueNotification(tx, { recipientId: r.userId, event: "data_request.decided", idempotencyKey: `dr.decided:${requestId}`, payload: { kind: r.kind, decision: approve ? "approved" : "rejected", note: note ?? null } });
    if (approve && r.kind === "ERASURE") {
      const sas = await tx.user.findMany({ where: { status: "ACTIVE", roleAssignments: { some: { role: "SYSTEM_ADMIN" } } }, select: { id: true } });
      for (const sa of sas) await enqueueNotification(tx, { recipientId: sa.id, event: "data_request.pending", idempotencyKey: `dr.exec:${requestId}:${sa.id}`, payload: { requestId, kind: "ERASURE" } });
    }
    return updated;
  });
}

/** A resident's own data, as one downloadable record (the "view my data" right). */
export async function buildDataExport(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, name: true, email: true, whatsappNumber: true, createdAt: true, consentAcceptedAt: true, consentVersion: true } });
  if (!user) throw new PrivacyError("NOT_FOUND", "Account not found.");
  const staff = await prisma.staffProfile.findUnique({ where: { userId }, include: { dependents: true } });
  const sid = staff?.id ?? "-";
  const [allocations, requests, workOrders, bookings, visitors, parcels, charges, claims] = await Promise.all([
    prisma.allocation.findMany({ where: { staffId: sid }, include: { bed: { include: { room: { include: { building: true } } } } }, orderBy: { startDate: "desc" } }),
    prisma.request.findMany({ where: { requesterId: userId }, include: { requestType: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.workOrder.findMany({ where: { requesterId: userId }, orderBy: { createdAt: "desc" }, take: 200, select: { ticketNumber: true, category: true, description: true, status: true, createdAt: true } }),
    prisma.facilityBooking.findMany({ where: { userId }, include: { facility: true }, orderBy: { startsAt: "desc" }, take: 200 }),
    prisma.visitor.findMany({ where: { OR: [{ hostUserId: userId }, { registeredById: userId }] }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.parcel.findMany({ where: { staffId: sid }, orderBy: { receivedAt: "desc" }, take: 100 }),
    prisma.charge.findMany({ where: { staffId: sid }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.lostFoundClaim.findMany({ where: { claimantId: sid }, take: 100 }),
  ]);
  await recordAudit({ actorId: userId, action: "DATA_EXPORT_OWN", entityType: "User", entityId: userId });
  return {
    generatedAt: new Date().toISOString(),
    account: user,
    profile: staff ? { employeeId: staff.employeeId, name: `${staff.firstName} ${staff.lastName}`, phone: staff.phone, email: staff.email, department: staff.department, grade: staff.grade, idType: staff.idType, idNumber: staff.idNumber, nationality: staff.nationality, emergencyContact: { name: staff.emergencyContactName, phone: staff.emergencyContactPhone }, dependents: staff.dependents.map((d) => ({ name: d.name, relationship: d.relationship, status: d.status })) } : null,
    stays: allocations.map((a) => ({ bed: a.bed.code, room: a.bed.room.code, building: a.bed.room.building.name, from: a.startDate, to: a.endDate, status: a.status })),
    requests: requests.map((r) => ({ type: r.requestType.name, status: r.status, createdAt: r.createdAt })),
    maintenance: workOrders, facilityBookings: bookings.map((b) => ({ facility: b.facility.name, from: b.startsAt, to: b.endsAt, status: b.status })),
    visitors: visitors.map((v) => ({ name: v.name, kind: v.kind, status: v.status, expectedAt: v.expectedAt })), parcels: parcels.map((p) => ({ carrier: p.carrier, receivedAt: p.receivedAt, status: p.status })),
    charges: charges.map((c) => ({ description: c.description, amount: Number(c.amount), status: c.status })), lostAndFoundClaims: claims.length,
  };
}

const ERASED = "Erased";

/** Anonymises a person's personal data in place. Operational history stays (for safety, audit and finance) but no longer identifies them. */
export async function anonymiseStaff(tx: Prisma.TransactionClient, staffId: string, actorId: string | null) {
  const s = await tx.staffProfile.findUnique({ where: { id: staffId } });
  if (!s) return;
  await tx.staffProfile.update({ where: { id: staffId }, data: { firstName: ERASED, lastName: "Person", phone: null, email: null, idType: null, idNumber: null, nationality: null, emergencyContactName: null, emergencyContactPhone: null, photoAttachmentId: null, department: null, company: null, designation: null, hrmsId: null, employeeId: `ERASED-${staffId.slice(-8)}`, archivedAt: s.archivedAt ?? new Date(), archiveReason: s.archiveReason ?? "Erased on request", employmentStatus: "TERMINATED", userId: null } });
  await tx.dependent.updateMany({ where: { staffId }, data: { name: ERASED, idNumber: null, dateOfBirth: null } });
  if (s.userId) await tx.user.update({ where: { id: s.userId }, data: { name: ERASED, email: `erased-${s.userId}@invalid.local`, username: `erased_${s.userId.slice(-10)}`, status: "DEACTIVATED", whatsappNumber: null, passwordHash: "!" } });
  if (s.userId) await tx.session.deleteMany({ where: { userId: s.userId } });
  await recordAudit({ actorId, action: "STAFF_ERASED", entityType: "StaffProfile", entityId: staffId, after: { employeeId: s.employeeId } }, tx);
}

/** The Super Admin carries out an approved erasure or marks an approved correction done. Never the person who approved it. */
export async function executeDataRequest(actor: ActorLike, requestId: string) {
  const r = await prisma.dataRequest.findUnique({ where: { id: requestId } });
  if (!r) throw new PrivacyError("NOT_FOUND", "Request not found.");
  if (!actorCan(actor, "priv.execute")) throw new PrivacyError("FORBIDDEN", "Only a Super Admin can carry out an approved request.");
  if (r.status !== "COMPLIANCE_APPROVED") throw new PrivacyError("INVALID_STATE", "Compliance has not approved that request.");
  if (r.decidedById === actor.id) throw new PrivacyError("FORBIDDEN", "Someone other than the approver must carry it out.");
  return prisma.$transaction(async (tx) => {
    if (r.kind === "ERASURE") {
      const staff = await tx.staffProfile.findUnique({ where: { userId: r.userId } });
      if (staff) {
        const live = await tx.allocation.count({ where: { staffId: staff.id, status: { in: ["CHECKED_IN", "CONFIRMED"] } } });
        if (live) throw new PrivacyError("INVALID_STATE", "The person still holds a bed: check them out before erasing their data.");
        const held = await tx.keyTransaction.count({ where: { holderId: staff.id, type: "ISSUE", returnedAt: null } });
        if (held) throw new PrivacyError("INVALID_STATE", "The person still holds keys: record their return first.");
        await anonymiseStaff(tx, staff.id, actor.id);
      } else await tx.user.update({ where: { id: r.userId }, data: { name: ERASED, status: "DEACTIVATED", passwordHash: "!" } });
    }
    const done = await tx.dataRequest.update({ where: { id: requestId }, data: { status: "COMPLETED", completedById: actor.id, completedAt: new Date() } });
    await recordAudit({ actorId: actor.id, action: "DATA_REQUEST_COMPLETED", entityType: "DataRequest", entityId: requestId, after: { kind: r.kind } }, tx);
    return done;
  });
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export const RETENTION_TYPES: Array<{ type: string; label: string; actions: RetentionAction[]; defaultDays: number }> = [
  { type: "VISITORS", label: "Visitor records", actions: ["ANONYMISE", "DELETE"], defaultDays: 365 },
  { type: "GATE_LOGS", label: "Contractor visit / gate logs", actions: ["DELETE"], defaultDays: 365 },
  { type: "NOTIFICATIONS", label: "Notifications", actions: ["DELETE"], defaultDays: 180 },
  { type: "CHECKED_OUT_RESIDENTS", label: "Checked-out residents (personal data)", actions: ["ANONYMISE"], defaultDays: 730 },
  { type: "PARCELS", label: "Parcel log", actions: ["DELETE"], defaultDays: 180 },
];

export async function listRetention(organizationId: string) {
  const rows = await prisma.retentionPolicy.findMany({ where: { organizationId } });
  return RETENTION_TYPES.map((t) => ({ ...t, policy: rows.find((r) => r.recordType === t.type) ?? null }));
}

/** Retention changes need a second Super Admin (document 12, maker-checker). */
export async function proposeRetention(actor: ActorLike, organizationId: string, input: { recordType: string; retainDays: number; action: RetentionAction; active: boolean }) {
  if (!actorCan(actor, "setup.retention")) throw new PrivacyError("FORBIDDEN", "Only a Super Admin can change retention.");
  const t = RETENTION_TYPES.find((x) => x.type === input.recordType);
  if (!t) throw new PrivacyError("VALIDATION", "Unknown record type.");
  if (!t.actions.includes(input.action)) throw new PrivacyError("VALIDATION", `${t.label} can be ${t.actions.join(" or ").toLowerCase()}d.`.replace("deleted", "deleted"));
  if (!Number.isInteger(input.retainDays) || input.retainDays < 30) throw new PrivacyError("VALIDATION", "Keep records for at least 30 days.");
  return submitChange({ organizationId, actorId: actor.id, summary: `Retention: ${t.label} ${input.active ? `${input.action.toLowerCase()} after ${input.retainDays} days` : "switched off"}`, payload: { op: "retention.set", recordType: input.recordType, retainDays: input.retainDays, action: input.action, active: input.active } });
}

registerChangeApplier("retention.set", async (payload, ctx) => {
  if (payload.op !== "retention.set") return;
  await prisma.retentionPolicy.upsert({ where: { organizationId_recordType: { organizationId: ctx.organizationId, recordType: payload.recordType } }, update: { retainDays: payload.retainDays, action: payload.action, active: payload.active }, create: { organizationId: ctx.organizationId, recordType: payload.recordType, retainDays: payload.retainDays, action: payload.action, active: payload.active } });
  await recordAudit({ actorId: ctx.requestedById, action: "RETENTION_SET", entityType: "RetentionPolicy", entityId: payload.recordType, after: { retainDays: payload.retainDays, action: payload.action, active: payload.active, approvedBy: ctx.approvedById } });
});

/** Daily: applies every active retention policy and returns the number of records touched per type. */
export async function runRetention(now: Date = new Date()) {
  const policies = await prisma.retentionPolicy.findMany({ where: { active: true } });
  const out: Record<string, number> = {};
  for (const p of policies) {
    const cutoff = new Date(now.getTime() - p.retainDays * 86400000);
    let n = 0;
    switch (p.recordType) {
      case "VISITORS":
        n = p.action === "DELETE"
          ? (await prisma.visitor.deleteMany({ where: { createdAt: { lt: cutoff }, status: { notIn: ["CHECKED_IN", "APPROVED", "PENDING_APPROVAL"] } } })).count
          : (await prisma.visitor.updateMany({ where: { createdAt: { lt: cutoff }, name: { not: ERASED }, status: { notIn: ["CHECKED_IN", "APPROVED", "PENDING_APPROVAL"] } }, data: { name: ERASED, phone: null, idType: null, idNumber: null, vehicle: null, company: null } })).count;
        break;
      case "GATE_LOGS": n = (await prisma.contractorVisit.deleteMany({ where: { scheduledEnd: { lt: cutoff }, status: { in: ["CHECKED_OUT", "CANCELLED", "DENIED"] } } })).count; break;
      case "NOTIFICATIONS": n = (await prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } })).count; break;
      case "PARCELS": n = (await prisma.parcel.deleteMany({ where: { receivedAt: { lt: cutoff }, status: { in: ["COLLECTED", "RETURNED"] } } })).count; break;
      case "CHECKED_OUT_RESIDENTS": {
        const people = await prisma.staffProfile.findMany({ where: { archivedAt: { lt: cutoff }, firstName: { not: ERASED }, allocations: { none: { status: { in: ["CHECKED_IN", "CONFIRMED"] } } } }, select: { id: true }, take: 500 });
        for (const s of people) await prisma.$transaction((tx) => anonymiseStaff(tx, s.id, null));
        n = people.length; break;
      }
    }
    if (n > 0) await recordAudit({ actorId: null, action: "RETENTION_APPLIED", entityType: "RetentionPolicy", entityId: p.recordType, after: { records: n, action: p.action, cutoff: cutoff.toISOString().slice(0, 10) }, source: "worker" });
    out[p.recordType] = n;
  }
  return out;
}
