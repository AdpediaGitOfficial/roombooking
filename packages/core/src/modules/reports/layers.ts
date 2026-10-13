// L2 operational, L3 desk and L4 audit reports (document section 11). Every report states its "as of" time; operational
// lists show names and rooms only where the viewer's scope allows, summaries show counts.
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db";
import { recordAudit } from "../../lib/audit";
import { OCCUPYING_STATUSES } from "../accommodation/occupancy";
import { vendorCompliance } from "../maintenance/extras";
import { toCsv } from "./service";

export type Cell = string | number | null;
export type ReportScope = { siteIds: string[] | null; names: boolean };
export type Range = { from: Date; to: Date };
export type TableReport = { slug: string; title: string; asOf: Date; live: boolean; columns: string[]; rows: Cell[][]; note?: string };
export type ReportDef = { slug: string; layer: "L2" | "L3"; module: string; title: string; description: string; run: (s: ReportScope, r: Range) => Promise<Omit<TableReport, "slug" | "title" | "asOf" | "live"> & { live?: boolean }> };

const DAY = 86400000;
const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : null);
const dt = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 16).replace("T", " ") : null);
const siteWhere = (s: ReportScope) => (s.siteIds ? { siteId: { in: s.siteIds } } : {});
const bedWhere = (s: ReportScope): Prisma.BedWhereInput => (s.siteIds ? { room: { building: { siteId: { in: s.siteIds } } } } : {});
const allocWhere = (s: ReportScope): Prisma.AllocationWhereInput => (s.siteIds ? { bed: { room: { building: { siteId: { in: s.siteIds } } } } } : {});
const nm = (s: ReportScope, p: { firstName: string; lastName: string } | null | undefined) => (!p ? "—" : s.names ? `${p.firstName} ${p.lastName}` : "(name hidden)");
const pct = (n: number, t: number) => (t ? Math.round((n / t) * 1000) / 10 : null);
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const inR = (r: Range) => ({ gte: r.from, lt: r.to });

