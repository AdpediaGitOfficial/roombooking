// User and role administration (SRS 3, ADM-01, ADM-02, ADM-04, ADM-05).
import { createHash, randomBytes } from "node:crypto";
import type { Prisma, Role, UserStatus } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { hashPassword, validatePasswordStrength } from "../../lib/auth/password";
import { revokeUserSessions } from "../../lib/auth/session-store";
import { AdminError } from "./errors";
import { ALL_ROLES } from "./access";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_TTL_HOURS = Number(process.env.INVITE_TTL_HOURS ?? 7 * 24);
const RESET_TTL_HOURS = Number(process.env.RESET_TTL_HOURS ?? 24);

export const userInclude = {
  roleAssignments: { include: { site: { select: { id: true, name: true } }, building: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
  staffProfile: { select: { id: true, employeeId: true, firstName: true, lastName: true, department: true } },
  vendor: { select: { id: true, name: true } },
  _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } } },
} satisfies Prisma.UserInclude;

export type UserRecord = Prisma.UserGetPayload<{ include: typeof userInclude }>;
export type RoleGrant = { role: Role; siteId?: string | null; buildingId?: string | null };

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function scopeLabel(a: { site?: { name: string } | null; building?: { name: string } | null }): string {
  if (a.building) return a.building.name;
  if (a.site) return a.site.name;
  return "All sites";
}

// ---------------------------------------------------------------------------
// Guards (3.1: deny by default; keep the organisation administrable)
// ---------------------------------------------------------------------------

async function assertNotLastAdmin(tx: Prisma.TransactionClient, userId: string, context: string) {
  const isAdmin = await tx.roleAssignment.findFirst({ where: { userId, role: "SYSTEM_ADMIN" } });
  if (!isAdmin) return;
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { organizationId: true } });
  const others = await tx.user.count({ where: { organizationId: user.organizationId, id: { not: userId }, status: "ACTIVE", roleAssignments: { some: { role: "SYSTEM_ADMIN" } } } });
  if (others === 0) throw new AdminError("GUARD", `Cannot ${context}: this is the last active system administrator.`);
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export type CreateUserInput = {
  actorId: string;
  organizationId: string;
  name: string;
  /** Sign-in name: employee ID, phone number or email. Defaults to the linked employee ID, else the email. */
  username?: string | null;
  /** Optional: no email address is required (document section 9). */
  email?: string | null;
  roles: RoleGrant[];
  staffProfileId?: string | null;
  vendorId?: string | null;
  accessExpiresAt?: string | null;
  /** "temp_password" activates the account with a temporary password that must be changed at first login; "invite" sends a one-time link. */
  mode?: "invite" | "temp_password";
};

const USERNAME = /^\+?[a-z0-9][a-z0-9._@+-]{2,63}$/;

