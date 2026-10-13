// Scheduled reports and threshold alerts (document section 11): set per user and sent only to roles that may see them.
// Permission and site scope are re-checked every time one runs, so a changed role stops the delivery.
import type { ScheduleFrequency, AlertComparison } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { actorAccess, actorCan, principalOf, type ActorLike } from "../../lib/permissions/actor";
import { activeGrantsFor } from "../../lib/permissions/loader";
import { visibleSiteIds } from "../../lib/permissions/scope";
import { KPI_BY_KEY, computeKpis, formatKpi } from "../kpi/service";
import { REPORT_BY_SLUG, runReport, type Range } from "./layers";

export class ScheduleError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "VALIDATION" | "NOT_FOUND", message: string, public readonly fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "ScheduleError";
  }
}

const DAY = 86400000;
export const EXECUTIVE_DIGEST = "executive-digest";

export function nextRun(from: Date, f: ScheduleFrequency): Date {
  const n = new Date(from.getTime());
  if (f === "DAILY") n.setUTCDate(n.getUTCDate() + 1);
  else if (f === "WEEKLY") n.setUTCDate(n.getUTCDate() + 7);
  else n.setUTCMonth(n.getUTCMonth() + 1);
  n.setUTCHours(6, 0, 0, 0);
  return n;
}

const capFor = (report: string): string => (report === EXECUTIVE_DIGEST ? "rep.l1" : REPORT_BY_SLUG.get(report)?.layer === "L3" ? "rep.l3" : "rep.l2");

export function subscribableReports() {
  return [{ slug: EXECUTIVE_DIGEST, title: "Executive 360 digest", layer: "L1" }, ...[...REPORT_BY_SLUG.values()].map((r) => ({ slug: r.slug, title: r.title, layer: r.layer }))];
}

export async function createSubscription(actor: ActorLike, input: { report: string; frequency: ScheduleFrequency }) {
  if (!actorCan(actor, "rep.schedule")) throw new ScheduleError("FORBIDDEN", "Your role cannot schedule reports.");
  if (report_unknown(input.report)) throw new ScheduleError("VALIDATION", "Choose a report.", { report: "Unknown report." });
  if (!actorAccess(actor, capFor(input.report))) throw new ScheduleError("FORBIDDEN", "You cannot see that report, so it cannot be scheduled for you.");
  const count = await prisma.reportSubscription.count({ where: { userId: actor.id, active: true } });
  if (count >= 20) throw new ScheduleError("VALIDATION", "You have 20 scheduled reports already; remove one first.");
  const sub = await prisma.reportSubscription.create({ data: { userId: actor.id, report: input.report, frequency: input.frequency, nextRunAt: nextRun(new Date(), input.frequency) } });
  await recordAudit({ actorId: actor.id, action: "REPORT_SCHEDULED", entityType: "ReportSubscription", entityId: sub.id, after: { report: input.report, frequency: input.frequency } });
  return sub;
}
const report_unknown = (r: string) => r !== EXECUTIVE_DIGEST && !REPORT_BY_SLUG.has(r);

export async function removeSubscription(actor: ActorLike, id: string) {
  const s = await prisma.reportSubscription.findUnique({ where: { id } });
  if (!s || s.userId !== actor.id) throw new ScheduleError("NOT_FOUND", "Schedule not found.");
  await prisma.reportSubscription.update({ where: { id }, data: { active: false } });
  await recordAudit({ actorId: actor.id, action: "REPORT_SCHEDULE_REMOVED", entityType: "ReportSubscription", entityId: id });
}

export const mySubscriptions = (userId: string) => prisma.reportSubscription.findMany({ where: { userId, active: true }, orderBy: { createdAt: "desc" } });

export async function createAlert(actor: ActorLike, input: { kpiKey: string; comparison: AlertComparison; threshold: number; siteId?: string | null }) {
  if (!actorCan(actor, "rep.schedule")) throw new ScheduleError("FORBIDDEN", "Your role cannot set alerts.");
  if (!KPI_BY_KEY.has(input.kpiKey)) throw new ScheduleError("VALIDATION", "Choose a KPI.", { kpiKey: "Unknown KPI." });
  if (!Number.isFinite(input.threshold)) throw new ScheduleError("VALIDATION", "Enter a threshold.", { threshold: "Required." });
  const a = await prisma.reportAlert.create({ data: { userId: actor.id, kpiKey: input.kpiKey, comparison: input.comparison, threshold: input.threshold, siteId: input.siteId || null } });
  await recordAudit({ actorId: actor.id, action: "REPORT_ALERT_SET", entityType: "ReportAlert", entityId: a.id, after: { kpiKey: input.kpiKey, comparison: input.comparison, threshold: input.threshold } });
  return a;
}
export async function removeAlert(actor: ActorLike, id: string) {
  const a = await prisma.reportAlert.findUnique({ where: { id } });
  if (!a || a.userId !== actor.id) throw new ScheduleError("NOT_FOUND", "Alert not found.");
  await prisma.reportAlert.update({ where: { id }, data: { active: false } });
}
export const myAlerts = (userId: string) => prisma.reportAlert.findMany({ where: { userId, active: true }, orderBy: { createdAt: "desc" } });

