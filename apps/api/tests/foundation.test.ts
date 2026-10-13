import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { MaintenanceError } from "@sam/core/modules/maintenance/errors";
import { prisma } from "@sam/core/lib/db";
import { fileInput, fileOp, int, op, out, type Contract } from "@sam/contract/define";
import { createClient, ApiError, contract as realContract } from "@sam/contract/index";
import { buildApp } from "../src/app";
import { TtlCache } from "../src/session-cache";
import { PASSWORD, bearer, ensureUser, tokenFor } from "./helpers";

// A small contract that exercises the engine: roles, validation, errors, uploads, downloads, limits.
const testContract = {
  t: {
    adminOnly: op({ id: "t.adminOnly", method: "GET", path: "/v1/t/admin", summary: "admin", tag: "Test", access: ["SYSTEM_ADMIN"], input: z.object({}), output: out<{ ok: true }>() }),
    echo: op({ id: "t.echo", method: "GET", path: "/v1/t/echo/:id", summary: "echo", tag: "Test", input: z.object({ id: z.string(), n: int({ min: 1, max: 10 }), flag: z.union([z.boolean(), z.stringbool()]).default(false) }), output: out<{ id: string; n: number; flag: boolean; at: Date }>() }),
    fail: op({ id: "t.fail", method: "POST", path: "/v1/t/fail/:kind", summary: "fail", tag: "Test", input: z.object({ kind: z.string() }), output: out<{ ok: true }>() }),
    upload: op({ id: "t.upload", method: "POST", path: "/v1/t/upload", summary: "upload", tag: "Test", multipart: true, input: z.object({ note: z.string(), photo: fileInput.optional() }), output: out<{ note: string; bytes: number; name: string | null }>() }),
    download: fileOp({ id: "t.download", method: "GET", path: "/v1/t/download", summary: "download", tag: "Test", input: z.object({}) }),
    limited: op({ id: "t.limited", method: "GET", path: "/v1/t/limited", summary: "limited", tag: "Test", access: "public", rateLimit: { max: 2, windowSeconds: 60 }, input: z.object({}), output: out<{ ok: true }>() }),
  },
} satisfies Contract;

const testHandlers = {
  t: {
    adminOnly: () => ({ ok: true as const }),
    echo: (_ctx: unknown, input: { id: string; n: number; flag: boolean }) => ({ id: input.id, n: input.n, flag: input.flag, at: new Date("2026-10-13T08:00:00.000Z") }),
    fail: (_ctx: unknown, input: { kind: string }) => {
      if (input.kind === "missing") throw new MaintenanceError("NOT_FOUND", "Ticket not found.");
      if (input.kind === "transition") throw new MaintenanceError("INVALID_TRANSITION", "Cannot move from CLOSED to NEW.");
      if (input.kind === "validation") throw new MaintenanceError("VALIDATION", "Fix the fields.", { category: "Choose a category." });
      throw new Error("boom");
    },
    upload: (_ctx: unknown, input: { note: string; photo?: { bytes: Uint8Array; fileName: string } }) => ({ note: input.note, bytes: input.photo?.bytes.length ?? 0, name: input.photo?.fileName ?? null }),
    download: () => ({ body: new Uint8Array([1, 2, 3]), contentType: "text/csv", fileName: "report.csv" }),
    limited: () => ({ ok: true as const }),
  },
};

let app: FastifyInstance;
let admin: { id: string; token: string };
let staff: { id: string; token: string };

beforeAll(async () => {
  app = await buildApp({ config: { sessionCacheTtlMs: 0 }, extraOps: { contract: testContract, handlers: testHandlers } });
  await app.ready();
  const a = await ensureUser("api-admin@example.com", ["SYSTEM_ADMIN"]);
  const s = await ensureUser("api-staff@example.com", ["STAFF"]);
  admin = { id: a.id, token: await tokenFor(a.id) };
  staff = { id: s.id, token: await tokenFor(s.id) };
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("operational endpoints", () => {
  it("answers liveness and readiness without a token", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).json().status).toBe("ok");
    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: "ready", database: "up" });
  });

  it("publishes an OpenAPI document generated from the contract", async () => {
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    const doc = res.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/v1/auth/login"].post.operationId).toBe("auth.login");
    expect(doc.paths["/v1/auth/login"].post.security).toEqual([]);
    expect(doc.paths["/v1/auth/me"].get.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths["/v1/t/echo/{id}"].get.parameters.map((p: { name: string }) => p.name).sort()).toEqual(["flag", "id", "n"]);
    expect(doc.paths["/v1/t/admin"].get.description).toContain("SYSTEM_ADMIN");
  });

  it("serves metrics with request counts by operation", async () => {
    await app.inject({ method: "GET", url: "/v1/auth/me" });
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("http_request_duration_seconds");
    expect(res.body).toContain('op="auth.me"');
  });

  it("sets a request id on every response and reports unknown paths", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/nothing" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["x-request-id"]).toBeTruthy();
    expect(res.json().error.code).toBe("NOT_FOUND");
  });
});