export function normaliseUsername(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function generateTemporaryPassword(): string {
  // 12 characters from an unambiguous alphabet, always containing upper, lower and a digit.
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const pick = (set: string) => set[randomBytes(1)[0] % set.length];
  const chars = [pick(upper), pick(lower), pick(digits)];
  while (chars.length < 12) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return `${chars.join("")}9`;
}

async function validateGrants(tx: Prisma.TransactionClient, grants: RoleGrant[]) {
  for (const g of grants) {
    if (!ALL_ROLES.includes(g.role)) throw new AdminError("VALIDATION", `Unknown role ${g.role}.`, { roles: "Unknown role." });
    if (g.buildingId) {
      const building = await tx.building.findUnique({ where: { id: g.buildingId } });
      if (!building) throw new AdminError("VALIDATION", "Unknown building scope.", { roles: "Unknown building." });
      g.siteId = building.siteId;
    } else if (g.siteId) {
      const site = await tx.site.findUnique({ where: { id: g.siteId } });
      if (!site) throw new AdminError("VALIDATION", "Unknown site scope.", { roles: "Unknown site." });
    }
  }
}

function parseExpiry(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (Number.isNaN(Date.parse(value))) throw new AdminError("VALIDATION", "Enter a valid access expiry date.", { accessExpiresAt: "Invalid date." });
  return new Date(`${value}T23:59:59.000Z`);
}

export async function createUser(input: CreateUserInput) {
  const name = input.name.trim();
  const email = input.email?.trim().toLowerCase() || null;
  const errors: Record<string, string> = {};
  if (!name) errors.name = "Enter the person's name.";
  if (email && !EMAIL.test(email)) errors.email = "Enter a valid email address.";
  if (input.roles.length === 0) errors.roles = "Choose at least one role.";
  if (input.roles.some((r) => r.role === "VENDOR") && !input.vendorId) errors.vendorId = "Vendor users must be linked to a vendor.";
  if (Object.keys(errors).length) throw new AdminError("VALIDATION", "Please correct the highlighted fields.", errors);

  return prisma.$transaction(async (tx) => {
    await validateGrants(tx, input.roles);
    let staff: { id: string; employeeId: string; phone: string | null; organizationId: string; userId: string | null } | null = null;
    if (input.staffProfileId) {
      staff = await tx.staffProfile.findUnique({ where: { id: input.staffProfileId }, select: { id: true, employeeId: true, phone: true, organizationId: true, userId: true } });
      if (!staff || staff.organizationId !== input.organizationId) throw new AdminError("VALIDATION", "Unknown staff record.", { staffProfileId: "Unknown." });
      if (staff.userId) throw new AdminError("VALIDATION", "That staff record is already linked to another user.", { staffProfileId: "Already linked." });
    }
    const username = normaliseUsername(input.username || staff?.employeeId || email || "");
    if (!USERNAME.test(username)) throw new AdminError("VALIDATION", "Enter a username of 3 to 64 letters, numbers or . _ @ + - (an employee ID, phone number or email).", { username: "Invalid username." });
    if (await tx.user.findUnique({ where: { username } })) throw new AdminError("VALIDATION", "That username is already in use.", { username: "Already in use." });
    if (email && (await tx.user.findUnique({ where: { email } }))) throw new AdminError("VALIDATION", "A user with that email already exists.", { email: "Already in use." });

    const mode = input.mode ?? "invite";
    const token = mode === "invite" ? randomBytes(32).toString("base64url") : null;
    const temporaryPassword = mode === "temp_password" ? generateTemporaryPassword() : null;
    const user = await tx.user.create({
      data: {
        organizationId: input.organizationId,
        name,
        username,
        email,
        status: mode === "invite" ? "INVITED" : "ACTIVE",
        passwordHash: temporaryPassword ? await hashPassword(temporaryPassword) : null,
        passwordChangedAt: null,
        mustChangePassword: mode === "temp_password",
        vendorId: input.vendorId || null,
        accessExpiresAt: parseExpiry(input.accessExpiresAt),
        ...(token ? { tokenHash: hashToken(token), tokenPurpose: "INVITE", tokenExpiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3600000) } : {}),
        roleAssignments: { create: input.roles.map((r) => ({ role: r.role, siteId: r.siteId || null, buildingId: r.buildingId || null })) },
      },
    });
    if (input.staffProfileId) await tx.staffProfile.update({ where: { id: input.staffProfileId }, data: { userId: user.id } });
    await recordAudit({ actorId: input.actorId, action: "USER_CREATED", entityType: "User", entityId: user.id, after: { name, username, email, mode, roles: input.roles as unknown as Prisma.InputJsonValue, staffProfileId: input.staffProfileId ?? null, vendorId: input.vendorId ?? null } }, tx);
    if (token) {
      await enqueueNotification(tx, { recipientId: user.id, channel: "EMAIL", event: "user.invited", idempotencyKey: `user.invited:${user.id}:${user.tokenExpiresAt?.getTime()}`, payload: { invitePath: `/invite/${token}`, expiresAt: user.tokenExpiresAt?.toISOString() ?? null } });
    } else if (temporaryPassword) {
      await queueTemporaryPassword(tx, user.id, username, temporaryPassword);
    }
    return { user, invitePath: token ? `/invite/${token}` : null, temporaryPassword };
  });
}

/**
 * Temporary passwords are sent by WhatsApp, SMS or email (document section 9). The copy is queued on
 * every channel the person has set up; the delivery worker removes the password from the stored payload once sent.
 */
