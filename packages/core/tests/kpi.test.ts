import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/db";
import type { ActorLike } from "../src/lib/permissions/actor";
import { KPI_CATALOG, KpiError, computeKpis, ensureKpiDictionary, listDictionary, setTarget, updateDefinition } from "../src/modules/kpi/service";

const stamp = Date.now().toString(36);
let orgId: string, siteA: string, siteB: string;
let sa: ActorLike;
let aa: ActorLike;

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  orgId = org.id;
  const mkUser = async (k: string) => (await prisma.user.create({ data: { organizationId: orgId, email: `kpi-${k}-${stamp}@example.com`, name: k, status: "ACTIVE", username: `kpi_${k}_${stamp}` } })).id;
  sa = { id: await mkUser("sa"), roles: ["SYSTEM_ADMIN"] };
  aa = { id: await mkUser("aa"), roles: ["ACCOMMODATION_ADMIN"] };
  siteA = (await prisma.site.create({ data: { organizationId: orgId, code: `KA${stamp}`.slice(0, 12), name: "KPI A", timezone: "UTC" } })).id;
  siteB = (await prisma.site.create({ data: { organizationId: orgId, code: `KB${stamp}`.slice(0, 12), name: "KPI B", timezone: "UTC" } })).id;
  const building = await prisma.building.create({ data: { siteId: siteA, code: `KB${stamp}`.slice(0, 12), name: "KB", status: "ACTIVE" } });
  const room = await prisma.room.create({ data: { buildingId: building.id, code: "K-1", status: "ACTIVE" } });
  const beds = await Promise.all([1, 2, 3, 4].map((n) => prisma.bed.create({ data: { roomId: room.id, code: `K-1-${n}`, status: "ACTIVE" } })));
  const staff = await prisma.staffProfile.create({ data: { organizationId: orgId, employeeId: `KPI-${stamp}`, firstName: "K", lastName: "P" } });
  await prisma.allocation.create({ data: { staffId: staff.id, bedId: beds[0].id, startDate: new Date("2026-01-01"), status: "CHECKED_IN", checkedInAt: new Date(Date.now() - 86400000) } });
});

afterAll(async () => { await prisma.$disconnect(); });

describe("KPI dictionary", () => {
  it("has one definition per KPI with formula, source and owner", async () => {
    expect(new Set(KPI_CATALOG.map((k) => k.key)).size).toBe(KPI_CATALOG.length);
    for (const k of KPI_CATALOG) { expect(k.formula.length).toBeGreaterThan(10); expect(k.source).toBeTruthy(); expect(k.owner).toBeTruthy(); }
    await ensureKpiDictionary(orgId);
    const dict = await listDictionary(orgId);
    expect(dict.length).toBe(KPI_CATALOG.length);
  });

  it("computes scoped figures with last-period and target comparison", async () => {
    await setTarget(sa, orgId, "occupancy_pct", siteA, 20);
    const { values, asOf } = await computeKpis(orgId, { siteIds: [siteA] }, { days: 30 });
    const occ = values.find((v) => v.key === "occupancy_pct")!;
    expect(occ.value).toBe(25); // 1 of 4 beds
    expect(occ.target).toBe(20);
    expect(occ.status).toBe("ok");
    expect(occ.previous).toBe(0);
    expect(occ.delta).toBe(25);
    expect(asOf).toBeInstanceOf(Date);
    expect(values.find((v) => v.key === "beds_available")!.value).toBe(3);
    const other = await computeKpis(orgId, { siteIds: [siteB] }, { keys: ["occupancy_pct", "beds_available"] });
    expect(other.values.find((v) => v.key === "beds_available")!.value).toBe(0);
    expect(other.values.find((v) => v.key === "occupancy_pct")!.target).toBeNull(); // site A's target does not leak
    // Every KPI computes without error for an empty scope.
    const all = await computeKpis(orgId, { siteIds: [siteB] });
    expect(all.values).toHaveLength(KPI_CATALOG.length);
  }, 60_000);

  it("limits who can change targets and definitions", async () => {
    await expect(setTarget(aa, orgId, "occupancy_pct", null, 90)).rejects.toBeInstanceOf(KpiError); // org-wide is the Super Admin's
    await expect(updateDefinition({ id: aa.id, roles: ["ACCOMMODATION_OFFICER"] }, orgId, "occupancy_pct", { formula: "x".repeat(20) })).rejects.toBeInstanceOf(KpiError);
    const u = await updateDefinition(sa, orgId, "arrivals", { owner: "Reception lead" });
    expect(u.owner).toBe("Reception lead");
    await updateDefinition(sa, orgId, "arrivals", { owner: "Front desk" });
  });
});
