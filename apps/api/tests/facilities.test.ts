import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "@sam/core/lib/db";
import { buildApp } from "../src/app";
import { bearer, ensureUser, testOrg, tokenFor } from "./helpers";

let app: FastifyInstance;
const tokens: Record<string, string> = {};
const users: Record<string, string> = {};
const ids: Record<string, string> = {};
const code = `GYM-${Date.now().toString(36)}`;
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const call = (method: "GET" | "POST" | "PUT", url: string, who: string, payload?: object) => app.inject({ method, url, headers: bearer(tokens[who]), payload });
const openAllDays = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].flatMap((d) => [[`${d}_open`, "06:00"], [`${d}_close`, "22:00"]]));

beforeAll(async () => {
  app = await buildApp({ config: { sessionCacheTtlMs: 0 } });
  for (const [who, roles] of [["manager", ["FACILITY_MANAGER"]], ["officer", ["ACCOMMODATION_OFFICER"]], ["resident", ["STAFF"]], ["other", ["STAFF"]]] as const) {
    const u = await ensureUser(`fac-${who}@apitest.local`, [...roles]);
    users[who] = u.id;
    tokens[who] = await tokenFor(u.id);
  }
  const org = await testOrg();
  const site = await prisma.site.upsert({ where: { organizationId_code: { organizationId: org.id, code: "FAC-T" } }, update: {}, create: { organizationId: org.id, code: "FAC-T", name: "Facility API Site", timezone: "UTC" } });
  ids.site = site.id;
});

afterAll(async () => {
  await app.close();
});

describe("facilities API", () => {
  it("lets managers create and configure a facility; residents cannot", async () => {
    expect((await call("POST", "/v1/facilities", "resident", { siteId: ids.site, code, name: "Gym", capacity: 2 })).statusCode).toBe(403);
    const made = await call("POST", "/v1/facilities", "manager", { siteId: ids.site, code, name: "Gym", capacity: 2 });
    expect(made.statusCode).toBe(200);
    ids.facility = made.json().id;
    expect((await call("POST", "/v1/facilities", "manager", { siteId: ids.site, code, name: "Gym again", capacity: 2 })).statusCode).toBe(422);

    const bad = await call("PUT", `/v1/facilities/${ids.facility}`, "manager", { fields: { name: "Gym", capacity: "2", mon_open: "10:00", mon_close: "09:00" } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.fieldErrors.mon).toBeTruthy();
    const saved = await call("PUT", `/v1/facilities/${ids.facility}`, "manager", { fields: { name: "Gym", capacity: "2", status: "ACTIVE", ...openAllDays } });
    expect(saved.statusCode).toBe(200);
  });

  it("shows the operations views to staff and the resident views to everyone", async () => {
    expect((await call("GET", "/v1/facilities", "resident")).statusCode).toBe(403);
    const overview = (await call("GET", "/v1/facilities", "officer")).json();
    expect(overview.facilities.some((f: { id: string }) => f.id === ids.facility)).toBe(true);
    expect(overview.next24h).toBeTypeOf("object");
    const mine = (await call("GET", "/v1/facilities/mine", "resident")).json();
    expect(mine.facilities.some((f: { id: string }) => f.id === ids.facility)).toBe(true);
    const view = (await call("GET", `/v1/facilities/mine/${ids.facility}?date=${day(1)}`, "resident")).json();
    expect(view.slots.length).toBeGreaterThan(10);
    expect(view.date).toBe(day(1));
    expect((await call("GET", "/v1/facilities/mine/nope", "resident")).statusCode).toBe(404);
    const ops = (await call("GET", `/v1/facilities/${ids.facility}`, "officer")).json();
    expect(ops.users.length).toBeGreaterThan(0);
    expect((await call("GET", `/v1/facilities/${ids.facility}`, "manager")).json().bookings).toEqual([]);
  });

  it("books idempotently, stops people booking for others, and enforces capacity", async () => {
    const slot = { date: day(2), startTime: "10:00", durationMinutes: 60, headcount: 1 };
    const first = await call("POST", `/v1/facilities/${ids.facility}/bookings`, "resident", { ...slot, idempotencyKey: `k-${code}` });
    expect(first.statusCode).toBe(200);
    expect(first.json().booking.status).toBe("CONFIRMED");
    ids.booking = first.json().booking.id;
    const again = await call("POST", `/v1/facilities/${ids.facility}/bookings`, "resident", { ...slot, idempotencyKey: `k-${code}` });
    expect(again.json().duplicate).toBe(true);
    const forOther = await call("POST", `/v1/facilities/${ids.facility}/bookings`, "resident", { ...slot, userId: users.other });
    expect(forOther.statusCode).toBe(403);
    const onBehalf = await call("POST", `/v1/facilities/${ids.facility}/bookings`, "officer", { ...slot, userId: users.other });
    expect(onBehalf.statusCode).toBe(200);
    const third = await call("POST", `/v1/facilities/${ids.facility}/bookings`, "officer", { ...slot, userId: users.manager });
    expect(third.statusCode).toBe(409);
  });

  it("amends and cancels own bookings only", async () => {
    expect((await call("PUT", `/v1/facilities/bookings/${ids.booking}`, "other", { date: day(2), startTime: "12:00", durationMinutes: 60 })).statusCode).toBe(403);
    expect((await call("PUT", `/v1/facilities/bookings/${ids.booking}`, "resident", { date: day(2), startTime: "12:00", durationMinutes: 60 })).statusCode).toBe(200);
    expect((await call("POST", `/v1/facilities/bookings/${ids.booking}/cancel`, "other", {})).statusCode).toBe(403);
    expect((await call("POST", `/v1/facilities/bookings/${ids.booking}/cancel`, "resident", {})).statusCode).toBe(200);
    expect((await call("POST", `/v1/facilities/bookings/${ids.booking}/decision`, "resident", { approve: true })).statusCode).toBe(403);
    expect((await call("POST", `/v1/facilities/bookings/${ids.booking}/attendance`, "resident", { attended: true })).statusCode).toBe(403);
  });
});
