// Broadcast messaging (COM-03). An audience is a set of roles (empty = all
// active users) narrowed to sites and/or buildings. Residents belong to the
// place they currently occupy; other roles belong where their role
// assignment is scoped (a global assignment counts for every site). Sending
// writes one in-app notification per recipient through the outbox, so email
// and WhatsApp copies, retries and delivery tracking all work as for any
// other notification (COM-04, COM-06, COM-07).
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { OCCUPYING_STATUSES } from "../accommodation/occupancy";
import { BroadcastError } from "./errors";
import { ALL_ROLES, ROLE_DESCRIPTIONS } from "../admin/access";
import { BODY_MAX, TITLE_MAX, parseAudience, type Audience } from "./rules";

export * from "./rules";

const CHUNK = 200;

export type Recipient = { id: string; name: string; email: string };

/** Everyone the audience resolves to right now. */
export async function resolveAudience(organizationId: string, audience: Audience, today: Date = new Date()): Promise<Recipient[]> {
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const users = await prisma.user.findMany({
    where: { organizationId, status: "ACTIVE", ...(audience.roles.length ? { roleAssignments: { some: { role: { in: audience.roles } } } } : {}) },
    select: {
      id: true, name: true, email: true,
      roleAssignments: { select: { role: true, siteId: true, buildingId: true } },
      staffProfile: { select: { allocations: { where: { status: { in: OCCUPYING_STATUSES }, startDate: { lte: day }, OR: [{ endDate: null }, { endDate: { gte: day } }] }, select: { bed: { select: { room: { select: { buildingId: true, building: { select: { siteId: true } } } } } } } } } },
    },
    orderBy: { name: "asc" },
  });
  const anywhere = audience.siteIds.length === 0 && audience.buildingIds.length === 0;
  const atLocation = (siteId: string | null, buildingId: string | null) => (!!buildingId && audience.buildingIds.includes(buildingId)) || (!!siteId && audience.siteIds.includes(siteId));
  const buildingSite = new Map<string, string>();
  if (!anywhere && audience.buildingIds.length) {
    for (const b of await prisma.building.findMany({ where: { id: { in: audience.buildingIds } }, select: { id: true, siteId: true } })) buildingSite.set(b.id, b.siteId);
  }
  return users
    .filter((u) => {
      if (anywhere) return true;
      const relevantRoles = u.roleAssignments.filter((r) => audience.roles.length === 0 || audience.roles.includes(r.role));
      const lives = (u.staffProfile?.allocations ?? []).some((a) => atLocation(a.bed.room.building.siteId, a.bed.room.buildingId));
      if (lives) return true;
      // Non-resident roles: scoped to the place, or global.
      return relevantRoles.some((r) => r.role !== "STAFF" && (r.siteId === null ? true : atLocation(r.siteId, r.buildingId) || (r.buildingId === null && audience.buildingIds.some((b) => buildingSite.get(b) === r.siteId))));
    })
    .map((u) => ({ id: u.id, name: u.name, email: u.email }));
}

export async function describeAudience(audience: Audience): Promise<string> {
  const [sites, buildings] = await Promise.all([
    audience.siteIds.length ? prisma.site.findMany({ where: { id: { in: audience.siteIds } }, select: { name: true } }) : [],
    audience.buildingIds.length ? prisma.building.findMany({ where: { id: { in: audience.buildingIds } }, select: { name: true } }) : [],
  ]);
  const who = audience.roles.length ? audience.roles.map((r) => (r === "STAFF" ? "residents" : r.toLowerCase().replaceAll("_", " ") + "s")).join(", ") : "everyone";
  const where = [...sites.map((s) => s.name), ...buildings.map((b) => b.name)];
  return `${who}${where.length ? ` at ${where.join(", ")}` : " at all sites"}`;
}

type Input = { title: string; body: string; audience: Audience; emailCopy: boolean; whatsappCopy: boolean };

function validate(input: Input) {
  const errors: Record<string, string> = {};
  if (!input.title.trim()) errors.title = "Enter a title.";
  else if (input.title.trim().length > TITLE_MAX) errors.title = `At most ${TITLE_MAX} characters.`;
  if (!input.body.trim()) errors.body = "Enter the message.";
  else if (input.body.trim().length > BODY_MAX) errors.body = `At most ${BODY_MAX} characters.`;
  if (Object.keys(errors).length) throw new BroadcastError("VALIDATION", "Please correct the highlighted fields.", errors);
}