export const REPORTS: ReportDef[] = [
  {
    slug: "occupancy", layer: "L2", module: "Accommodation", title: "Occupancy by site, building and room type", description: "Beds, occupied, vacant, blocked and occupancy % right now.",
    run: async (s) => {
      const beds = await prisma.bed.findMany({ where: { ...bedWhere(s), archivedAt: null }, select: { id: true, status: true, room: { select: { type: true, status: true, building: { select: { name: true, site: { select: { name: true } } } } } } } });
      const occ = new Set((await prisma.allocation.findMany({ where: { ...allocWhere(s), status: { in: ["CHECKED_IN"] } }, select: { bedId: true } })).map((a) => a.bedId));
      const g = new Map<string, { site: string; building: string; type: string; beds: number; occ: number; blocked: number }>();
      for (const b of beds) {
        const key = `${b.room.building.site.name}|${b.room.building.name}|${b.room.type ?? "—"}`;
        const row = g.get(key) ?? { site: b.room.building.site.name, building: b.room.building.name, type: b.room.type ?? "—", beds: 0, occ: 0, blocked: 0 };
        row.beds++; if (occ.has(b.id)) row.occ++; if (["BLOCKED", "MAINTENANCE"].includes(b.status) || ["BLOCKED", "MAINTENANCE"].includes(b.room.status)) row.blocked++;
        g.set(key, row);
      }
      return { live: true, columns: ["Site", "Building", "Room type", "Beds", "Occupied", "Blocked", "Vacant", "Occupancy %"], rows: [...g.values()].sort((a, b) => (a.site + a.building).localeCompare(b.site + b.building)).map((r) => [r.site, r.building, r.type, r.beds, r.occ, r.blocked, Math.max(0, r.beds - r.occ - r.blocked), pct(r.occ, r.beds - r.blocked)]) };
    },
  },
  {
    slug: "vacancy-ageing", layer: "L2", module: "Accommodation", title: "Vacancy ageing", description: "Vacant beds and how long they have been empty.",
    run: async (s) => {
      const beds = await prisma.bed.findMany({ where: { ...bedWhere(s), archivedAt: null, status: "ACTIVE", allocations: { none: { status: { in: OCCUPYING_STATUSES } } } }, select: { code: true, readiness: true, room: { select: { code: true, building: { select: { name: true, site: { select: { name: true } } } } } }, allocations: { where: { status: "CHECKED_OUT" }, orderBy: { checkedOutAt: "desc" }, take: 1, select: { checkedOutAt: true } } }, take: 2000 });
      const now = Date.now();
      return { live: true, columns: ["Site", "Building", "Room", "Bed", "Readiness", "Last vacated", "Days vacant"], rows: beds.map((b) => { const last = b.allocations[0]?.checkedOutAt ?? null; return [b.room.building.site.name, b.room.building.name, b.room.code, b.code, b.readiness.toLowerCase().replace(/_/g, " "), d(last), last ? Math.floor((now - last.getTime()) / DAY) : null] as Cell[]; }).sort((a, b) => Number(b[6] ?? -1) - Number(a[6] ?? -1)) };
    },
  },
  {
    slug: "overstays", layer: "L2", module: "Accommodation", title: "Overstays and no-shows", description: "Residents past their end date, and reservations never taken up.",
    run: async (s) => {
      const today = new Date(new Date().toISOString().slice(0, 10));
      const [over, noShow] = await Promise.all([
        prisma.allocation.findMany({ where: { ...allocWhere(s), status: "CHECKED_IN", endDate: { lt: today } }, include: { staff: true, bed: { include: { room: { include: { building: true } } } } }, take: 500 }),
        prisma.allocation.findMany({ where: { ...allocWhere(s), status: "CONFIRMED", startDate: { lt: today } }, include: { staff: true, bed: { include: { room: { include: { building: true } } } } }, take: 500 }),
      ]);
      const row = (kind: string, a: (typeof over)[number]): Cell[] => [kind, nm(s, a.staff), a.bed.room.building.name, a.bed.room.code, d(a.startDate), d(a.endDate), Math.floor((today.getTime() - (kind === "Overstay" ? a.endDate!.getTime() : a.startDate.getTime())) / DAY)];
      return { live: true, columns: ["Type", "Resident", "Building", "Room", "From", "To", "Days late"], rows: [...over.map((a) => row("Overstay", a)), ...noShow.map((a) => row("Reserved, not arrived", a))] };
    },
  },
  {
    slug: "people-pipeline", layer: "L2", module: "People", title: "People pipeline", description: "Joiners and exits in the next 30 days, unverified profiles, clearances, eligibility exceptions and family stays.",
    run: async (_s, r) => {
      const horizon = new Date(Date.now() + 30 * DAY);
      const [joiners, exits, unverified, clearing, exceptions, family] = await Promise.all([
        prisma.joiner.count({ where: { status: { in: ["EXPECTED", "ALLOCATED"] }, expectedArrival: { lte: horizon } } }),
        prisma.exitCase.count({ where: { status: { in: ["OPEN", "CHECKOUT_DUE", "CLEARING"] }, lastDay: { lte: horizon } } }),
        prisma.staffProfile.count({ where: { verificationStatus: "UNVERIFIED", archivedAt: null, mergedIntoId: null } }),
        prisma.exitCase.count({ where: { status: { in: ["CLEARING", "CHECKOUT_DUE"] } } }),
        prisma.auditEvent.count({ where: { action: "ELIGIBILITY_OVERRIDE", createdAt: inR(r) } }),
        prisma.dependent.count({ where: { status: "VERIFIED", archivedAt: null } }),
      ]);
      return { live: true, columns: ["Measure", "Count"], rows: [["Joiners expected (30 days)", joiners], ["Exits due (30 days)", exits], ["Unverified profiles", unverified], ["Clearances in progress", clearing], ["Eligibility exceptions in the period", exceptions], ["Verified dependents (family stays)", family]] };
    },
  },
  {
    slug: "approvals", layer: "L2", module: "Approvals", title: "Approvals: volume and turnaround", description: "By request type: raised, decided, average hours, rejections and escalations.",
    run: async (_s, r) => {
      const reqs = await prisma.request.findMany({ where: { createdAt: inR(r) }, select: { status: true, createdAt: true, decidedAt: true, escalatedAt: true, requestType: { select: { name: true } } }, take: 10000 });
      const g = new Map<string, typeof reqs>();
      for (const q of reqs) g.set(q.requestType.name, [...(g.get(q.requestType.name) ?? []), q]);
      return { columns: ["Request type", "Raised", "Decided", "Avg hours to decide", "Rejected", "Rejection %", "Escalated", "Delegations"], rows: [...g.entries()].map(([name, rs]) => { const decided = rs.filter((x) => x.decidedAt); const rej = rs.filter((x) => x.status === "REJECTED").length; return [name, rs.length, decided.length, avg(decided.map((x) => (x.decidedAt!.getTime() - x.createdAt.getTime()) / 3600000)), rej, pct(rej, decided.length), rs.filter((x) => x.escalatedAt).length, null] as Cell[]; }).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) };
    },
  },
  {
    slug: "technicians", layer: "L2", module: "Maintenance", title: "Technician performance and preventive compliance", description: "Jobs, speed, ratings and repeats per technician; preventive jobs done on time.",
    run: async (s, r) => {
      const wos = await prisma.workOrder.findMany({ where: { ...siteWhere(s), createdAt: inR(r), assigneeId: { not: null } }, select: { assigneeId: true, resolvedAt: true, createdAt: true, slaDueAt: true, rating: true, reopenCount: true, source: true, status: true } });
      const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(wos.map((w) => w.assigneeId!))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      const g = new Map<string, typeof wos>();
      for (const w of wos) g.set(w.assigneeId!, [...(g.get(w.assigneeId!) ?? []), w]);
      return { columns: ["Technician", "Jobs", "Resolved", "Avg hours to resolve", "Within SLA %", "Avg rating", "Reopened", "Preventive done on time %"], rows: [...g.entries()].map(([id, rs]) => { const done = rs.filter((x) => x.resolvedAt); const prev = rs.filter((x) => x.source === "PREVENTIVE" && x.resolvedAt && x.slaDueAt); return [users.get(id) ?? "—", rs.length, done.length, avg(done.map((x) => (x.resolvedAt!.getTime() - x.createdAt.getTime()) / 3600000)), pct(done.filter((x) => x.slaDueAt && x.resolvedAt! <= x.slaDueAt).length, done.filter((x) => x.slaDueAt).length), avg(rs.filter((x) => x.rating).map((x) => x.rating!)), rs.filter((x) => x.reopenCount > 0).length, pct(prev.filter((x) => x.resolvedAt! <= x.slaDueAt!).length, prev.length)] as Cell[]; }) };
    },
  },
  {
    slug: "vendors", layer: "L2", module: "Vendors", title: "Vendor performance and compliance", description: "SLA, rating, quotes against actuals, and upcoming contract and document expiry.",
    run: async (s, r) => {
      const wos = await prisma.workOrder.findMany({ where: { ...siteWhere(s), vendorId: { not: null }, createdAt: inR(r) }, select: { vendorId: true, resolvedAt: true, slaDueAt: true, rating: true, costEstimate: true, costActual: true } });
      const vendors = new Map((await prisma.vendor.findMany({ select: { id: true, name: true, state: true, contractEnd: true } })).map((v) => [v.id, v]));
      const g = new Map<string, typeof wos>();
      for (const w of wos) g.set(w.vendorId!, [...(g.get(w.vendorId!) ?? []), w]);
      const perf = [...g.entries()].map(([id, rs]) => { const done = rs.filter((x) => x.resolvedAt && x.slaDueAt); const q = rs.filter((x) => x.costEstimate != null && x.costActual != null); return ["Performance", vendors.get(id)?.name ?? "—", rs.length, pct(done.filter((x) => x.resolvedAt! <= x.slaDueAt!).length, done.length), avg(rs.filter((x) => x.rating).map((x) => x.rating!)), q.length ? Math.round((q.reduce((t, x) => t + Number(x.costActual) - Number(x.costEstimate), 0)) * 100) / 100 : null, null] as Cell[]; });
      const comp = (await vendorCompliance(new Date(), 60)).map((c) => ["Compliance", c.vendor, null, null, null, null, `${c.what} ${c.daysLeft < 0 ? `expired ${-c.daysLeft}d ago` : `expires ${c.expiresOn} (${c.daysLeft}d)`}`] as Cell[]);
      return { columns: ["Section", "Vendor", "Jobs", "Within SLA %", "Avg rating", "Actual − quoted", "Expiry"], rows: [...perf, ...comp] };
    },
  },
  {
    slug: "inventory", layer: "L2", module: "Inventory", title: "Stock, usage and write-offs", description: "Stock levels, issues in the period, asset condition and write-offs.",
    run: async (s, r) => {
      const [items, tx, wo] = await Promise.all([
        prisma.inventoryItem.findMany({ where: { ...siteWhere(s), status: "ACTIVE" }, select: { id: true, name: true, sku: true, category: true, trackingType: true, quantity: true, reorderThreshold: true, condition: true, unitValue: true, site: { select: { name: true } } }, take: 3000 }),
        prisma.inventoryTransaction.groupBy({ by: ["itemId"], where: { type: "ISSUE", createdAt: inR(r) }, _sum: { quantity: true } }),
        prisma.inventoryWriteOff.findMany({ where: { status: "APPROVED", decidedAt: inR(r) } }),
      ]);
      const used = new Map(tx.map((t) => [t.itemId, Math.abs(t._sum.quantity ?? 0)]));
      const wrote = new Map<string, number>();
      for (const w of wo) wrote.set(w.itemId, (wrote.get(w.itemId) ?? 0) + w.quantity);
      return { live: true, columns: ["Site", "SKU", "Item", "Category", "Type", "On hand", "Reorder at", "Used in period", "Written off", "Condition", "Value"], rows: items.map((i) => [i.site.name, i.sku, i.name, i.category, i.trackingType === "STOCK" ? "stock" : "asset", i.quantity, i.reorderThreshold, used.get(i.id) ?? 0, wrote.get(i.id) ?? 0, i.condition.toLowerCase(), i.unitValue ? Math.round(Number(i.unitValue) * i.quantity * 100) / 100 : null] as Cell[]) };
    },
  },
  {
    slug: "security", layer: "L2", module: "Security", title: "Visitors, contractors and incidents", description: "Visitor volume, overnight stays, overstays, late entries, contractor visits against schedule, and incidents by category.",
    run: async (s, r) => {
      const [visitors, visits, incidents, late] = await Promise.all([
        prisma.visitor.findMany({ where: { ...siteWhere(s), createdAt: inR(r) }, select: { kind: true, status: true, expectedOutAt: true, checkedOutAt: true } }),
        prisma.contractorVisit.findMany({ where: { ...siteWhere(s), scheduledStart: inR(r) }, select: { status: true } }),
        prisma.incident.groupBy({ by: ["category"], where: { ...siteWhere(s), createdAt: inR(r) }, _count: true }),
        prisma.auditEvent.count({ where: { action: "VISITOR_CHECKED_IN_LATE", createdAt: inR(r) } }),
      ]);
      const rows: Cell[][] = [["Visitors registered", visitors.length], ["Overnight visitors", visitors.filter((v) => v.kind === "OVERNIGHT").length], ["Checked in", visitors.filter((v) => ["CHECKED_IN", "CHECKED_OUT"].includes(v.status)).length], ["Denied", visitors.filter((v) => v.status === "DENIED").length], ["Overstays", visitors.filter((v) => v.expectedOutAt && ((v.checkedOutAt ?? new Date()) > v.expectedOutAt) && ["CHECKED_IN", "CHECKED_OUT"].includes(v.status)).length], ["Late entries", late], ["Contractor visits scheduled", visits.length], ["Contractor visits attended", visits.filter((v) => ["CHECKED_IN", "CHECKED_OUT"].includes(v.status)).length], ["Contractor visits denied", visits.filter((v) => v.status === "DENIED").length], ...incidents.map((i) => [`Incidents: ${i.category}`, i._count] as Cell[])];
      return { columns: ["Measure", "Count"], rows };
    },
  },
  {
    slug: "housekeeping", layer: "L2", module: "Housekeeping", title: "Cleaning and inspections", description: "Cleaning tasks done and overdue, inspections and issues found.",
    run: async (s, r) => {
      const [tasks, insp] = await Promise.all([prisma.cleaningTask.findMany({ where: { ...siteWhere(s), createdAt: inR(r) }, select: { status: true, dueAt: true, completedAt: true, createdAt: true } }), prisma.inspection.findMany({ where: { ...siteWhere(s), scheduledFor: inR(r) }, select: { status: true } })]);
      return { columns: ["Measure", "Count"], rows: [["Cleaning tasks created", tasks.length], ["Done", tasks.filter((t) => t.status === "DONE").length], ["Done late", tasks.filter((t) => t.status === "DONE" && t.dueAt && t.completedAt && t.completedAt > t.dueAt).length], ["Still open and overdue", tasks.filter((t) => ["OPEN", "IN_PROGRESS"].includes(t.status) && t.dueAt && t.dueAt < new Date()).length], ["Average hours to clean", avg(tasks.filter((t) => t.completedAt).map((t) => (t.completedAt!.getTime() - t.createdAt.getTime()) / 3600000))], ["Inspections scheduled", insp.length], ["Inspections done", insp.filter((i) => i.status !== "SCHEDULED" && i.status !== "CANCELLED").length], ["Inspections with issues", insp.filter((i) => i.status === "ISSUES_FOUND").length]] };
    },
  },
  {
    slug: "charges", layer: "L2", module: "Charges", title: "Charges by kind and status", description: "Recorded, approved, exported and waived charges.",
    run: async (s, r) => {
      const g = await prisma.charge.groupBy({ by: ["kind", "status"], where: { ...(s.siteIds ? { OR: [{ siteId: null }, { siteId: { in: s.siteIds } }] } : {}), createdAt: inR(r) }, _count: true, _sum: { amount: true } });
      return { columns: ["Kind", "Status", "Charges", "Amount"], rows: g.map((x) => [x.kind.toLowerCase().replace("_", " "), x.status.toLowerCase().replace("_", " "), x._count, Number(x._sum.amount ?? 0)] as Cell[]) };
    },
  },
  {
    slug: "key-losses", layer: "L2", module: "Keys", title: "Key losses, lock changes and audit variances", description: "Lost keys with their cases, and the result of key audits.",
    run: async (s, r) => {
      const [cases, audits] = await Promise.all([prisma.keyLossCase.findMany({ where: { createdAt: inR(r) } }), prisma.keyAudit.findMany({ where: { ...siteWhere(s), startedAt: inR(r), status: "COMPLETED" } })]);
      const keys = new Map((await prisma.key.findMany({ where: { id: { in: cases.map((c) => c.keyId) } }, select: { id: true, code: true, siteId: true } })).map((k) => [k.id, k]));
      return { columns: ["Type", "Reference", "Detail", "Date"], rows: [...cases.filter((c) => !s.siteIds || s.siteIds.includes(keys.get(c.keyId)?.siteId ?? "")).map((c) => ["Loss", keys.get(c.keyId)?.code ?? "—", `${c.status.toLowerCase().replace(/_/g, " ")}${c.workOrderId ? " · lock change ordered" : ""}`, d(c.createdAt)] as Cell[]), ...audits.map((a) => { const v = a.variances as { missing?: string[]; unexpected?: unknown[] } | null; return ["Audit", a.id.slice(-6), `${v?.missing?.length ?? 0} missing, ${v?.unexpected?.length ?? 0} unexpected`, d(a.completedAt)] as Cell[]; })] };
    },
  },
  // ----- L3 desk / shift -----
  {
    slug: "desk-today", layer: "L3", module: "Desk", title: "Today at the desk", description: "Arrivals, departures, transfers, keys, readiness, bookings, parcels, people inside and the shift summary.",
    run: async (s) => {
      const start = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z"), end = new Date(start.getTime() + DAY);
      const [arr, dep, trans, keysOut, keysOver, notReady, ready, bookings, noShows, gate, inside, parcels, shifts] = await Promise.all([
        prisma.allocation.count({ where: { ...allocWhere(s), OR: [{ startDate: start, status: { in: ["CONFIRMED", "CHECKED_IN"] } }, { checkedInAt: { gte: start, lt: end } }] } }),
        prisma.allocation.count({ where: { ...allocWhere(s), OR: [{ endDate: start, status: "CHECKED_IN" }, { checkedOutAt: { gte: start, lt: end } }] } }),
        prisma.moveTask.count({ where: { status: "OPEN" } }),
        prisma.keyTransaction.count({ where: { type: "ISSUE", createdAt: { gte: start, lt: end }, ...(s.siteIds ? { key: { siteId: { in: s.siteIds } } } : {}) } }),
        prisma.keyTransaction.count({ where: { type: "ISSUE", returnedAt: null, expectedReturnAt: { lt: new Date() }, ...(s.siteIds ? { key: { siteId: { in: s.siteIds } } } : {}) } }),
        prisma.bed.count({ where: { ...bedWhere(s), status: "ACTIVE", readiness: { not: "READY" } } }),
        prisma.bed.count({ where: { ...bedWhere(s), status: "ACTIVE", readiness: "READY" } }),
        prisma.facilityBooking.count({ where: { startsAt: { gte: start, lt: end }, status: { in: ["CONFIRMED", "CHECKED_IN", "COMPLETED"] }, ...(s.siteIds ? { facility: { siteId: { in: s.siteIds } } } : {}) } }),
        prisma.facilityBooking.count({ where: { startsAt: { gte: start, lt: end }, status: "NO_SHOW", ...(s.siteIds ? { facility: { siteId: { in: s.siteIds } } } : {}) } }),
        prisma.visitor.count({ where: { ...siteWhere(s), OR: [{ checkedInAt: { gte: start, lt: end } }, { expectedAt: { gte: start, lt: end } }] } }),
        prisma.visitor.count({ where: { ...siteWhere(s), status: "CHECKED_IN" } }),
        prisma.parcel.count({ where: { ...siteWhere(s), status: { in: ["RECEIVED", "NOTIFIED"] } } }),
        prisma.shiftLog.count({ where: { startedAt: { gte: start, lt: end }, ...(s.siteIds ? { siteId: { in: s.siteIds } } : {}) } }),
      ]);
      return { live: true, columns: ["Measure", "Count"], rows: [["Arrivals today", arr], ["Departures today", dep], ["Open move / checkout tasks", trans], ["Keys issued today", keysOut], ["Keys overdue", keysOver], ["Beds ready", ready], ["Beds not ready", notReady], ["Facility bookings today", bookings], ["Facility no-shows today", noShows], ["Gate log: visitors today", gate], ["People inside now (visitors)", inside], ["Parcels waiting", parcels], ["Shifts started today", shifts]] };
    },
  },
  {
    slug: "gate-log", layer: "L3", module: "Desk", title: "Gate log", description: "Visitors and contractors in and out in the period.",
    run: async (s, r) => {
      const [v, c] = await Promise.all([prisma.visitor.findMany({ where: { ...siteWhere(s), checkedInAt: inR(r) }, orderBy: { checkedInAt: "desc" }, take: 1000 }), prisma.contractorVisit.findMany({ where: { ...siteWhere(s), checkedInAt: inR(r) }, orderBy: { checkedInAt: "desc" }, take: 500 })]);
      const vendors = new Map((await prisma.vendor.findMany({ where: { id: { in: c.map((x) => x.vendorId) } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
      return { columns: ["Type", "Name", "In", "Out", "Status"], rows: [...v.map((x) => ["Visitor", x.name, dt(x.checkedInAt), dt(x.checkedOutAt), x.status.toLowerCase().replace(/_/g, " ")] as Cell[]), ...c.map((x) => ["Contractor", `${vendors.get(x.vendorId) ?? "—"} (${x.workerIds.length})`, dt(x.checkedInAt), dt(x.checkedOutAt), x.status.toLowerCase().replace(/_/g, " ")] as Cell[])].sort((a, b) => String(b[2]).localeCompare(String(a[2]))) };
    },
  },
  {
    slug: "shift-summary", layer: "L3", module: "Desk", title: "Shift summary", description: "Shifts in the period with what was done.",
    run: async (s, r) => {
      const shifts = await prisma.shiftLog.findMany({ where: { startedAt: inR(r), ...(s.siteIds ? { siteId: { in: s.siteIds } } : {}) }, orderBy: { startedAt: "desc" }, take: 300 });
      const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(shifts.map((x) => x.userId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      return { columns: ["User", "Started", "Ended", "Activity", "Handover notes"], rows: shifts.map((x) => [users.get(x.userId) ?? "—", dt(x.startedAt), dt(x.endedAt), ((x.summary as { activity?: Array<{ label: string; count: number }> } | null)?.activity ?? []).map((a) => `${a.count} ${a.label.toLowerCase()}`).join(", "), x.notes] as Cell[]) };
    },
  },
];

export const REPORT_BY_SLUG = new Map(REPORTS.map((r) => [r.slug, r]));

export async function runReport(slug: string, scope: ReportScope, range: Range): Promise<TableReport | null> {
  const def = REPORT_BY_SLUG.get(slug);
  if (!def) return null;
  const out = await def.run(scope, range);
  return { slug, title: def.title, asOf: new Date(), live: out.live ?? false, columns: out.columns, rows: out.rows, note: out.note };
}

export function reportCsv(r: TableReport): string {
  return toCsv(r.columns, r.rows);
}

// ---------------------------------------------------------------------------
// L4 audit and exception reports
// ---------------------------------------------------------------------------

export const EXCEPTION_GROUPS: Array<{ key: string; title: string; match: Prisma.AuditEventWhereInput }> = [
  { key: "overrides", title: "Overrides", match: { action: { contains: "OVERRIDE" } } },
  { key: "logins", title: "Logins and failed logins", match: { OR: [{ action: { startsWith: "LOGIN" } }, { action: { contains: "LOCKED" } }, { action: "USER_UNLOCKED" }] } },
  { key: "passwords", title: "Password changes and resets", match: { action: { startsWith: "PASSWORD" } } },
  { key: "access", title: "Role, permission and grant changes", match: { OR: [{ action: { startsWith: "ROLE_" } }, { action: { startsWith: "GRANT_" } }, { action: { startsWith: "CHANGE_" } }, { action: "USER_STATUS_CHANGED" }] } },
  { key: "keys", title: "Sensitive key movements and losses", match: { OR: [{ action: { in: ["KEY_LOST", "KEY_LOSS_REPORTED", "KEY_LOSS_APPROVED", "KEY_MARKED_SENSITIVE", "KEY_AUDIT_COMPLETED"] } }] } },
  { key: "stock", title: "Stock adjustments and write-offs", match: { action: { in: ["INVENTORY_ADJUSTMENT", "WRITE_OFF_REQUESTED", "WRITE_OFF_APPROVED", "WRITE_OFF_REJECTED", "INVENTORY_RETIRED"] } } },
  { key: "archives", title: "Archives, restores and deletions", match: { OR: [{ action: { endsWith: "_ARCHIVED" } }, { action: { endsWith: "_RESTORED" } }, { action: { contains: "HARD_DELETE" } }, { action: "STAFF_ERASED" }] } },
  { key: "exports", title: "Report views and exports", match: { OR: [{ action: { contains: "EXPORT" } }, { action: "REPORT_VIEWED" }] } },
  { key: "integrations", title: "Integration events", match: { OR: [{ action: { startsWith: "INTEGRATION_" } }, { action: { startsWith: "API_KEY_" } }, { action: { startsWith: "WEBHOOK_" } }, { action: { startsWith: "HRMS_" } }] } },
  { key: "privacy", title: "Data requests and retention", match: { OR: [{ action: { startsWith: "DATA_REQUEST" } }, { action: { startsWith: "RETENTION_" } }, { action: "CONSENT_ACCEPTED" }] } },
];

export type ExceptionRow = { id: string; when: Date; actor: string | null; action: string; entity: string; entityId: string; reason: string | null; ip: string | null; change: string };

/**
 * Exception reports from the audit log. An Accommodation Admin sees their sites' events without Super Admin actions;
 * the Super Admin and Auditor see everything (document 11, L4).
 */
export async function exceptionReport(opts: { groupKey: string; range: Range; excludeSuperAdmin: boolean; siteIds?: string[] | null; q?: string | null }, limit = 300): Promise<{ title: string; rows: ExceptionRow[]; asOf: Date }> {
  const group = EXCEPTION_GROUPS.find((g) => g.key === opts.groupKey) ?? EXCEPTION_GROUPS[0];
  const where: Prisma.AuditEventWhereInput = { AND: [group.match, { createdAt: inR(opts.range) }, ...(opts.excludeSuperAdmin ? [{ OR: [{ actorId: null }, { actor: { roleAssignments: { none: { role: "SYSTEM_ADMIN" as const } } } }] }] : []), ...(opts.siteIds ? [{ OR: [{ siteId: null }, { siteId: { in: opts.siteIds } }] }] : []), ...(opts.q ? [{ OR: [{ action: { contains: opts.q, mode: "insensitive" as const } }, { entityId: opts.q }, { actor: { name: { contains: opts.q, mode: "insensitive" as const } } }] }] : [])] };
  const events = await prisma.auditEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, include: { actor: { select: { name: true } } } });
  return { title: group.title, asOf: new Date(), rows: events.map((e) => ({ id: e.id, when: e.createdAt, actor: e.actor?.name ?? null, action: e.action, entity: e.entityType, entityId: e.entityId, reason: e.reason, ip: e.ip, change: [e.before ? `− ${JSON.stringify(e.before)}` : "", e.after ? `+ ${JSON.stringify(e.after)}` : ""].filter(Boolean).join("  ").slice(0, 400) })) };
}

export async function exceptionCounts(range: Range, excludeSuperAdmin: boolean) {
  return Promise.all(EXCEPTION_GROUPS.map(async (g) => ({ key: g.key, title: g.title, count: await prisma.auditEvent.count({ where: { AND: [g.match, { createdAt: inR(range) }, ...(excludeSuperAdmin ? [{ OR: [{ actorId: null }, { actor: { roleAssignments: { none: { role: "SYSTEM_ADMIN" as const } } } }] }] : [])] } }) })));
}

/** The full history of one record, oldest first (the record timeline). */
export async function recordTimeline(entityType: string, entityId: string) {
  const events = await prisma.auditEvent.findMany({ where: { entityType, entityId }, orderBy: { createdAt: "asc" }, take: 500, include: { actor: { select: { name: true } } } });
  return events.map((e) => ({ id: e.id, when: e.createdAt, actor: e.actor?.name ?? "system", action: e.action, reason: e.reason, ip: e.ip, before: e.before, after: e.after }));
}

/** Viewing or exporting a report is itself audited. */
export async function auditReportView(actorId: string, slug: string, kind: "VIEWED" | "EXPORTED") {
  await recordAudit({ actorId, action: kind === "VIEWED" ? "REPORT_VIEWED" : "REPORT_EXPORTED", entityType: "Report", entityId: slug });
}