async function queueTemporaryPassword(tx: Prisma.TransactionClient, userId: string, username: string, temporaryPassword: string) {
  const person = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, whatsappNumber: true, staffProfile: { select: { phone: true } } } });
  const payload = { username, temporaryPassword };
  const stamp = Date.now();
  if (person.email) await enqueueNotification(tx, { recipientId: userId, channel: "EMAIL", event: "user.temp_password", idempotencyKey: `temp-password:${userId}:${stamp}:email`, payload });
  if (person.whatsappNumber || person.staffProfile?.phone) await enqueueNotification(tx, { recipientId: userId, channel: "WHATSAPP", event: "user.temp_password", idempotencyKey: `temp-password:${userId}:${stamp}:whatsapp`, payload });
}

/** Super Admin resets a password: a new temporary password, all sessions ended, change forced at next sign-in. */
export async function resetPasswordTemporary(input: { actorId: string; userId: string }) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new AdminError("NOT_FOUND", "User not found.");
    if (user.status === "DEACTIVATED") throw new AdminError("INVALID_STATE", "Reactivate the account before resetting its password.");
    const temporaryPassword = generateTemporaryPassword();
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(temporaryPassword), passwordChangedAt: null, mustChangePassword: true, status: user.status === "INVITED" ? "ACTIVE" : user.status, failedLoginAttempts: 0, lockedUntil: null, tokenHash: null, tokenPurpose: null, tokenExpiresAt: null } });
    await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordAudit({ actorId: input.actorId, action: "PASSWORD_RESET_BY_ADMIN", entityType: "User", entityId: user.id }, tx);
    await queueTemporaryPassword(tx, user.id, user.username, temporaryPassword);
    return { temporaryPassword };
  });
}

/** Unlocks an account locked after repeated failed sign-ins (Super Admin, document 5.1). */
export async function unlockUser(input: { actorId: string; userId: string }) {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new AdminError("NOT_FOUND", "User not found.");
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
  await recordAudit({ actorId: input.actorId, action: "USER_UNLOCKED", entityType: "User", entityId: user.id });
}

/**
 * Self-service reset (document section 12): the link goes to the registered email and WhatsApp number.
 * Always succeeds from the caller's point of view so the form cannot be used to discover accounts.
 */
export async function requestSelfServiceReset(usernameOrEmail: string): Promise<void> {
  const key = normaliseUsername(usernameOrEmail);
  if (!key) return;
  const user = await prisma.user.findFirst({ where: { OR: [{ username: key }, { email: key }] } });
  if (!user || (user.status !== "ACTIVE" && user.status !== "INVITED")) return;
  const hasChannel = !!user.email || (!!user.whatsappNumber && user.whatsappNotifications);
  if (!hasChannel) return;
  // Throttle: one outstanding link at a time per account.
  if (user.tokenExpiresAt && user.tokenExpiresAt > new Date() && user.tokenPurpose === "RESET" && user.tokenExpiresAt.getTime() - Date.now() > (RESET_TTL_HOURS - 0.25) * 3600000) return;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TTL_HOURS * 3600000);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { tokenHash: hashToken(token), tokenPurpose: "RESET", tokenExpiresAt: expiresAt } });
    await recordAudit({ actorId: user.id, action: "PASSWORD_RESET_REQUESTED", entityType: "User", entityId: user.id, after: { expiresAt: expiresAt.toISOString() } }, tx);
    const payload = { path: `/invite/${token}`, expiresAt: expiresAt.toISOString() };
    if (user.email) await enqueueNotification(tx, { recipientId: user.id, channel: "EMAIL", event: "user.password_reset", idempotencyKey: `reset:${user.id}:${expiresAt.getTime()}:email`, payload });
    if (user.whatsappNumber && user.whatsappNotifications && user.whatsappConsentAt) await enqueueNotification(tx, { recipientId: user.id, channel: "WHATSAPP", event: "user.password_reset", idempotencyKey: `reset:${user.id}:${expiresAt.getTime()}:whatsapp`, payload });
  });
}

export type UpdateUserInput = { actorId: string; userId: string; name: string; email?: string | null; username?: string | null; staffProfileId?: string | null; vendorId?: string | null; accessExpiresAt?: string | null };