/** Rebuilds the user's current permissions from the database (roles, scope and live grants). */
async function actorFor(userId: string): Promise<(ActorLike & { organizationId: string }) | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { roleAssignments: true } });
  if (!u || u.status !== "ACTIVE") return null;
  const roles = u.roleAssignments.map((r) => r.role);
  return { id: u.id, organizationId: u.organizationId, roles, vendorId: u.vendorId, roleAssignments: u.roleAssignments, grants: await activeGrantsFor(u.id, roles) };
}

async function scopeFor(actor: ActorLike, key: string) {
  return visibleSiteIds(principalOf(actor), key);
}

/** Runs every due subscription and returns how many were sent / skipped for lack of permission. */
export async function runSubscriptions(now: Date = new Date()) {
  const due = await prisma.reportSubscription.findMany({ where: { active: true, nextRunAt: { lte: now } }, take: 500 });
  let sent = 0, skipped = 0;
  for (const sub of due) {
    const actor = await actorFor(sub.userId);
    const cap = capFor(sub.report);
    if (!actor || !actorCan(actor, "rep.schedule") || !actorAccess(actor, cap)) { skipped++; await prisma.reportSubscription.update({ where: { id: sub.id }, data: { nextRunAt: nextRun(now, sub.frequency), lastRunAt: now } }); continue; }
    const siteIds = await scopeFor(actor, cap);
    const range: Range = { from: new Date(now.getTime() - (sub.frequency === "DAILY" ? 1 : sub.frequency === "WEEKLY" ? 7 : 30) * DAY), to: now };
    let lines: string[]; let title: string;
    if (sub.report === EXECUTIVE_DIGEST) {
      const k = await computeKpis(actor.organizationId, { siteIds }, { days: 7, now, keys: ["occupancy_pct", "beds_available", "arrivals", "departures", "wo_open", "wo_sla_pct", "approvals_pending", "keys_overdue", "incidents"] });
      title = "Executive 360 digest";
      lines = k.values.map((v) => `${v.name}: ${formatKpi(v.value, KPI_BY_KEY.get(v.key)!.unit)}${v.target != null ? ` (target ${v.target})` : ""}`);
    } else {
      const r = await runReport(sub.report, { siteIds, names: false }, range);
      if (!r) { skipped++; continue; }
      title = r.title;
      lines = [r.columns.join(" | "), ...r.rows.slice(0, 15).map((row) => row.map((c) => c ?? "").join(" | ")), ...(r.rows.length > 15 ? [`… and ${r.rows.length - 15} more rows`] : [])];
    }
    await prisma.$transaction(async (tx) => {
      await enqueueNotification(tx, { recipientId: sub.userId, event: "report.scheduled", idempotencyKey: `report:${sub.id}:${now.toISOString().slice(0, 10)}`, payload: { report: sub.report, title, lines, path: sub.report === EXECUTIVE_DIGEST ? "/dashboard" : `/reports/${sub.report}` } });
      await tx.reportSubscription.update({ where: { id: sub.id }, data: { lastRunAt: now, nextRunAt: nextRun(now, sub.frequency) } });
    });
    sent++;
  }
  return { sent, skipped };
}

/** Checks every alert once a day and notifies when its KPI crosses the threshold (at most once a day per alert). */
export async function evaluateAlerts(now: Date = new Date()) {
  const alerts = await prisma.reportAlert.findMany({ where: { active: true }, take: 1000 });
  let triggered = 0;
  for (const a of alerts) {
    if (a.lastTriggeredAt && now.getTime() - a.lastTriggeredAt.getTime() < DAY) continue;
    const actor = await actorFor(a.userId);
    if (!actor || !actorCan(actor, "rep.schedule")) continue;
    const def = KPI_BY_KEY.get(a.kpiKey);
    if (!def) continue;
    const visible = await scopeFor(actor, "rep.l1").then((v) => v ?? scopeFor(actor, "rep.l2"));
    const siteIds = a.siteId ? (visible === null || visible.includes(a.siteId) ? [a.siteId] : []) : visible;
    if (siteIds && siteIds.length === 0) continue;
    const { values } = await computeKpis(actor.organizationId, { siteIds }, { days: 7, keys: [a.kpiKey], now });
    const v = values[0]?.value;
    if (v == null) continue;
    const t = Number(a.threshold);
    if (a.comparison === "ABOVE" ? v > t : v < t) {
      await prisma.$transaction(async (tx) => {
        await enqueueNotification(tx, { recipientId: a.userId, event: "report.alert", idempotencyKey: `alert:${a.id}:${now.toISOString().slice(0, 10)}`, payload: { kpi: def.name, value: formatKpi(v, def.unit), threshold: t, comparison: a.comparison.toLowerCase() } });
        await tx.reportAlert.update({ where: { id: a.id }, data: { lastTriggeredAt: now } });
      });
      triggered++;
    }
  }
  return triggered;
}
