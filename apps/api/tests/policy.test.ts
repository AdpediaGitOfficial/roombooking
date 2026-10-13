import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { prisma } from "@sam/core/lib/db";
import { contract } from "@sam/contract/index";
import type { OpDef } from "@sam/contract/define";
import { buildApp } from "../src/app";
import { bearer, ensureUser, tokenFor } from "./helpers";

const ALL_ROLES: Role[] = ["SYSTEM_ADMIN", "ACCOMMODATION_ADMIN", "ACCOMMODATION_OFFICER", "STAFF", "APPROVER", "MAINTENANCE", "VENDOR", "INVENTORY_KEY_CUSTODIAN", "FACILITY_MANAGER", "AUDITOR"];

const ops = Object.values(contract).flatMap((m) => Object.values(m)) as OpDef[];
const concretePath = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, "x");

let app: FastifyInstance;
const tokens = new Map<Role, string>();

beforeAll(async () => {
  app = await buildApp({ config: { sessionCacheTtlMs: 0, rateLimitMax: 100000 } });
  await app.ready();
  for (const role of ALL_ROLES) {
    const user = await ensureUser(`policy-${role.toLowerCase()}@example.com`, [role]);
    tokens.set(role, await tokenFor(user.id));
  }
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("policy matrix over the whole contract", () => {
  it("has unique operation ids and Express-style paths under /v1", () => {
    const ids = ops.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of ops) expect(o.path.startsWith("/v1/")).toBe(true);
  });

  it("refuses every protected operation without a token", async () => {
    for (const def of ops.filter((o) => o.access !== "public")) {
      const res = await app.inject({ method: def.method, url: concretePath(def.path), payload: def.method === "GET" || def.method === "DELETE" ? undefined : {} });
      expect(res.statusCode, `${def.id} without a token`).toBe(401);
    }
  });

  it("refuses roles that are not listed for an operation", async () => {
    for (const def of ops) {
      if (!Array.isArray(def.access)) continue;
      const outsider = ALL_ROLES.find((r) => !(def.access as readonly Role[]).includes(r));
      if (!outsider) continue;
      const res = await app.inject({ method: def.method, url: concretePath(def.path), headers: bearer(tokens.get(outsider)!), payload: def.method === "GET" || def.method === "DELETE" ? undefined : {} });
      expect(res.statusCode, `${def.id} as ${outsider}`).toBe(403);
    }
  });

  it("lets every listed role past the policy check (it may then fail validation or lookup, never 401 or 403)", async () => {
    for (const def of ops) {
      if (!Array.isArray(def.access) || def.multipart) continue;
      for (const role of def.access as readonly Role[]) {
        const res = await app.inject({ method: def.method, url: concretePath(def.path), headers: bearer(tokens.get(role)!), payload: def.method === "GET" || def.method === "DELETE" ? undefined : {} });
        expect([401, 403], `${def.id} as ${role}`).not.toContain(res.statusCode);
      }
    }
  });

  it("never returns secret fields in any response", async () => {
    const admin = tokens.get("SYSTEM_ADMIN")!;
    for (const def of ops.filter((o) => o.method === "GET" && o.kind === "json" && !/:/.test(o.path))) {
      const res = await app.inject({ method: "GET", url: def.path, headers: bearer(admin) });
      if (res.statusCode === 200) expect(res.body, def.id).not.toMatch(/passwordHash|tokenHash|failedLoginAttempts/);
    }
  });
});