export async function createBroadcast(input: Input & { organizationId: string; actorId: string }) {
  validate(input);
  const b = await prisma.broadcast.create({ data: { organizationId: input.organizationId, title: input.title.trim(), body: input.body.trim(), audience: input.audience as unknown as Prisma.InputJsonObject, emailCopy: input.emailCopy, whatsappCopy: input.whatsappCopy, createdById: input.actorId } });
  await recordAudit({ actorId: input.actorId, action: "BROADCAST_CREATED", entityType: "Broadcast", entityId: b.id, after: { title: b.title, audience: input.audience as unknown as Prisma.InputJsonObject, emailCopy: b.emailCopy, whatsappCopy: b.whatsappCopy } });
  return b;
}

export async function updateBroadcast(input: Input & { broadcastId: string; actorId: string }) {
  validate(input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.broadcast.findUnique({ where: { id: input.broadcastId } });
    if (!before) throw new BroadcastError("NOT_FOUND", "Broadcast not found.");
    if (before.status !== "DRAFT") throw new BroadcastError("INVALID_STATE", "Only drafts can be edited.");
    const after = await tx.broadcast.update({ where: { id: before.id }, data: { title: input.title.trim(), body: input.body.trim(), audience: input.audience as unknown as Prisma.InputJsonObject, emailCopy: input.emailCopy, whatsappCopy: input.whatsappCopy } });
    await recordAudit({ actorId: input.actorId, action: "BROADCAST_UPDATED", entityType: "Broadcast", entityId: before.id, before: { title: before.title, body: before.body }, after: { title: after.title, body: after.body, audience: input.audience as unknown as Prisma.InputJsonObject } }, tx);
    return after;
  });
}

export async function cancelBroadcast(input: { broadcastId: string; actorId: string }) {
  const r = await prisma.broadcast.updateMany({ where: { id: input.broadcastId, status: "DRAFT" }, data: { status: "CANCELLED" } });
  if (r.count !== 1) throw new BroadcastError("INVALID_STATE", "Only drafts can be cancelled.");
  await recordAudit({ actorId: input.actorId, action: "BROADCAST_CANCELLED", entityType: "Broadcast", entityId: input.broadcastId });
}

/**
 * Queues the message for every recipient. Recipients are written in chunks,
 * each in its own transaction and keyed per person, so an interrupted send
 * can simply be run again without anyone getting the message twice.
 */