export async function updateUser(input: UpdateUserInput) {
  const name = input.name.trim();
  const email = input.email?.trim().toLowerCase() || null;
  const errors: Record<string, string> = {};
  if (!name) errors.name = "Enter the person's name.";
  if (email && !EMAIL.test(email)) errors.email = "Enter a valid email address.";
  if (Object.keys(errors).length) throw new AdminError("VALIDATION", "Please correct the highlighted fields.", errors);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId }, include: { staffProfile: true, roleAssignments: true } });
    if (!user) throw new AdminError("NOT_FOUND", "User not found.");
    if (email) {
      const clash = await tx.user.findUnique({ where: { email } });
      if (clash && clash.id !== user.id) throw new AdminError("VALIDATION", "That email is used by another account.", { email: "Already in use." });
    }
    const username = input.username ? normaliseUsername(input.username) : user.username;
    if (username !== user.username) {
      if (!USERNAME.test(username)) throw new AdminError("VALIDATION", "Enter a valid username.", { username: "Invalid username." });
      if (await tx.user.findUnique({ where: { username } })) throw new AdminError("VALIDATION", "That username is already in use.", { username: "Already in use." });
    }
    if (user.roleAssignments.some((r) => r.role === "VENDOR") && !input.vendorId) throw new AdminError("VALIDATION", "Vendor users must stay linked to a vendor.", { vendorId: "Required." });
    const nextStaffId = input.staffProfileId || null;
    if (nextStaffId !== (user.staffProfile?.id ?? null)) {
      if (nextStaffId) {
        const staff = await tx.staffProfile.findUnique({ where: { id: nextStaffId } });
        if (!staff) throw new AdminError("VALIDATION", "Unknown staff record.", { staffProfileId: "Unknown." });
        if (staff.userId && staff.userId !== user.id) throw new AdminError("VALIDATION", "That staff record is linked to another user.", { staffProfileId: "Already linked." });
      }
      if (user.staffProfile) await tx.staffProfile.update({ where: { id: user.staffProfile.id }, data: { userId: null } });
      if (nextStaffId) await tx.staffProfile.update({ where: { id: nextStaffId }, data: { userId: user.id } });
    }
    const updated = await tx.user.update({ where: { id: user.id }, data: { name, email, username, vendorId: input.vendorId || null, accessExpiresAt: parseExpiry(input.accessExpiresAt) } });
    await recordAudit({ actorId: input.actorId, action: "USER_UPDATED", entityType: "User", entityId: user.id, before: { name: user.name, username: user.username, email: user.email, staffProfileId: user.staffProfile?.id ?? null, vendorId: user.vendorId, accessExpiresAt: user.accessExpiresAt?.toISOString() ?? null }, after: { name, username, email, staffProfileId: nextStaffId, vendorId: updated.vendorId, accessExpiresAt: updated.accessExpiresAt?.toISOString() ?? null } }, tx);
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Roles (ADM-02)
// ---------------------------------------------------------------------------

export async function addRole(input: { actorId: string; userId: string; grant: RoleGrant }) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId }, include: { roleAssignments: true } });
    if (!user) throw new AdminError("NOT_FOUND", "User not found.");
    await validateGrants(tx, [input.grant]);
    if (input.grant.role === "VENDOR" && !user.vendorId) throw new AdminError("VALIDATION", "Link the user to a vendor before granting the vendor role.");
    const siteId = input.grant.siteId || null;
    const buildingId = input.grant.buildingId || null;
    if (user.roleAssignments.some((r) => r.role === input.grant.role && r.siteId === siteId && r.buildingId === buildingId)) {
      throw new AdminError("INVALID_STATE", "That role with that scope is already assigned.");
    }
    const created = await tx.roleAssignment.create({ data: { userId: user.id, role: input.grant.role, siteId, buildingId } });
    await recordAudit({ actorId: input.actorId, action: "ROLE_GRANTED", entityType: "User", entityId: user.id, after: { role: created.role, siteId, buildingId } }, tx);
    return created;
  });
}