describe("authentication", () => {
  it("signs in and returns a token and a user without secrets", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "API-staff@example.com", password: PASSWORD } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toHaveLength(43);
    expect(body.user.email).toBe("api-staff@example.com");
    expect(body.user.roleAssignments.map((r: { role: string }) => r.role)).toEqual(["STAFF"]);
    expect(JSON.stringify(body)).not.toMatch(/passwordHash|tokenHash|failedLoginAttempts/);
  });

  it("rejects a wrong password and an unknown email with the same answer", async () => {
    const bad = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "api-staff@example.com", password: "nope" } });
    const unknown = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "nobody@example.com", password: "nope" } });
    expect(bad.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(bad.json().error.message).toBe(unknown.json().error.message);
  });

  it("asks for both fields", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "", password: "" } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION");
  });

  it("locks the account after repeated failures", async () => {
    await ensureUser("api-lock@example.com", ["STAFF"]);
    let last = 0;
    for (let i = 0; i < 5; i++) last = (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "api-lock@example.com", password: "wrong" } })).statusCode;
    expect(last).toBe(401);
    const locked = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "api-lock@example.com", password: PASSWORD } });
    expect(locked.statusCode).toBe(423);
    expect(locked.json().error.code).toBe("LOCKED");
  });

  it("returns the current user and rejects missing or unknown tokens", async () => {
    const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: bearer(staff.token) });
    expect(me.statusCode).toBe(200);
    expect(me.json().id).toBe(staff.id);
    expect((await app.inject({ method: "GET", url: "/v1/auth/me" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/auth/me", headers: bearer("not-a-token") })).statusCode).toBe(401);
  });

  it("ends the session on sign-out", async () => {
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "api-staff@example.com", password: PASSWORD } });
    const token = login.json().token as string;
    expect((await app.inject({ method: "GET", url: "/v1/auth/me", headers: bearer(token) })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/v1/auth/logout", headers: bearer(token), payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/auth/me", headers: bearer(token) })).statusCode).toBe(401);
  });

  it("stops accepting a deactivated user's token", async () => {
    const u = await ensureUser("api-deactivated@example.com", ["STAFF"]);
    const token = await tokenFor(u.id);
    expect((await app.inject({ method: "GET", url: "/v1/auth/me", headers: bearer(token) })).statusCode).toBe(200);
    await prisma.user.update({ where: { id: u.id }, data: { status: "SUSPENDED" } });
    expect((await app.inject({ method: "GET", url: "/v1/auth/me", headers: bearer(token) })).statusCode).toBe(401);
  });
});

describe("role policy", () => {
  it("allows a listed role and refuses everyone else", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/t/admin", headers: bearer(admin.token) })).statusCode).toBe(200);
    const denied = await app.inject({ method: "GET", url: "/v1/t/admin", headers: bearer(staff.token) });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("FORBIDDEN");
    expect((await app.inject({ method: "GET", url: "/v1/t/admin" })).statusCode).toBe(401);
  });
});

