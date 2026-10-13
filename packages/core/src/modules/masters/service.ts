// Organisation masters (document section 4), house rules (versioned, acknowledged by residents) and notification templates.
import type { MasterKind, NotificationChannel, Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { actorCan, type ActorLike } from "../../lib/permissions/actor";
import { archiveRecord, restoreArchived } from "../archive/service";
import { KNOWN_EVENTS } from "../notifications/templates";

export class MasterError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "CONFLICT", message: string, public readonly fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "MasterError";
  }
}

export const MASTER_KINDS: Array<{ kind: MasterKind; label: string; hint: string; hrmsOwned?: boolean; siteScoped?: boolean; cap: string }> = [
  { kind: "PROPERTY_TYPE", label: "Property types", hint: "Villa, block, compound, tower…", cap: "setup.property_types" },
  { kind: "ROOM_TYPE", label: "Room types", hint: "Single, double, dormitory…", cap: "setup.org_masters" },
  { kind: "BED_TYPE", label: "Bed types", hint: "Single bed, bunk…", cap: "setup.org_masters" },
  { kind: "AMENITY", label: "Amenities", hint: "AC, attached bath, balcony…", cap: "setup.org_masters" },
  { kind: "ELIGIBILITY_CATEGORY", label: "Eligibility categories", hint: "Used by room eligibility and staff entitlement", cap: "setup.org_masters" },
  { kind: "DEPARTMENT", label: "Departments", hint: "Read-only when the HRMS syncs them", hrmsOwned: true, cap: "setup.org_masters" },
  { kind: "GRADE", label: "Grades", hint: "Read-only when the HRMS syncs them", hrmsOwned: true, cap: "setup.org_masters" },
  { kind: "REQUEST_CATEGORY", label: "Request categories", hint: "Room change, extension, family…", cap: "setup.org_masters" },
  { kind: "MAINTENANCE_CATEGORY", label: "Maintenance categories", hint: "Electrical, plumbing…", cap: "setup.org_masters" },
  { kind: "INCIDENT_CATEGORY", label: "Incident categories", hint: "Per site policy", siteScoped: true, cap: "setup.policies" },
  { kind: "STORE", label: "Stores / warehouses", hint: "Where stock is kept", siteScoped: true, cap: "setup.stores" },
  { kind: "GATE", label: "Gates", hint: "Entry points", siteScoped: true, cap: "setup.stores" },
  { kind: "KEY_CABINET", label: "Key cabinets & locations", hint: "Use the word EMERGENCY for emergency-key cabinets", siteScoped: true, cap: "setup.stores" },
  { kind: "PATROL_CHECKPOINT", label: "Patrol checkpoints", hint: "Codes Security scans on rounds", siteScoped: true, cap: "setup.policies" },
  { kind: "HOLIDAY", label: "Calendar & holidays", hint: "Date in the value field (YYYY-MM-DD)", cap: "setup.org_masters" },
  { kind: "CHARGE_CATEGORY", label: "Charge categories", hint: "Damage, fee…", cap: "setup.org_masters" },
];

const kindDef = (k: MasterKind) => MASTER_KINDS.find((x) => x.kind === k);