export async function sendBroadcast(input: { broadcastId: string; actorId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const b = await prisma.broadcast.findUnique({ where: { id: input.broadcastId } });
  if (!b) throw new BroadcastError("NOT_FOUND", "Broadcast not found.");
  if (b.status !== "DRAFT") throw new BroadcastError("INVALID_STATE", b.status === "SENT" ? "This broadcast has already been sent." : "This broadcast was cancelled.");
  const recipients = await resolveAudience(b.organizationId, parseAudience(b.audience), now);
  if (recipients.length === 0) throw new BroadcastError("VALIDATION", "Nobody matches this audience. Widen it before sending.", { audience: "No recipients." });
  const payload = { broadcastId: b.id, title: b.title, body: b.body };
  for (let i = 0; i < recipients.length; i += CHUNK) {
    const chunk = recipients.slice(i, i + CHUNK);
    await prisma.$transaction(async (tx) => {
      for (const r of chunk) {
        await enqueueNotification(tx, { recipientId: r.id, event: "broadcast", idempotencyKey: `broadcast:${b.id}:${r.id}`, payload, fanout: { email: b.emailCopy, whatsapp: b.whatsappCopy } });
      }
    });
  }
  const sent = await prisma.broadcast.update({ where: { id: b.id }, data: { status: "SENT", sentAt: now, sentById: input.actorId, recipientCount: recipients.length } });
  await recordAudit({ actorId: input.actorId, action: "BROADCAST_SENT", entityType: "Broadcast", entityId: b.id, after: { title: b.title, recipients: recipients.length, emailCopy: b.emailCopy, whatsappCopy: b.whatsappCopy } });
  return { broadcast: sent, recipients: recipients.length };
}

export type Delivery = { inApp: number; read: number; email: Record<string, number>; whatsapp: Record<string, number> };

/** Where the message got to (COM-04): in-app delivered/read, email and WhatsApp by status. */
export async function broadcastDelivery(broadcastId: string): Promise<Delivery> {
  const rows = await prisma.notification.groupBy({ by: ["channel", "status"], where: { event: "broadcast", idempotencyKey: { startsWith: `broadcast:${broadcastId}:` } }, _count: { _all: true } });
  const read = await prisma.notification.count({ where: { event: "broadcast", channel: "IN_APP", readAt: { not: null }, idempotencyKey: { startsWith: `broadcast:${broadcastId}:` } } });
  const d: Delivery = { inApp: 0, read, email: {}, whatsapp: {} };
  for (const r of rows) {
    if (r.channel === "IN_APP") d.inApp += r._count._all;
    else if (r.channel === "EMAIL") d.email[r.status] = r._count._all;
    else d.whatsapp[r.status] = r._count._all;
  }
  return d;
}

export async function listBroadcasts(organizationId: string) {
  return prisma.broadcast.findMany({ where: { organizationId }, include: { createdBy: { select: { name: true } }, sentBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
}

export async function getBroadcast(id: string) {
  return prisma.broadcast.findUnique({ where: { id }, include: { createdBy: { select: { name: true } }, sentBy: { select: { name: true } } } });
}

/** Announcements delivered to a person, newest first. */
export async function myAnnouncements(userId: string, limit = 50) {
  return prisma.notification.findMany({ where: { recipientId: userId, channel: "IN_APP", event: "broadcast" }, orderBy: { createdAt: "desc" }, take: limit });
}

/** One announcement, only for its recipient; opening it marks it read. */
export async function openAnnouncement(userId: string, broadcastId: string) {
  const n = await prisma.notification.findUnique({ where: { idempotencyKey: `broadcast:${broadcastId}:${userId}` } });
  if (!n || n.recipientId !== userId) return null;
  if (!n.readAt) await prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
  const b = await prisma.broadcast.findUnique({ where: { id: broadcastId }, select: { title: true, body: true, sentAt: true, sentBy: { select: { name: true } } } });
  return b ? { ...b, readAt: n.readAt ?? new Date() } : null;
}


// ---------------------------------------------------------------------------
// Views and actions for the API
// ---------------------------------------------------------------------------

/** Sites, buildings and roles the compose form offers as audience choices. */
export async function audienceOptions(organizationId: string) {
  const sites = await prisma.site.findMany({ where: { organizationId, status: "ACTIVE" }, include: { buildings: { where: { status: "ACTIVE" }, orderBy: { code: "asc" } } }, orderBy: { name: "asc" } });
  return {
    sites: sites.map((s) => ({ id: s.id, label: s.name })),
    buildings: sites.flatMap((s) => s.buildings.map((b) => ({ id: b.id, label: `${s.name} · ${b.name}`, siteId: s.id }))),
    roles: ALL_ROLES.map((r) => ({ id: r, label: r === "STAFF" ? "Residents (staff)" : r.toLowerCase().replaceAll("_", " "), hint: ROLE_DESCRIPTIONS[r] })),
  };
}

/** Every broadcast with a plain-language audience, plus the compose form's choices. */
export async function broadcastsView(organizationId: string) {
  const [rows, options] = await Promise.all([listBroadcasts(organizationId), audienceOptions(organizationId)]);
  const described = await Promise.all(rows.map((b) => describeAudience(parseAudience(b.audience))));
  return { rows, described, options };
}

/** One broadcast: audience, delivery progress and (for a draft) who it would reach now. */
export async function broadcastView(organizationId: string, id: string) {
  const b = await getBroadcast(id);
  if (!b || b.organizationId !== organizationId) throw new BroadcastError("NOT_FOUND", "Broadcast not found.");
  const audience = parseAudience(b.audience);
  const draft = b.status === "DRAFT";
  const [who, delivery, recipients, options] = await Promise.all([describeAudience(audience), broadcastDelivery(b.id), draft ? resolveAudience(organizationId, audience) : Promise.resolve([]), draft ? audienceOptions(organizationId) : Promise.resolve(null)]);
  return { broadcast: b, audience, who, delivery, recipients, options };
}

/** How many people an audience reaches right now, with a few names. */
export async function previewAudience(organizationId: string, audience: Audience) {
  const recipients = await resolveAudience(organizationId, audience);
  return { count: recipients.length, sample: recipients.slice(0, 8).map((r) => r.name) };
}

/** Saves a new or existing draft, and optionally sends it. */
export async function saveBroadcast(input: Input & { organizationId: string; actorId: string; broadcastId?: string | null; send: boolean }) {
  let id = input.broadcastId ?? "";
  const { title, body, audience, emailCopy, whatsappCopy } = input;
  try {
    if (id) await updateBroadcast({ broadcastId: id, actorId: input.actorId, title, body, audience, emailCopy, whatsappCopy });
    else id = (await createBroadcast({ organizationId: input.organizationId, actorId: input.actorId, title, body, audience, emailCopy, whatsappCopy })).id;
    if (input.send) await sendBroadcast({ broadcastId: id, actorId: input.actorId });
  } catch (error) {
    // Hand the draft's id back so a retry updates it rather than creating a second one.
    if (error instanceof BroadcastError) error.details = { ...(error.details ?? {}), broadcastId: id };
    throw error;
  }
  return { id };
}