export async function removeRole(input: { actorId: string; userId: string; assignmentId: string }) {
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.roleAssignment.findUnique({ where: { id: input.assignmentId } });
    if (!assignment || assignment.userId !== input.userId) throw new AdminError("NOT_FOUND", "Role assignment not found.");
    if (assignment.role === "SYSTEM_ADMIN") {
      if (input.userId === input.actorId) throw new AdminError("GUARD", "You cannot remove your own system administrator role.");
      const remaining = await tx.roleAssignment.count({ where: { userId: input.userId, role: "SYSTEM_ADMIN", id: { not: assignment.id } } });
      if (remaining === 0) await assertNotLastAdmin(tx, input.userId, "remove this role");
    }
    await tx.roleAssignment.delete({ where: { id: assignment.id } });
    await recordAudit({ actorId: input.actorId, action: "ROLE_REVOKED", entityType: "User", entityId: input.userId, before: { role: assignment.role, siteId: assignment.siteId, buildingId: assignment.buildingId } }, tx);
  });
}

// ---------------------------------------------------------------------------
// Status (ADM-01): suspend / deactivate revoke sessions; history is kept
// ---------------------------------------------------------------------------

export async function setUserStatus(input: { actorId: string; userId: string; status: Extract<UserStatus, "ACTIVE" | "SUSPENDED" | "DEACTIVATED">; reason?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new AdminError("NOT_FOUND", "User not found.");
    if (user.status === input.status) throw new AdminError("INVALID_STATE", `The account is already ${input.status.toLowerCase()}.`);
    if (input.status !== "ACTIVE") {
      if (input.userId === input.actorId) throw new AdminError("GUARD", "You cannot suspend or deactivate your own account.");
      await assertNotLastAdmin(tx, input.userId, input.status === "SUSPENDED" ? "suspend this account" : "deactivate this account");
      if (!input.reason?.trim()) throw new AdminError("VALIDATION", "Give a reason.", { reason: "Required." });
    }
    if (input.status === "ACTIVE" && !user.passwordHash) throw new AdminError("INVALID_STATE", "This account has no password yet. Send an invite instead.");
    const updated = await tx.user.update({ where: { id: user.id }, data: { status: input.status, ...(input.status !== "ACTIVE" ? { tokenHash: null, tokenPurpose: null, tokenExpiresAt: null } : {}) } });
    let revoked = 0;
    if (input.status !== "ACTIVE") {
      const result = await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      revoked = result.count;
    }
    await recordAudit({ actorId: input.actorId, action: "USER_STATUS_CHANGED", entityType: "User", entityId: user.id, before: { status: user.status }, after: { status: input.status, reason: input.reason ?? null, sessionsRevoked: revoked } }, tx);
    return updated;
  });
}

export async function signOutEverywhere(input: { actorId: string; userId: string }) {
  const count = await revokeUserSessions(input.userId);
  await recordAudit({ actorId: input.actorId, action: "USER_SESSIONS_REVOKED", entityType: "User", entityId: input.userId, after: { sessionsRevoked: count } });
  return count;
}

// ---------------------------------------------------------------------------
// Invite / reset tokens (ADM-01, ADM-05, SS-08)
// ---------------------------------------------------------------------------

export async function issueToken(input: { actorId: string; userId: string; purpose: "INVITE" | "RESET" }) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new AdminError("NOT_FOUND", "User not found.");
    if (user.status === "DEACTIVATED") throw new AdminError("INVALID_STATE", "Reactivate the account before sending a link.");
    if (input.purpose === "INVITE" && user.status !== "INVITED") throw new AdminError("INVALID_STATE", "This account already has a password; send a password reset instead.");
    if (input.purpose === "RESET" && user.status === "INVITED") throw new AdminError("INVALID_STATE", "This account has not been activated yet; resend the invite instead.");
    const token = randomBytes(32).toString("base64url");
    const ttl = input.purpose === "INVITE" ? INVITE_TTL_HOURS : RESET_TTL_HOURS;
    const expiresAt = new Date(Date.now() + ttl * 3600000);
    await tx.user.update({ where: { id: user.id }, data: { tokenHash: hashToken(token), tokenPurpose: input.purpose, tokenExpiresAt: expiresAt } });
    await recordAudit({ actorId: input.actorId, action: input.purpose === "INVITE" ? "USER_INVITE_SENT" : "USER_RESET_SENT", entityType: "User", entityId: user.id, after: { expiresAt: expiresAt.toISOString() } }, tx);
    await enqueueNotification(tx, { recipientId: user.id, channel: "EMAIL", event: input.purpose === "INVITE" ? "user.invited" : "user.password_reset", idempotencyKey: `${input.purpose.toLowerCase()}:${user.id}:${expiresAt.getTime()}`, payload: { path: `/invite/${token}`, expiresAt: expiresAt.toISOString() } });
    return { path: `/invite/${token}`, expiresAt };
  });
}

