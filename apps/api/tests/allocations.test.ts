import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "@sam/core/lib/db";
import { buildApp } from "../src/app";
import { bearer, ensureUser, testOrg, tokenFor } from "./helpers";

let app: FastifyInstance;
let admin: string;
let officer: string;
let staffToken: string;
const ids: Record<string, string> = {};
const today = new Date().toISOString().slice(0, 10);

const call = (method: "GET" | "POST", url: string, token: string, payload?: object) => app.inject({ method, url, headers: bearer(token), payload });

beforeAll(async () => {
  app = await buildApp({ config: { sessionCacheTtlMs: 0 } });
  admin = await tokenFor((await ensureUser("alloc-admin@apitest.local", ["ACCOMMODATION_ADMIN"])).id);
  officer = await tokenFor((await ensureUser("alloc-officer@apitest.local", ["ACCOMMODATION_OFFICER"])).id);
  staffToken = await tokenFor((await ensureUser("alloc-staff@apitest.local", ["STAFF"])).id);

  const org = await testOrg();
  await prisma.site.deleteMany({ where: { organizationId: org.id, code: "ALC-T" } });
  await prisma.staffProfile.deleteMany({ where: { organizationId: org.id, employeeId: "ALC-1" } });
  const site = await prisma.site.create({ data: { organizationId: org.id, code: "ALC-T", name: "Allocation API Site", timezone: "UTC" } });
  const building = await prisma.building.create({ data: { siteId: site.id, code: "AB", name: "API Block" } });
  const room = await prisma.room.create({ data: { buildingId: building.id, code: "A1" } });
  const [bedA, bedB] = await prisma.bed.createManyAndReturn({ data: [{ roomId: room.id, code: "A1-1" }, { roomId: room.id, code: "A1-2" }] });
  const person = await prisma.staffProfile.create({ data: { organizationId: org.id, employeeId: "ALC-1", firstName: "Ada", lastName: "Resident" } });
  Object.assign(ids, { site: site.id, building: building.id, room: room.id, bedA: bedA.id, bedB: bedB.id, person: person.id });
});

afterAll(async () => {
  await prisma.allocation.updateMany({ where: { staffId: ids.person }, data: { previousAllocationId: null } });
  await prisma.allocation.deleteMany({ where: { staffId: ids.person } });
  await prisma.bed.deleteMany({ where: { roomId: ids.room } });
  await prisma.room.delete({ where: { id: ids.room } });
  await prisma.building.delete({ where: { id: ids.building } });
  await prisma.site.delete({ where: { id: ids.site } });
  await prisma.staffProfile.delete({ where: { id: ids.person } });
  await app.close();
});

describe("allocations API", () => {
  it("keeps residents out and auditors read-only", async () => {
    expect((await call("GET", "/v1/allocations", staffToken)).statusCode).toBe(403);
    expect((await call("GET", "/v1/allocations/form-options", staffToken)).statusCode).toBe(403);
    const auditor = await tokenFor((await ensureUser("alloc-auditor@apitest.local", ["AUDITOR"])).id);
    expect((await call("GET", "/v1/allocations", auditor)).statusCode).toBe(200);
    expect((await call("POST", "/v1/allocations", auditor, { staffId: ids.person, bedId: ids.bedA, startDate: today })).statusCode).toBe(403);
  });

  it("lists free beds, allocates, and refuses a second claim on the same bed", async () => {
    const free = await call("GET", `/v1/allocations/available-beds?startDate=${today}&buildingId=${ids.building}`, officer);
    expect(free.statusCode).toBe(200);
    expect(free.json().map((b: { code: string }) => b.code)).toEqual(["A1-1", "A1-2"]);

    const created = await call("POST", "/v1/allocations", officer, { staffId: ids.person, bedId: ids.bedA, startDate: today, reason: "API test" });
    expect(created.statusCode).toBe(200);
    ids.allocation = created.json().id;

    const again = await call("POST", "/v1/allocations", officer, { staffId: ids.person, bedId: ids.bedB, startDate: today });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("STAFF_ALREADY_ALLOCATED");

    const after = await call("GET", `/v1/allocations/available-beds?startDate=${today}&buildingId=${ids.building}`, officer);
    expect(after.json().map((b: { code: string }) => b.code)).toEqual(["A1-2"]);
  });

  it("validates dates and unknown ids", async () => {
    expect((await call("GET", "/v1/allocations/available-beds?startDate=nope", officer)).statusCode).toBe(422);
    expect((await call("GET", "/v1/allocations/does-not-exist", officer)).statusCode).toBe(404);
  });

  it("checks in, then transfers to another bed", async () => {
    const checkedIn = await call("POST", `/v1/allocations/${ids.allocation}/check-in`, officer, {});
    expect(checkedIn.statusCode).toBe(200);
    expect(checkedIn.json().status).toBe("CHECKED_IN");

    const detail = await call("GET", `/v1/allocations/${ids.allocation}`, officer);
    expect(detail.json().allocation.staff.lastName).toBe("Resident");
    expect(detail.json().blockers).toEqual([]);

    const moved = await call("POST", `/v1/allocations/${ids.allocation}/transfer`, officer, { toBedId: ids.bedB, effectiveDate: today, reason: "Room change" });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().bedId).toBe(ids.bedB);
    ids.moved = moved.json().id;
  });

  it("reserves cancel for administrators and checks out", async () => {
    expect((await call("POST", `/v1/allocations/${ids.moved}/cancel`, officer, { reason: "x" })).statusCode).toBe(403);
    const out = await call("POST", `/v1/allocations/${ids.moved}/check-out`, officer, {});
    expect(out.statusCode).toBe(200);
    expect(out.json().status).toBe("CHECKED_OUT");
    const history = await call("GET", `/v1/allocations?filter=history&staffId=${ids.person}`, admin);
    expect(history.statusCode).toBe(200);
    expect(history.json().length).toBeGreaterThanOrEqual(1);
  });
});
