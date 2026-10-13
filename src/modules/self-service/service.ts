// Staff self-service: a resident's own stay, profile and notifications.
// Every function is scoped by the caller's own user / staff id; nothing here
// can read another resident's record (SRS 3.1).
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";
import { revokeOtherUserSessions } from "@/lib/auth/session-store";
import { OCCUPYING_STATUSES, classifyBed, isoDate, summarize, todayInTimezone } from "@/modules/accommodation/occupancy";

export class SelfServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelfServiceError";
  }
}

const stayInclude = {
  bed: { include: { room: { include: { building: { include: { site: true } } } } } },
} satisfies Prisma.AllocationInclude;

export type StayAllocation = Prisma.AllocationGetPayload<{ include: typeof stayInclude }>;

export type PendingAction = { kind: "ARRIVAL" | "DEPARTURE" | "MOVE"; text: string; date: string };

export type MyStay = {
  today: string;
  current: StayAllocation | null;
  upcoming: StayAllocation | null;
  history: StayAllocation[];
  roomSharing: { capacity: number; occupied: number } | null;
  pendingActions: PendingAction[];
};

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400000);
}

/** The resident's own stay, computed as of the site's local date. */
export async function getMyStay(staffId: string, now: Date = new Date()): Promise<MyStay> {
  const allocations = await prisma.allocation.findMany({
    where: { staffId },
    include: stayInclude,
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
  });

  const tz = allocations[0]?.bed.room.building.site.timezone ?? "UTC";
  const today = todayInTimezone(tz, now);

  const checkedIn = allocations.find((a) => a.status === "CHECKED_IN") ?? null;
  const confirmed = allocations.filter((a) => a.status === "CONFIRMED").sort((a, b) => isoDate(a.startDate).localeCompare(isoDate(b.startDate)));
  const started = confirmed.find((a) => isoDate(a.startDate) <= today && (!a.endDate || isoDate(a.endDate) > today)) ?? null;
  const current = checkedIn ?? started;
  const upcoming = confirmed.find((a) => a.id !== current?.id && isoDate(a.startDate) > today) ?? null;
  const history = allocations.filter((a) => a.status === "CHECKED_OUT" || a.status === "CANCELLED");

  let roomSharing: MyStay["roomSharing"] = null;
  if (current) {
    const beds = await prisma.bed.findMany({
      where: { roomId: current.bed.roomId },
      include: {
        allocations: {
          where: { status: { in: OCCUPYING_STATUSES } },
          include: { staff: { select: { id: true, employeeId: true, firstName: true, lastName: true } } },
        },
      },
    });
    const summary = summarize(beds.map((b) => classifyBed(b, today, current.bed.room.status)));
    roomSharing = { capacity: summary.capacity, occupied: summary.occupied };
  }

  const pendingActions: PendingAction[] = [];
  if (current && current.status === "CONFIRMED") {
    pendingActions.push({ kind: "ARRIVAL", date: isoDate(current.startDate), text: `Visit reception at ${current.bed.room.building.site.name} to check in to bed ${current.bed.code}.` });
  }
  if (upcoming) {
    const days = daysBetween(today, isoDate(upcoming.startDate));
    const kind = current ? "MOVE" : "ARRIVAL";
    pendingActions.push({
      kind,
      date: isoDate(upcoming.startDate),
      text: current
        ? `You move to bed ${upcoming.bed.code} (${upcoming.bed.room.building.name}, room ${upcoming.bed.room.code}) in ${days} day${days === 1 ? "" : "s"}.`
        : `Your stay in bed ${upcoming.bed.code} (${upcoming.bed.room.building.name}) starts in ${days} day${days === 1 ? "" : "s"}. Check in at reception on arrival.`,
    });
  }
  if (current?.endDate) {
    const days = daysBetween(today, isoDate(current.endDate));
    if (days <= 14 && !upcoming) {
      pendingActions.push({ kind: "DEPARTURE", date: isoDate(current.endDate), text: days <= 0 ? "Your stay has reached its end date. Please check out at reception." : `Your stay ends in ${days} day${days === 1 ? "" : "s"}. Return keys and check out at reception.` });
    }
  }

  return { today, current, upcoming, history, roomSharing, pendingActions };
}

// ---------------------------------------------------------------------------
// Profile (SS-03)
// ---------------------------------------------------------------------------

export type OwnProfileInput = { phone: string; emergencyContactName: string; emergencyContactPhone: string };

const PHONE = /^[+\d][\d\s().-]{5,24}$/;

export function validateOwnProfile(input: OwnProfileInput): string | null {
  if (input.phone && !PHONE.test(input.phone)) return "Enter a valid phone number.";
  if (input.emergencyContactPhone && !PHONE.test(input.emergencyContactPhone)) return "Enter a valid emergency contact phone number.";
  if (input.emergencyContactName.length > 120) return "Emergency contact name is too long.";
  if (input.emergencyContactPhone && !input.emergencyContactName) return "Enter the emergency contact's name.";
  return null;
}