describe("validation and errors", () => {
  it("coerces path and query values and returns typed results", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/t/echo/abc?n=7&flag=true", headers: bearer(staff.token) });
    expect(res.json()).toEqual({ id: "abc", n: 7, flag: true, at: "2026-10-13T08:00:00.000Z" });
  });

  it("names the invalid fields", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/t/echo/abc?n=99", headers: bearer(staff.token) });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.fieldErrors.n).toBeTruthy();
  });

  it("maps domain errors to statuses and keeps field errors", async () => {
    const h = bearer(staff.token);
    expect((await app.inject({ method: "POST", url: "/v1/t/fail/missing", headers: h, payload: {} })).statusCode).toBe(404);
    const transition = await app.inject({ method: "POST", url: "/v1/t/fail/transition", headers: h, payload: {} });
    expect(transition.statusCode).toBe(409);
    expect(transition.json().error.code).toBe("INVALID_TRANSITION");
    const validation = await app.inject({ method: "POST", url: "/v1/t/fail/validation", headers: h, payload: {} });
    expect(validation.statusCode).toBe(422);
    expect(validation.json().error.fieldErrors).toEqual({ category: "Choose a category." });
  });

  it("hides the details of unexpected failures", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/t/fail/other", headers: bearer(staff.token), payload: {} });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("INTERNAL");
    expect(res.body).not.toContain("boom");
    expect(res.json().error.requestId).toBeTruthy();
  });
});

describe("uploads, downloads and limits", () => {
  it("reads multipart fields and a file", async () => {
    const boundary = "----testboundary";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nhello\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="pic.png"\r\nContent-Type: image/png\r\n\r\n`),
      Buffer.from([1, 2, 3, 4, 5]),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({ method: "POST", url: "/v1/t/upload", headers: { ...bearer(staff.token), "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
    expect(res.json()).toEqual({ note: "hello", bytes: 5, name: "pic.png" });
  });

  it("refuses files over the size limit", async () => {
    const small = await buildApp({ config: { maxUploadBytes: 4, sessionCacheTtlMs: 0 }, extraOps: { contract: testContract, handlers: testHandlers } });
    const boundary = "----b2";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nx\r\n--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="big.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.alloc(64, 1),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await small.inject({ method: "POST", url: "/v1/t/upload", headers: { ...bearer(staff.token), "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
    expect(res.statusCode).toBe(413);
    await small.close();
  });

  it("returns bytes with download headers", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/t/download", headers: bearer(staff.token) });
    expect(res.headers["content-type"]).toBe("text/csv");
    expect(res.headers["content-disposition"]).toContain('filename="report.csv"');
    expect([...res.rawPayload]).toEqual([1, 2, 3]);
  });

  it("limits calls per operation", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await app.inject({ method: "GET", url: "/v1/t/limited" })).statusCode);
    expect(codes).toEqual([200, 200, 429, 429]);
  });
});

describe("session cache", () => {
  it("expires entries and evicts when full", () => {
    const cache = new TtlCache<number>(1000, 2);
    cache.set("a", 1, 0);
    cache.set("b", 2, 0);
    expect(cache.get("a", 500)).toBe(1);
    expect(cache.get("a", 1500)).toBeUndefined();
    cache.set("c", 3, 100);
    cache.set("d", 4, 100);
    expect(cache.size).toBeLessThanOrEqual(2);
  });

  it("serves a cached session without asking the database again", async () => {
    const cached = await buildApp({ config: { sessionCacheTtlMs: 60000 } });
    const u = await ensureUser("api-cache@example.com", ["STAFF"]);
    const token = await tokenFor(u.id);
    expect((await cached.inject({ method: "GET", url: "/v1/auth/me", headers: bearer(token) })).statusCode).toBe(200);
    await prisma.user.update({ where: { id: u.id }, data: { status: "SUSPENDED" } });
    // Within the TTL this instance still answers from its cache; a fresh instance would refuse.
    expect((await cached.inject({ method: "GET", url: "/v1/auth/me", headers: bearer(token) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/auth/me", headers: bearer(token) })).statusCode).toBe(401);
    await cached.close();
  });
});

describe("typed client", () => {
  it("signs in, calls an operation with revived dates, and raises ApiError", async () => {
    const live = await buildApp();
    await live.listen({ port: 0, host: "127.0.0.1" });
    const address = live.server.address();
    const baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    let token: string | undefined;
    const api = createClient(realContract, { baseUrl, token: () => token });

    await expect(api.auth.me()).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    const session = await api.auth.login({ email: "api-staff@example.com", password: PASSWORD });
    expect(session.expiresAt).toBeInstanceOf(Date);
    token = session.token;
    const me = await api.auth.me();
    expect(me.email).toBe("api-staff@example.com");
    expect(me.lastLoginAt === null || me.lastLoginAt instanceof Date).toBe(true);
    await api.auth.logout();
    await expect(api.auth.me()).rejects.toBeInstanceOf(ApiError);
    await live.close();
  });
});
