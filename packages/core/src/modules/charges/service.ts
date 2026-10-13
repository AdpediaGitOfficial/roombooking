// Charges (document 5.9, 6.2; only where the client charges for rent, facility fees or damage): rates, charges raised
// by the front desk or an Admin, approval by a different Admin, and a payroll / finance export.
import type { Prisma, RateKind } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { enqueueNotification } from "../../lib/notifications";
import { actorAccess, actorCan, type ActorLike } from "../../lib/permissions/actor";
import { toCsv } from "../reports/service";

export class ChargeError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "INVALID_STATE", message: string, public readonly fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "ChargeError";
  }
}

export const RATE_KINDS: RateKind[] = ["ROOM_RENT", "FACILITY_FEE", "DAMAGE", "OTHER"];

export async function setRate(actor: ActorLike, organizationId: string, input: { kind: RateKind; code: string; name: string; amount: number; unit?: string; siteId?: string | null; currency?: string }) {
  if (!actorCan(actor, "charges.rates", { siteId: input.siteId })) throw new ChargeError("FORBIDDEN", "Rate setup needs the Admin overrides grant (or a Super Admin).");
  const errors: Record<string, string> = {};
  if (!input.code?.trim()) errors.code = "Enter a code.";
  if (!input.name?.trim()) errors.name = "Enter a name.";
  if (!Number.isFinite(input.amount) || input.amount < 0) errors.amount = "Enter an amount of zero or more.";
  if (Object.keys(errors).length) throw new ChargeError("VALIDATION", "Please correct the highlighted fields.", errors);
  const code = input.code.trim().toUpperCase();
  const siteId = input.siteId || null;
  const existing = await prisma.rate.findFirst({ where: { organizationId, kind: input.kind, code, siteId } });
  const data = { name: input.name.trim(), amount: input.amount, unit: input.unit?.trim() || "each", currency: input.currency || "AED", active: true, createdById: actor.id };
  const rate = existing ? await prisma.rate.update({ where: { id: existing.id }, data }) : await prisma.rate.create({ data: { organizationId, siteId, kind: input.kind, code, ...data } });
  await recordAudit({ actorId: actor.id, action: existing ? "RATE_UPDATED" : "RATE_CREATED", entityType: "Rate", entityId: rate.id, before: existing ? { amount: Number(existing.amount) } : undefined, after: { code, amount: input.amount } });
  return rate;
}

export const listRates = () => prisma.rate.findMany({ where: { active: true }, orderBy: [{ kind: "asc" }, { code: "asc" }] });

export async function deactivateRate(actor: ActorLike, rateId: string) {
  const r = await prisma.rate.findUnique({ where: { id: rateId } });
  if (!r) throw new ChargeError("NOT_FOUND", "Rate not found.");
  if (!actorCan(actor, "charges.rates", { siteId: r.siteId })) throw new ChargeError("FORBIDDEN", "You cannot change rates.");
  await prisma.rate.update({ where: { id: rateId }, data: { active: false } });
  await recordAudit({ actorId: actor.id, action: "RATE_DEACTIVATED", entityType: "Rate", entityId: rateId });
}

export type RaiseInput = { staffId?: string | null; vendorId?: string | null; siteId?: string | null; kind: RateKind; description: string; quantity?: number; amount?: number | null; rateCode?: string | null; sourceType?: string | null; sourceId?: string | null };