/** Updates only the fields a resident may edit about themselves. */
export async function updateOwnProfile(staffId: string, actorId: string, raw: OwnProfileInput) {
  const input: OwnProfileInput = {
    phone: raw.phone.trim(),
    emergencyContactName: raw.emergencyContactName.trim(),
    emergencyContactPhone: raw.emergencyContactPhone.trim(),
  };
  const error = validateOwnProfile(input);
  if (error) throw new SelfServiceError(error);

  return prisma.$transaction(async (tx) => {
    const before = await tx.staffProfile.findUniqueOrThrow({ where: { id: staffId } });
    const after = await tx.staffProfile.update({
      where: { id: staffId },
      data: {
        phone: input.phone || null,
        emergencyContactName: input.emergencyContactName || null,
        emergencyContactPhone: input.emergencyContactPhone || null,
      },
    });
    await recordAudit(
      {
        actorId,
        action: "PROFILE_SELF_UPDATED",
        entityType: "StaffProfile",
        entityId: staffId,
        before: { phone: before.phone, emergencyContactName: before.emergencyContactName, emergencyContactPhone: before.emergencyContactPhone },
        after: { phone: after.phone, emergencyContactName: after.emergencyContactName, emergencyContactPhone: after.emergencyContactPhone },
      },
      tx,
    );
    return after;
  });
}

// ---------------------------------------------------------------------------
// Password change (ADM-05 / SS-08 baseline)
// ---------------------------------------------------------------------------

export async function changeOwnPassword(input: { userId: string; currentPassword: string; newPassword: string; keepSessionToken?: string | null }) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    await recordAudit({ actorId: user.id, action: "PASSWORD_CHANGE_FAILED", entityType: "User", entityId: user.id, after: { reason: "wrong_current_password" } });
    throw new SelfServiceError("Your current password is incorrect.");
  }
  const weak = validatePasswordStrength(input.newPassword);
  if (weak) throw new SelfServiceError(weak);
  if (input.newPassword === input.currentPassword) throw new SelfServiceError("Choose a password you have not used before.");

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date() } });
  const revoked = input.keepSessionToken ? await revokeOtherUserSessions(user.id, input.keepSessionToken) : 0;
  await recordAudit({ actorId: user.id, action: "PASSWORD_CHANGED", entityType: "User", entityId: user.id, after: { otherSessionsRevoked: revoked } });
  return { otherSessionsRevoked: revoked };
}

// ---------------------------------------------------------------------------
// In-app notifications
// ---------------------------------------------------------------------------

export async function listMyNotifications(userId: string, limit = 20) {
  return prisma.notification.findMany({
    where: { recipientId: userId, channel: "IN_APP" },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function countUnreadNotifications(userId: string) {
  return prisma.notification.count({ where: { recipientId: userId, channel: "IN_APP", readAt: null } });
}

/** Marks a notification read; scoped to the recipient so ids cannot be guessed across users. */
export async function markNotificationRead(userId: string, notificationId: string) {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, recipientId: userId, readAt: null },
    data: { readAt: new Date(), status: "DELIVERED" },
  });
  return result.count;
}

/** Human-readable text for an outbox event. */
export function describeNotification(event: string, payload: unknown): { title: string; body: string } {
  const p = (payload ?? {}) as Record<string, string | null | undefined>;
  switch (event) {
    case "allocation.confirmed":
      return { title: "Accommodation confirmed", body: `Bed ${p.bed} in ${p.building}, room ${p.room}, from ${p.startDate}${p.endDate ? ` to ${p.endDate}` : ""}.` };
    case "allocation.checked_out":
      return { title: "Checked out", body: `Your stay in bed ${p.bed} ended on ${p.endDate}.` };
    case "booking.confirmed":
      return { title: "Booking confirmed", body: `${p.facility} on ${p.date}, ${p.startTime}–${p.endTime}.` };
    case "booking.pending":
      return { title: "Booking awaiting approval", body: `${p.facility} on ${p.date} at ${p.startTime}.` };
    case "booking.rejected":
      return { title: "Booking declined", body: `${p.facility} on ${p.date} at ${p.startTime}${p.reason ? `: ${p.reason}` : "."}` };
    case "booking.cancelled":
      return { title: "Booking cancelled", body: `${p.facility} on ${p.date} at ${p.startTime}${p.reason ? `: ${p.reason}` : "."}` };
    case "broadcast":
      return { title: p.title ?? "Announcement", body: (p.body ?? "").length > 160 ? `${(p.body ?? "").slice(0, 157)}…` : p.body ?? "" };
    case "lostfound.claim_verified":
      return { title: "Lost and found claim verified", body: `${p.reference}: ${p.description}. Collect it from the accommodation office${p.storageLocation ? ` (${p.storageLocation})` : ""} with your ID.` };
    case "lostfound.claim_rejected":
      return { title: "Lost and found claim not verified", body: `${p.reference}${p.reason ? `: ${p.reason}` : "."}` };
    case "lostfound.returned":
      return { title: "Found item handed over", body: `${p.reference}: ${p.description}.` };
    case "allocation.cancelled":
      return { title: "Allocation cancelled", body: `Bed ${p.bed} is no longer allocated to you${p.reason ? `: ${p.reason}` : "."}` };
    default:
      return { title: event.replace(/[._]/g, " "), body: "" };
  }
}
