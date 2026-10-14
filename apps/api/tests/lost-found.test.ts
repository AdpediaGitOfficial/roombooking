import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "@sam/core/lib/db";
import { buildApp } from "../src/app";
import { bearer, ensureUser, testOrg, tokenFor } from "./helpers";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89]);

let app: FastifyInstance;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const tag = Date.now().toString(36);

const call = (method: "GET" | "POST" | "PUT", url: string, who: string, payload?: object) => app.inject({ method, url, headers: bearer(tokens[who]), payload });

function multipart(fields: Record<string, string>, photos: Buffer[] = []) {
  const boundary = "----lf" + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  photos.forEach((p, i) => parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photos"; filename="p${i}.png"\r\nContent-Type: image/png\r\n\r\n`), p, Buffer.from("\r\n")));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

beforeAll(async () => {
  app = await buildApp({ config: { sessionCacheTtlMs: 0 } });
  for (const [who, roles] of [["officer", ["ACCOMMODATION_OFFICER"]], ["admin", ["ACCOMMODATION_ADMIN"]], ["resident", ["STAFF"]], ["other", ["STAFF"]], ["auditor", ["AUDITOR"]]] as const) {
    tokens[who] = await tokenFor((await ensureUser(`lf-${who}@apitest.local`, [...roles])).id);
  }
  const org = await testOrg();
  const site = await prisma.site.upsert({ where: { organizationId_code: { organizationId: org.id, code: "LF-T" } }, update: {}, create: { organizationId: org.id, code: "LF-T", name: "Lost Found API Site" } });
  ids.site = site.id;
});

afterAll(async () => {
  await app.close();
});

describe("lost and found API", () => {
  it("registers an item with two photos and stores it when a location is given", async () => {
    const m = multipart({ siteId: ids.site, description: `Blue umbrella ${tag}`, category: "Other", foundAt: new Date(Date.now() - 3600_000).toISOString(), storageLocation: "Reception cupboard" }, [PNG, PNG]);
    const res = await app.inject({ method: "POST", url: "/v1/lost-found/items", headers: { ...bearer(tokens.officer), "content-type": m.contentType }, payload: m.payload });
    expect(res.statusCode, res.body).toBe(200);
    ids.item = res.json().id;
    expect(res.json().status).toBe("STORED");
    const detail = (await call("GET", `/v1/lost-found/items/${ids.item}`, "auditor")).json();
    expect(detail.photos).toHaveLength(2);
    expect(detail.item.reference).toMatch(/^LF-/);
  });

  it("rejects bad registrations with field errors and keeps residents out of the register", async () => {
    const bad = await call("POST", "/v1/lost-found/items", "officer", { siteId: ids.site, description: "", foundAt: "nonsense" });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.fieldErrors.description).toBeTruthy();
    expect((await call("GET", "/v1/lost-found", "resident")).statusCode).toBe(403);
    expect((await call("GET", `/v1/lost-found/items/${ids.item}`, "resident")).statusCode).toBe(403);
  });

  it("shows residents only the public view and lets them claim, with their own claim visible only to them", async () => {
    const browse = (await call("GET", `/v1/lost-found/mine?q=${tag}`, "resident")).json();
    expect(browse.items.map((i: { id: string }) => i.id)).toContain(ids.item);
    expect(JSON.stringify(browse.items)).not.toContain("Reception cupboard");

    const short = await call("POST", `/v1/lost-found/mine/${ids.item}/claim`, "resident", { evidence: "mine" });
    expect(short.statusCode).toBe(422);
    const claimed = await call("POST", `/v1/lost-found/mine/${ids.item}/claim`, "resident", { evidence: "It is a blue umbrella with a wooden handle and a tear on one panel." });
    expect(claimed.statusCode).toBe(200);
    ids.claim = claimed.json().id;
    const dup = await call("POST", `/v1/lost-found/mine/${ids.item}/claim`, "resident", { evidence: "Same umbrella, same description again please." });
    expect(dup.statusCode).toBe(409);

    const mine = (await call("GET", `/v1/lost-found/mine/${ids.item}`, "resident")).json();
    expect(mine.item.claims).toHaveLength(1);
    expect(mine.item.storageLocation).toBeUndefined();
    const other = (await call("GET", `/v1/lost-found/mine/${ids.item}`, "other")).json();
    expect(other.item.claims).toHaveLength(0);
    expect((await call("GET", "/v1/lost-found/mine/missing", "resident")).statusCode).toBe(404);
  });

  it("lets only the claimant or an operator withdraw, and operators verify and hand over", async () => {
    expect((await call("POST", `/v1/lost-found/claims/${ids.claim}/withdraw`, "other")).statusCode).toBe(403);
    expect((await call("POST", `/v1/lost-found/claims/${ids.claim}/decision`, "resident", { verified: true })).statusCode).toBe(403);
    const verified = await call("POST", `/v1/lost-found/claims/${ids.claim}/decision`, "officer", { verified: true, note: "ID checked" });
    expect(verified.statusCode).toBe(200);

    const m = multipart({ recipientName: "Lena Resident", note: "Collected with ID" });
    const handed = await app.inject({ method: "POST", url: `/v1/lost-found/items/${ids.item}/handover`, headers: { ...bearer(tokens.officer), "content-type": m.contentType }, payload: m.payload });
    expect(handed.statusCode, handed.body).toBe(200);
    const detail = (await call("GET", `/v1/lost-found/items/${ids.item}`, "officer")).json();
    expect(detail.item.status).toBe("RETURNED");
    expect(detail.item.events.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps disposal for administrators", async () => {
    const m = multipart({ siteId: ids.site, description: `Old scarf ${tag}`, foundAt: new Date(Date.now() - 7200_000).toISOString() });
    const res = await app.inject({ method: "POST", url: "/v1/lost-found/items", headers: { ...bearer(tokens.officer), "content-type": m.contentType }, payload: m.payload });
    const id = res.json().id;
    expect((await call("POST", `/v1/lost-found/items/${id}/dispose`, "officer", { method: "Recycled", note: "Expired" })).statusCode).toBe(403);
    const disposed = await call("POST", `/v1/lost-found/items/${id}/dispose`, "admin", { method: "Recycled", note: "Retention expired" });
    // Authorised, but the retention period has not passed for a brand-new item.
    expect(disposed.statusCode).toBe(409);
    expect(disposed.json().error.message).toMatch(/retention policy/);
    expect((await call("POST", `/v1/lost-found/items/${id}/dispose`, "admin", { method: "", note: "x" })).statusCode).toBe(422);
    expect((await call("GET", "/v1/lost-found?filter=all", "auditor")).json().summary).toHaveProperty("open");
  });
});
