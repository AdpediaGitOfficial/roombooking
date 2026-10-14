import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "@sam/core/lib/db";
import { buildApp } from "../src/app";
import { bearer, ensureUser, testOrg, tokenFor } from "./helpers";

let app: FastifyInstance;
let admin: string;
let officer: string;
let staff: string;
let ids: { site: string; building: string; room: string };

const call = (method: "GET" | "POST" | "PUT", url: string, token: string, payload?: object) =>
  app.inject({ method, url, headers: bearer(token), payload });

beforeAll(async () => {
  app = await buildApp({ config: { sessionCacheTtlMs: 0 } });
  admin = await tokenFor((await ensureUser("acc-admin@apitest.local", ["ACCOMMODATION_ADMIN"])).id);
  officer = await tokenFor((await ensureUser("acc-officer@apitest.local", ["ACCOMMODATION_OFFICER"])).id);
  staff = await tokenFor((await ensureUser("acc-staff@apitest.local", ["STAFF"])).id);

  const org = await testOrg();
  await prisma.site.deleteMany({ where: { organizationId: org.id, code: "ACC-T" } });
  const site = await prisma.site.create({ data: { organizationId: org.id, code: "ACC-T", name: "Accommodation Test Site", timezone: "Asia/Dubai" } });
  const building = await prisma.building.create({ data: { siteId: site.id, code: "B1", name: "Block One" } });
  const room = await prisma.room.create({ data: { buildingId: building.id, code: "101" } });
  ids = { site: site.id, building: building.id, room: room.id };
});

afterAll(async () => {
  await prisma.bed.deleteMany({ where: { roomId: ids.room } });
  await prisma.room.delete({ where: { id: ids.room } });
  await prisma.building.delete({ where: { id: ids.building } });
  await prisma.site.delete({ where: { id: ids.site } });
  await app.close();
});

describe("accommodation API", () => {
  it("lets viewers read and blocks residents", async () => {
    expect((await call("GET", "/v1/accommodation/sites", officer)).statusCode).toBe(200);
    expect((await call("GET", "/v1/accommodation/sites", staff)).statusCode).toBe(403);
    const building = await call("GET", `/v1/accommodation/buildings/${ids.building}`, officer);
    expect(building.statusCode).toBe(200);
    expect(building.json().building.name).toBe("Block One");
    expect((await call("GET", "/v1/accommodation/rooms/missing-room", officer)).statusCode).toBe(404);
  });

  it("only managers change beds and rooms", async () => {
    expect((await call("POST", `/v1/accommodation/rooms/${ids.room}/beds`, officer, { count: 2 })).statusCode).toBe(403);
    const added = await call("POST", `/v1/accommodation/rooms/${ids.room}/beds`, admin, { count: 2 });
    expect(added.statusCode).toBe(200);
    expect(added.json().codes).toEqual(["101-1", "101-2"]);
    const more = await call("POST", `/v1/accommodation/rooms/${ids.room}/beds`, admin, { count: 1 });
    expect(more.json().codes).toEqual(["101-3"]);
  });

  it("validates counts and reasons", async () => {
    expect((await call("POST", `/v1/accommodation/rooms/${ids.room}/beds`, admin, { count: 99 })).statusCode).toBe(422);
    const bed = await prisma.bed.findFirstOrThrow({ where: { roomId: ids.room }, orderBy: { code: "asc" } });
    const noReason = await call("PUT", `/v1/accommodation/beds/${bed.id}/status`, admin, { status: "BLOCKED" });
    expect(noReason.statusCode).toBe(422);
    expect(noReason.json().error.message).toMatch(/reason is required/i);
  });

  it("blocks and restores a bed, writing audit rows", async () => {
    const bed = await prisma.bed.findFirstOrThrow({ where: { roomId: ids.room }, orderBy: { code: "asc" } });
    const blocked = await call("PUT", `/v1/accommodation/beds/${bed.id}/status`, admin, { status: "BLOCKED", reason: "Leak" });
    expect(blocked.statusCode).toBe(200);
    expect(blocked.json().changed).toBe(true);
    const again = await call("PUT", `/v1/accommodation/beds/${bed.id}/status`, admin, { status: "BLOCKED", reason: "Leak" });
    expect(again.json()).toMatchObject({ changed: false, message: "No change." });
    const room = await call("GET", `/v1/accommodation/rooms/${ids.room}`, officer);
    expect(room.json().summary.blocked).toBe(1);
    await call("PUT", `/v1/accommodation/beds/${bed.id}/status`, admin, { status: "ACTIVE" });
    const audits = await prisma.auditEvent.count({ where: { entityType: "Bed", entityId: bed.id, action: "BED_STATUS_CHANGED" } });
    expect(audits).toBe(2);
  });

  it("changes a room status and requires a reason", async () => {
    expect((await call("PUT", `/v1/accommodation/rooms/${ids.room}/status`, admin, { status: "INACTIVE" })).statusCode).toBe(422);
    const res = await call("PUT", `/v1/accommodation/rooms/${ids.room}/status`, admin, { status: "BLOCKED", reason: "Repainting" });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toBe("Room 101 is now blocked.");
    await call("PUT", `/v1/accommodation/rooms/${ids.room}/status`, admin, { status: "ACTIVE" });
  });
});