/** Records a charge against a resident (or a vendor). It waits for a different Admin to approve; amounts come from a rate or are typed in. */
export async function raiseCharge(actor: ActorLike, input: RaiseInput) {
  if (!actorAccess(actor, "charges.raise", { siteId: input.siteId })) throw new ChargeError("FORBIDDEN", "Your role cannot record charges.");
  if (!!input.staffId === !!input.vendorId) throw new ChargeError("VALIDATION", "Charge either a resident or a vendor.", { staffId: "Choose who is charged." });
  if (!input.description?.trim()) throw new ChargeError("VALIDATION", "Describe the charge.", { description: "Required." });
  const quantity = input.quantity ?? 1;
  if (!(quantity > 0)) throw new ChargeError("VALIDATION", "Quantity must be more than zero.", { quantity: "Invalid." });
  let unit = input.amount ?? null;
  let currency = "AED";
  if (input.rateCode) {
    const bySite = input.siteId ? await prisma.site.findUnique({ where: { id: input.siteId }, select: { organizationId: true } }) : null;
    const byStaff = !bySite && input.staffId ? await prisma.staffProfile.findUnique({ where: { id: input.staffId }, select: { organizationId: true } }) : null;
    const org = bySite ? { id: bySite.organizationId } : byStaff ? { id: byStaff.organizationId } : await prisma.organization.findFirst({ select: { id: true } });
    const rate = await prisma.rate.findFirst({ where: { organizationId: org?.id, kind: input.kind, code: input.rateCode.toUpperCase(), active: true, OR: [{ siteId: input.siteId ?? null }, { siteId: null }] }, orderBy: { siteId: "desc" } });
    if (!rate) throw new ChargeError("VALIDATION", "That rate does not exist.", { rateCode: "Unknown rate." });
    unit = Number(rate.amount);
    currency = rate.currency;
  }
  if (unit == null || !Number.isFinite(unit) || unit < 0) throw new ChargeError("VALIDATION", "Enter an amount or choose a rate.", { amount: "Required." });
  if (input.staffId && !(await prisma.staffProfile.findUnique({ where: { id: input.staffId }, select: { id: true } }))) throw new ChargeError("NOT_FOUND", "Resident not found.");
  if (input.vendorId && !(await prisma.vendor.findUnique({ where: { id: input.vendorId }, select: { id: true } }))) throw new ChargeError("NOT_FOUND", "Vendor not found.");
  const total = Math.round(unit * quantity * 100) / 100;
  return prisma.$transaction(async (tx) => {
    const c = await tx.charge.create({ data: { staffId: input.staffId || null, vendorId: input.vendorId || null, siteId: input.siteId || null, kind: input.kind, description: input.description.trim(), quantity, amount: total, currency, status: "PENDING_APPROVAL", raisedById: actor.id, sourceType: input.sourceType || null, sourceId: input.sourceId || null } });
    await recordAudit({ actorId: actor.id, action: "CHARGE_RAISED", entityType: "Charge", entityId: c.id, after: { staffId: c.staffId, vendorId: c.vendorId, amount: total, kind: c.kind } }, tx);
    return c;
  });
}

export async function decideCharge(actor: ActorLike, chargeId: string, decision: "approve" | "reject" | "waive", note?: string | null) {
  const c = await prisma.charge.findUnique({ where: { id: chargeId } });
  if (!c) throw new ChargeError("NOT_FOUND", "Charge not found.");
  if (!actorCan(actor, "charges.approve", { siteId: c.siteId })) throw new ChargeError("FORBIDDEN", "Only an Accommodation Admin can approve charges.");
  if (c.status !== "PENDING_APPROVAL") throw new ChargeError("INVALID_STATE", "That charge has already been decided.");
  if (c.raisedById === actor.id) throw new ChargeError("FORBIDDEN", "Someone else must approve a charge you recorded.");
  if (decision !== "approve" && !note?.trim()) throw new ChargeError("VALIDATION", "Give a reason.", { note: "Required." });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.charge.update({ where: { id: c.id }, data: { status: decision === "approve" ? "APPROVED" : decision === "waive" ? "WAIVED" : "REJECTED", decidedById: actor.id, decidedAt: new Date(), decisionNote: note?.trim() || null } });
    await recordAudit({ actorId: actor.id, action: `CHARGE_${decision.toUpperCase()}`, entityType: "Charge", entityId: c.id, after: { note: note ?? null } }, tx);
    if (c.staffId && decision === "approve") {
      const staff = await tx.staffProfile.findUnique({ where: { id: c.staffId }, select: { userId: true } });
      if (staff?.userId) await enqueueNotification(tx, { recipientId: staff.userId, event: "charge.approved", idempotencyKey: `charge.approved:${c.id}`, payload: { chargeId: c.id, amount: Number(c.amount), description: c.description } });
    }
    return updated;
  });
}