export async function lookupToken(token: string) {
  if (!token) return null;
  const user = await prisma.user.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true, name: true, username: true, email: true, status: true, tokenPurpose: true, tokenExpiresAt: true } });
  if (!user || !user.tokenExpiresAt || user.tokenExpiresAt < new Date() || user.status === "DEACTIVATED" || user.status === "SUSPENDED") return null;
  return user;
}

/** Sets the password from an invite or reset link; activates the account and ends other sessions. */
export async function acceptToken(input: { token: string; password: string }) {
  const user = await lookupToken(input.token);
  if (!user) throw new AdminError("INVALID_STATE", "This link is invalid or has expired. Ask an administrator for a new one.");
  const weak = validatePasswordStrength(input.password);
  if (weak) throw new AdminError("VALIDATION", weak, { password: weak });
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    // Clear the token atomically so a link works exactly once.
    const consumed = await tx.user.updateMany({ where: { id: user.id, tokenHash: hashToken(input.token) }, data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false, status: "ACTIVE", tokenHash: null, tokenPurpose: null, tokenExpiresAt: null, failedLoginAttempts: 0, lockedUntil: null } });
    if (consumed.count !== 1) throw new AdminError("INVALID_STATE", "This link has already been used.");
    await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordAudit({ actorId: user.id, action: user.tokenPurpose === "INVITE" ? "USER_ACTIVATED" : "PASSWORD_RESET_COMPLETED", entityType: "User", entityId: user.id, after: { status: "ACTIVE" } }, tx);
    return tx.user.findUniqueOrThrow({ where: { id: user.id } });
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export type UserFilter = { q?: string | null; status?: UserStatus | null; role?: Role | null };

export async function listUsers(organizationId: string, filter: UserFilter) {
  const q = filter.q?.trim();
  return prisma.user.findMany({
    where: {
      organizationId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.role ? { roleAssignments: { some: { role: filter.role } } } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { username: { contains: q, mode: "insensitive" } }, { staffProfile: { employeeId: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    include: userInclude,
    orderBy: [{ status: "asc" }, { name: "asc" }],
    take: 300,
  });
}

export async function getUser(id: string) {
  return prisma.user.findUnique({ where: { id }, include: userInclude });
}

export async function unlinkedStaff(organizationId: string, includeUserId?: string | null) {
  return prisma.staffProfile.findMany({ where: { organizationId, OR: [{ userId: null }, ...(includeUserId ? [{ userId: includeUserId }] : [])] }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, employeeId: true, firstName: true, lastName: true } });
}

export async function scopeOptions() {
  const [sites, buildings, vendors] = await Promise.all([
    prisma.site.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.building.findMany({ where: { status: "ACTIVE" }, include: { site: { select: { name: true } } }, orderBy: [{ site: { name: "asc" } }, { code: "asc" }] }),
    prisma.vendor.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { sites, buildings: buildings.map((b) => ({ id: b.id, name: `${b.site.name} · ${b.name}` })), vendors };
}

export type AuditFilter = { entityType?: string | null; action?: string | null; actorId?: string | null; entityId?: string | null };

export async function listAudit(filter: AuditFilter, take = 200) {
  return prisma.auditEvent.findMany({
    where: {
      ...(filter.entityType ? { entityType: filter.entityType } : {}),
      ...(filter.action ? { action: { contains: filter.action.toUpperCase() } } : {}),
      ...(filter.actorId ? { actorId: filter.actorId } : {}),
      ...(filter.entityId ? { entityId: filter.entityId } : {}),
    },
    include: { actor: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function auditEntityTypes() {
  const rows = await prisma.auditEvent.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } });
  return rows.map((r) => r.entityType);
}
