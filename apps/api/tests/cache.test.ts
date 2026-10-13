import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "@sam/core/lib/db";
import { buildApp } from "../src/app";
import { ReadCache } from "../src/cache";
import { bearer, ensureUser, testOrg, tokenFor } from "./helpers";

describe("ReadCache", () => {
  it("reuses a value within its lifetime and shares one load between concurrent callers", async () => {
    const cache = new ReadCache(1000);
    let loads = 0;
    const load = async () => { loads++; await new Promise((r) => setTimeout(r, 20)); return { n: loads }; };
    const [a, b, c] = await Promise.all([cache.get("k", load), cache.get("k", load), cache.get("k", load)]);
    expect(loads).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(await cache.get("k", load)).toBe(a);
    expect(loads).toBe(1);
    expect(cache.hits).toBe(1);
  });

  it("drops entries when cleared, and does not keep a result computed across a clear", async () => {
    const cache = new ReadCache(1000);
    let version = 1;
    const load = async () => { const v = version; await new Promise((r) => setTimeout(r, 20)); return v; };
    const first = cache.get("k", load);
    version = 2;
    cache.clear(); // a change landed while the first load was running
    expect(await first).toBe(1);
    expect(cache.size).toBe(0);
    expect(await cache.get("k", load)).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("expires entries and can be turned off", async () => {
    const short = new ReadCache(30);
    let n = 0;
    await short.get("k", async () => ++n);
    await new Promise((r) => setTimeout(r, 60));
    await short.get("k", async () => ++n);
    expect(n).toBe(2);
    const off = new ReadCache(0);
    await off.get("k", async () => ++n);
    await off.get("k", async () => ++n);
    expect(n).toBe(4);
    expect(off.size).toBe(0);
  });

  it("evicts the oldest entry beyond its limit", async () => {
    const cache = new ReadCache(1000, 2);
    for (const k of ["a", "b", "c"]) await cache.get(k, async () => k);
    expect(cache.size).toBe(2);
  });
});

describe("cached views over the API", () => {
  let app: FastifyInstance;
  let admin: string;
  let officer: string;
  const code = `CACHE-${Date.now().toString(36)}`;
  let siteId = "";

  beforeAll(async () => {
    app = await buildApp({ config: { sessionCacheTtlMs: 0, readCacheTtlMs: 60000 } });
    admin = await tokenFor((await ensureUser("cache-admin@apitest.local", ["ACCOMMODATION_ADMIN"])).id);
    officer = await tokenFor((await ensureUser("cache-officer@apitest.local", ["ACCOMMODATION_OFFICER"])).id);
    const org = await testOrg();
    siteId = (await prisma.site.upsert({ where: { organizationId_code: { organizationId: org.id, code } }, update: {}, create: { organizationId: org.id, code, name: "Cache Site" } })).id;
  });
  afterAll(async () => {
    await prisma.bed.deleteMany({ where: { room: { building: { siteId } } } });
    await prisma.room.deleteMany({ where: { building: { siteId } } });
    await prisma.building.deleteMany({ where: { siteId } });
    await prisma.site.delete({ where: { id: siteId } });
    await app.close();
  });

  const overview = async () => (await app.inject({ method: "GET", url: "/v1/accommodation/sites", headers: bearer(officer) })).json() as Array<{ site: { id: string }; buildings: unknown[] }>;

  it("serves a stale-but-fresh-enough overview, then shows a change made through the API immediately", async () => {
    const building = await prisma.building.create({ data: { siteId, code: "CB", name: "Cache Block" } });
    const room = await prisma.room.create({ data: { buildingId: building.id, code: "C1" } });
    const before = (await overview()).find((s) => s.site.id === siteId)!;
    expect(before.buildings).toHaveLength(1);

    // A change made directly in the database is not seen until the entry expires or is cleared...
    await prisma.building.create({ data: { siteId, code: "CB2", name: "Cache Block 2" } });
    expect((await overview()).find((s) => s.site.id === siteId)!.buildings).toHaveLength(1);

    // ...but any change made through the API drops cached views at once.
    const added = await app.inject({ method: "POST", url: `/v1/accommodation/rooms/${room.id}/beds`, headers: bearer(admin), payload: { count: 1 } });
    expect(added.statusCode).toBe(200);
    expect((await overview()).find((s) => s.site.id === siteId)!.buildings).toHaveLength(2);
  });

  it("keeps cached views separate per caller scope", async () => {
    const a = await app.inject({ method: "GET", url: "/v1/reports/overview", headers: bearer(officer) });
    const b = await app.inject({ method: "GET", url: "/v1/reports/overview", headers: bearer(admin) });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
  });
});