export async function listMasters(organizationId: string, kind: MasterKind, opts: { archived?: boolean } = {}) {
  return prisma.masterItem.findMany({ where: { organizationId, kind, archivedAt: opts.archived ? { not: null } : null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function masterCounts(organizationId: string) {
  const g = await prisma.masterItem.groupBy({ by: ["kind"], where: { organizationId, archivedAt: null }, _count: true });
  return new Map(g.map((x) => [x.kind, x._count]));
}

async function hrmsOwns(organizationId: string) {
  return !!(await prisma.integrationConfig.findFirst({ where: { organizationId, kind: "HRMS", enabled: true } }));
}

export async function saveMaster(actor: ActorLike, organizationId: string, input: { id?: string | null; kind: MasterKind; code: string; name: string; value?: string | null; siteId?: string | null; sortOrder?: number }) {
  const def = kindDef(input.kind);
  if (!def) throw new MasterError("VALIDATION", "Unknown master.");
  if (!actorCan(actor, def.cap, { siteId: input.siteId })) throw new MasterError("FORBIDDEN", "Your role cannot change this master.");
  if (def.hrmsOwned && (await hrmsOwns(organizationId))) throw new MasterError("FORBIDDEN", `${def.label} are maintained by the HRMS sync and are read-only here.`);
  const errors: Record<string, string> = {};
  const code = input.code?.trim().toUpperCase().replace(/\s+/g, "_");
  if (!code) errors.code = "Enter a code.";
  if (!input.name?.trim()) errors.name = "Enter a name.";
  if (Object.keys(errors).length) throw new MasterError("VALIDATION", "Please correct the highlighted fields.", errors);
  const data = input.value?.trim() ? ({ value: input.value.trim() } as Prisma.InputJsonValue) : undefined;
  const siteId = def.siteScoped ? input.siteId || null : null;
  const dupe = await prisma.masterItem.findFirst({ where: { organizationId, kind: input.kind, code, siteId, archivedAt: null, ...(input.id ? { id: { not: input.id } } : {}) } });
  if (dupe) throw new MasterError("CONFLICT", "That code already exists.", { code: "Already used." });
  const row = input.id
    ? await prisma.masterItem.update({ where: { id: input.id }, data: { code, name: input.name.trim(), data, sortOrder: input.sortOrder ?? 0, siteId } })
    : await prisma.masterItem.create({ data: { organizationId, kind: input.kind, code, name: input.name.trim(), data, sortOrder: input.sortOrder ?? 0, siteId } });
  await recordAudit({ actorId: actor.id, action: input.id ? "MASTER_UPDATED" : "MASTER_CREATED", entityType: "MasterItem", entityId: row.id, after: { kind: input.kind, code, name: row.name }, siteId });
  return row;
}

export const archiveMaster = (actor: ActorLike, id: string, reason: string) => archiveRecord(actor, "MASTER_ITEM", id, reason);
export const restoreMaster = (actor: ActorLike, id: string) => restoreArchived(actor, "MASTER_ITEM", id);

// ---------------------------------------------------------------------------
// House rules (versioned)
// ---------------------------------------------------------------------------

export async function publishHouseRule(actor: ActorLike, organizationId: string, input: { code: string; title: string; body: string; siteId?: string | null }) {
  if (!actorCan(actor, "setup.house_rules", { siteId: input.siteId })) throw new MasterError("FORBIDDEN", "Only an Admin can publish house rules.");
  const code = input.code?.trim().toUpperCase().replace(/\s+/g, "_");
  const errors: Record<string, string> = {};
  if (!code) errors.code = "Enter a code.";
  if (!input.title?.trim()) errors.title = "Enter a title.";
  if ((input.body?.trim().length ?? 0) < 20) errors.body = "Write the rule text (at least 20 characters).";
  if (Object.keys(errors).length) throw new MasterError("VALIDATION", "Please correct the highlighted fields.", errors);
  return prisma.$transaction(async (tx) => {
    const last = await tx.houseRule.findFirst({ where: { organizationId, code }, orderBy: { version: "desc" } });
    await tx.houseRule.updateMany({ where: { organizationId, code, isCurrent: true }, data: { isCurrent: false } });
    const rule = await tx.houseRule.create({ data: { organizationId, siteId: input.siteId || null, code, title: input.title.trim(), body: input.body.trim(), version: (last?.version ?? 0) + 1, publishedById: actor.id } });
    await recordAudit({ actorId: actor.id, action: "HOUSE_RULE_PUBLISHED", entityType: "HouseRule", entityId: rule.id, after: { code, version: rule.version } }, tx);
    return rule;
  });
}

export const listHouseRules = (organizationId: string) => prisma.houseRule.findMany({ where: { organizationId }, orderBy: [{ code: "asc" }, { version: "desc" }], include: { _count: { select: { acknowledgements: true } } } });

/** Current rules that apply to the user's site(s) and that they have not acknowledged at their current version. */
export async function pendingHouseRules(userId: string, organizationId: string) {
  const staff = await prisma.staffProfile.findUnique({ where: { userId }, select: { id: true } });
  const sites = staff ? (await prisma.allocation.findMany({ where: { staffId: staff.id, status: { in: ["CONFIRMED", "CHECKED_IN"] } }, select: { bed: { select: { room: { select: { building: { select: { siteId: true } } } } } } } })).map((a) => a.bed.room.building.siteId) : [];
  const rules = await prisma.houseRule.findMany({ where: { organizationId, isCurrent: true, OR: [{ siteId: null }, ...(sites.length ? [{ siteId: { in: sites } }] : [])] }, orderBy: { code: "asc" } });
  const acked = new Set((await prisma.houseRuleAcknowledgement.findMany({ where: { userId, houseRuleId: { in: rules.map((r) => r.id) } }, select: { houseRuleId: true } })).map((a) => a.houseRuleId));
  return rules.filter((r) => !acked.has(r.id));
}

export async function acknowledgeHouseRule(userId: string, ruleId: string) {
  const rule = await prisma.houseRule.findUnique({ where: { id: ruleId } });
  if (!rule || !rule.isCurrent) throw new MasterError("NOT_FOUND", "That rule has been replaced by a newer version.");
  await prisma.houseRuleAcknowledgement.upsert({ where: { houseRuleId_userId: { houseRuleId: ruleId, userId } }, update: {}, create: { houseRuleId: ruleId, userId } });
  await recordAudit({ actorId: userId, action: "HOUSE_RULE_ACKNOWLEDGED", entityType: "HouseRule", entityId: ruleId, after: { version: rule.version } });
}

// ---------------------------------------------------------------------------
// Notification templates and channels
// ---------------------------------------------------------------------------

export async function listTemplates(organizationId: string) {
  const overrides = await prisma.notificationTemplateOverride.findMany({ where: { organizationId } });
  const channels: NotificationChannel[] = ["EMAIL", "WHATSAPP"];
  return [...KNOWN_EVENTS].sort().map((event) => ({ event, channels: channels.map((channel) => ({ channel, override: overrides.find((o) => o.event === event && o.channel === channel) ?? null })) }));
}

export async function saveTemplate(actor: ActorLike, organizationId: string, input: { event: string; channel: NotificationChannel; enabled: boolean; subject?: string | null; body?: string | null }) {
  if (!actorCan(actor, "comm.templates")) throw new MasterError("FORBIDDEN", "Only a Super Admin edits notification templates.");
  if (!KNOWN_EVENTS.includes(input.event)) throw new MasterError("NOT_FOUND", "Unknown event.");
  if (input.channel === "WHATSAPP" && (input.subject || input.body)) throw new MasterError("VALIDATION", "WhatsApp messages use the approved provider templates; you can only switch them on or off here.");
  const data = { enabled: input.enabled, subject: input.subject?.trim() || null, body: input.body?.trim() || null, updatedById: actor.id };
  const row = await prisma.notificationTemplateOverride.upsert({ where: { organizationId_event_channel: { organizationId, event: input.event, channel: input.channel } }, update: data, create: { organizationId, event: input.event, channel: input.channel, ...data } });
  await recordAudit({ actorId: actor.id, action: "TEMPLATE_UPDATED", entityType: "NotificationTemplateOverride", entityId: row.id, after: { event: input.event, channel: input.channel, enabled: input.enabled } });
  return row;
}

export async function resetTemplate(actor: ActorLike, organizationId: string, event: string, channel: NotificationChannel) {
  if (!actorCan(actor, "comm.templates")) throw new MasterError("FORBIDDEN", "Only a Super Admin edits notification templates.");
  await prisma.notificationTemplateOverride.deleteMany({ where: { organizationId, event, channel } });
  await recordAudit({ actorId: actor.id, action: "TEMPLATE_RESET", entityType: "NotificationTemplateOverride", entityId: `${event}:${channel}` });
}
