import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "@sam/core/lib/db";
import { buildApp } from "../src/app";
import { bearer, ensureUser, testOrg, tokenFor } from "./helpers";

let app: FastifyInstance;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

const call = (method: "GET" | "POST", url: string, who: string, payload?: object) => app.inject({ method, url, headers: bearer(tokens[who]), payload });

beforeAll(async () => {
  app = await buildApp({ config: { sessionCacheTtlMs: 0 } });
  for (const [who, roles] of [["custodian", ["INVENTORY_KEY_CUSTODIAN"]], ["officer", ["ACCOMMODATION_OFFICER"]], ["staff", ["STAFF"]], ["auditor", ["AUDITOR"]]] as const) {
    tokens[who] = await tokenFor((await ensureUser(`key-${who}@apitest.local`, [...roles])).id);
  }
  const org = await testOrg();
  // Key history is append-only, so these fixtures are reused rather than recreated.
  const site = await prisma.site.upsert({ where: { organizationId_code: { organizationId: org.id, code: "KEY-T" } }, update: {}, create: { organizationId: org.id, code: "KEY-T", name: "Key API Site" } });
  const person = await prisma.staffProfile.upsert({ where: { organizationId_employeeId: { organizationId: org.id, employeeId: "KEY-1" } }, update: {}, create: { organizationId: org.id, employeeId: "KEY-1", firstName: "Kay", lastName: "Holder" } });
  Object.assign(ids, { site: site.id, person: person.id });
});

afterAll(async () => {
  await app.close();
});

describe("keys API", () => {
  it("separates viewing, operating and managing", async () => {
    expect((await call("GET", "/v1/keys", "staff")).statusCode).toBe(403);
    expect((await call("GET", "/v1/keys", "auditor")).statusCode).toBe(200);
    expect((await call("POST", "/v1/keys", "officer", { siteId: ids.site, code: "K-1" })).statusCode).toBe(403);
    expect((await call("GET", "/v1/keys/register-options", "officer")).statusCode).toBe(403);
    expect((await call("GET", "/v1/keys/register-options", "custodian")).statusCode).toBe(200);
  });

  it("registers a key and rejects a duplicate code at the same site", async () => {
    const code = `T-${Date.now().toString(36)}`;
    const made = await call("POST", "/v1/keys", "custodian", { siteId: ids.site, code, label: "Test key" });
    expect(made.statusCode).toBe(200);
    ids.key = made.json().id;
    ids.code = code;
    const dup = await call("POST", "/v1/keys", "custodian", { siteId: ids.site, code });
    expect(dup.statusCode).toBe(422);
    expect(dup.json().error.fieldErrors.code).toBeTruthy();
  });

  it("issues, blocks a second issue, and takes the key back", async () => {
    const issued = await call("POST", `/v1/keys/${ids.key}/issue`, "officer", { holderStaffId: ids.person });
    expect(issued.statusCode).toBe(200);
    const again = await call("POST", `/v1/keys/${ids.key}/issue`, "officer", { holderStaffId: ids.person });
    expect(again.statusCode).toBe(409);

    const detail = (await call("GET", `/v1/keys/${ids.key}`, "auditor")).json();
    expect(detail.status).toBe("ISSUED");
    expect(detail.transactions[0].holder.lastName).toBe("Holder");

    const held = await call("GET", "/v1/keys?filter=issued", "officer");
    expect(held.json().rows.rows.some((r: { key: { id: string } }) => r.key.id === ids.key)).toBe(true);

    expect((await call("POST", `/v1/keys/${ids.key}/return`, "officer", { condition: "Good" })).statusCode).toBe(200);
    expect((await call("GET", `/v1/keys/${ids.key}`, "officer")).json().status).toBe("AVAILABLE");
  });

  it("records exceptions only for managers and needs a description", async () => {
    expect((await call("POST", `/v1/keys/${ids.key}/exception`, "officer", { kind: "DAMAGED", notes: "bent" })).statusCode).toBe(403);
    const empty = await call("POST", `/v1/keys/${ids.key}/exception`, "custodian", { kind: "DAMAGED", notes: "" });
    expect(empty.statusCode).toBe(422);
    const damaged = await call("POST", `/v1/keys/${ids.key}/exception`, "custodian", { kind: "DAMAGED", notes: "Bent blade" });
    expect(damaged.json().message).toBe("Recorded as damaged.");
    expect((await call("GET", `/v1/keys/${ids.key}`, "officer")).json().status).toBe("DAMAGED");
    expect((await call("GET", "/v1/keys?filter=exceptions", "officer")).json().summary.exceptions).toBeGreaterThanOrEqual(1);
    expect((await call("GET", "/v1/keys/does-not-exist", "officer")).statusCode).toBe(404);
  });
});