export type ChargeFilter = "pending" | "approved" | "exported" | "all";
export async function listCharges(opts: { filter?: ChargeFilter; staffId?: string | null; vendorId?: string | null; siteIds?: string[] | null } = {}) {
  const f = opts.filter ?? "pending";
  const status = f === "pending" ? { status: "PENDING_APPROVAL" as const } : f === "approved" ? { status: "APPROVED" as const } : f === "exported" ? { status: "EXPORTED" as const } : {};
  const rows = await prisma.charge.findMany({ where: { ...status, ...(opts.staffId ? { staffId: opts.staffId } : {}), ...(opts.vendorId ? { vendorId: opts.vendorId } : {}), ...(opts.siteIds ? { OR: [{ siteId: null }, { siteId: { in: opts.siteIds } }] } : {}) }, orderBy: { createdAt: "desc" }, take: 300 });
  const staff = new Map((await prisma.staffProfile.findMany({ where: { id: { in: rows.map((r) => r.staffId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true, employeeId: true } })).map((s) => [s.id, `${s.firstName} ${s.lastName} (${s.employeeId})`]));
  const vendors = new Map((await prisma.vendor.findMany({ where: { id: { in: rows.map((r) => r.vendorId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((v) => [v.id, v.name]));
  return rows.map((r) => ({ ...r, payer: r.staffId ? staff.get(r.staffId) ?? "—" : `${vendors.get(r.vendorId ?? "") ?? "—"} (vendor)` }));
}

/** Residents see their own charges only. */
export const myCharges = (staffId: string) => prisma.charge.findMany({ where: { staffId, status: { in: ["APPROVED", "EXPORTED", "WAIVED", "PENDING_APPROVAL"] } }, orderBy: { createdAt: "desc" }, take: 100 });

export async function chargesSummary() {
  const g = await prisma.charge.groupBy({ by: ["status"], _count: true, _sum: { amount: true } });
  const get = (s: string) => g.find((x) => x.status === s);
  return { pending: get("PENDING_APPROVAL")?._count ?? 0, approved: get("APPROVED")?._count ?? 0, approvedTotal: Number(get("APPROVED")?._sum.amount ?? 0), exported: get("EXPORTED")?._count ?? 0 };
}

/** Exports approved resident charges for payroll as a batch: marks them exported so they are never sent twice. Vendor charges go to finance. */
export async function exportCharges(actor: ActorLike, organizationId: string, period: string) {
  if (!actorCan(actor, "charges.approve")) throw new ChargeError("FORBIDDEN", "Only an Accommodation Admin can export charges.");
  if (!/^\d{4}-\d{2}$/.test(period)) throw new ChargeError("VALIDATION", "Enter the payroll period as YYYY-MM.", { period: "YYYY-MM." });
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const rows = await tx.charge.findMany({ where: { status: "APPROVED", exportBatchId: null }, orderBy: { createdAt: "asc" } });
    if (rows.length === 0) throw new ChargeError("INVALID_STATE", "There are no approved charges to export.");
    const staff = new Map((await tx.staffProfile.findMany({ where: { id: { in: rows.map((r) => r.staffId).filter((x): x is string => !!x) } }, select: { id: true, employeeId: true, firstName: true, lastName: true } })).map((s) => [s.id, s]));
    const vendors = new Map((await tx.vendor.findMany({ where: { id: { in: rows.map((r) => r.vendorId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((v) => [v.id, v.name]));
    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    const batch = await tx.chargeExportBatch.create({ data: { organizationId, createdById: actor.id, period, rowCount: rows.length, total } });
    await tx.charge.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: "EXPORTED", exportBatchId: batch.id } });
    const csv = toCsv(["Batch", "Period", "Payer type", "Employee ID / vendor", "Name", "Kind", "Description", "Quantity", "Amount", "Currency", "Approved on"], rows.map((r) => [batch.id, period, r.staffId ? "RESIDENT" : "VENDOR", r.staffId ? staff.get(r.staffId)?.employeeId ?? "" : vendors.get(r.vendorId ?? "") ?? "", r.staffId ? `${staff.get(r.staffId)?.firstName ?? ""} ${staff.get(r.staffId)?.lastName ?? ""}`.trim() : vendors.get(r.vendorId ?? "") ?? "", r.kind, r.description, Number(r.quantity), Number(r.amount).toFixed(2), r.currency, r.decidedAt ? r.decidedAt.toISOString().slice(0, 10) : ""]));
    await recordAudit({ actorId: actor.id, action: "CHARGES_EXPORTED", entityType: "ChargeExportBatch", entityId: batch.id, after: { period, rows: rows.length, total } }, tx);
    return { batch, csv };
  });
}

export const listBatches = () => prisma.chargeExportBatch.findMany({ orderBy: { createdAt: "desc" }, take: 24 });
