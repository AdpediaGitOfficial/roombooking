import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "@sam/core/lib/db";
import { buildApp } from "../src/app";
import { bearer, ensureUser, tokenFor } from "./helpers";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89]);

let app: FastifyInstance;
const tokens: Record<string, string> = {};
const users: Record<string, string> = {};
const created: string[] = [];

const call = (method: "GET" | "POST", url: string, who: string, payload?: object) => app.inject({ method, url, headers: bearer(tokens[who]), payload });

function multipart(fields: Record<string, string>, photo?: Buffer) {
  const boundary = "----mnt" + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (photo) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="leak.png"\r\nContent-Type: image/png\r\n\r\n`), photo, Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

beforeAll(async () => {
  app = await buildApp({ config: { sessionCacheTtlMs: 0 } });
  for (const [who, roles] of [["resident", ["STAFF"]], ["other", ["STAFF"]], ["coord", ["ACCOMMODATION_OFFICER"]], ["eng", ["MAINTENANCE"]], ["auditor", ["AUDITOR"]]] as const) {
    const u = await ensureUser(`mnt-${who}@apitest.local`, [...roles]);
    users[who] = u.id;
    tokens[who] = await tokenFor(u.id);
  }
});

afterAll(async () => {
  for (const id of created) {
    const files = await prisma.attachment.findMany({ where: { entityType: "WorkOrder", entityId: id } });
    await prisma.attachment.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
    await prisma.workOrderNote.deleteMany({ where: { workOrderId: id } });
    await prisma.workOrder.delete({ where: { id } });
  }
  await app.close();
});

describe("maintenance API", () => {
  it("creates a ticket with a photo through multipart and serves it to people with access", async () => {
    const m = multipart({ category: "Plumbing", description: "Tap is leaking in the bathroom", priority: "HIGH", locationNote: "Staff block, bathroom" }, PNG);
    const res = await app.inject({ method: "POST", url: "/v1/maintenance/orders", headers: { ...bearer(tokens.resident), "content-type": m.contentType }, payload: m.payload });
    expect(res.statusCode, res.body).toBe(200);
    const wo = res.json();
    created.push(wo.id);
    expect(wo.ticketNumber).toMatch(/^MR-/);
    expect(wo.status).toBe("NEW");

    const mine = await call("GET", `/v1/maintenance/mine/${wo.id}`, "resident");
    expect(mine.statusCode).toBe(200);
    expect(mine.json().photos).toHaveLength(1);
    expect(mine.json().transitions).toEqual(["CANCELLED"]);

    const photo = await call("GET", `/v1/files/attachments/${mine.json().photos[0].id}`, "resident");
    expect(photo.statusCode).toBe(200);
    expect(photo.headers["content-type"]).toBe("image/png");
    expect((await call("GET", `/v1/files/attachments/${mine.json().photos[0].id}`, "other")).statusCode).toBe(404);
    expect((await call("GET", `/v1/files/attachments/${mine.json().photos[0].id}`, "coord")).statusCode).toBe(200);
  });

  it("returns field errors for a bad report", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/maintenance/orders", headers: bearer(tokens.resident), payload: { category: "Nonsense", description: "x" } });
    expect(res.statusCode).toBe(422);
    expect(Object.keys(res.json().error.fieldErrors).length).toBeGreaterThan(0);
  });

  it("keeps tickets private to their reporter and the operations team", async () => {
    const id = created[0];
    expect((await call("GET", `/v1/maintenance/mine/${id}`, "other")).statusCode).toBe(404);
    expect((await call("GET", `/v1/maintenance/mine/${id}`, "coord")).statusCode).toBe(404); // "mine" is strictly the reporter's view
    expect((await call("GET", `/v1/maintenance/orders/${id}`, "other")).statusCode).toBe(403);
    expect((await call("GET", `/v1/maintenance/orders/${id}`, "eng")).statusCode).toBe(404); // not assigned to them
    const ops = await call("GET", `/v1/maintenance/orders/${id}`, "coord");
    expect(ops.statusCode).toBe(200);
    expect(ops.json().access).toBe("coordinator");
    expect(ops.json().assignees.engineers.length).toBeGreaterThan(0);
    expect((await call("GET", `/v1/maintenance/orders/${id}`, "auditor")).json().access).toBe("auditor");
  });

  it("limits who can triage and assign, then lets the engineer work the ticket", async () => {
    const id = created[0];
    expect((await call("POST", `/v1/maintenance/orders/${id}/triage`, "resident", { priority: "URGENT" })).statusCode).toBe(403);
    expect((await call("POST", `/v1/maintenance/orders/${id}/assign`, "resident", { assigneeId: users.eng })).statusCode).toBe(403);
    const triage = await call("POST", `/v1/maintenance/orders/${id}/triage`, "coord", { priority: "URGENT" });
    expect(triage.statusCode).toBe(200);
    expect(triage.json().status).toBe("TRIAGED");
    expect((await call("POST", `/v1/maintenance/orders/${id}/assign`, "coord", {})).statusCode).toBe(422);
    expect((await call("POST", `/v1/maintenance/orders/${id}/assign`, "coord", { assigneeId: users.eng })).statusCode).toBe(200);

    const queue = await call("GET", "/v1/maintenance/queue?filter=mine", "eng");
    expect(queue.statusCode).toBe(200);
    expect(queue.json().orders.map((o: { id: string }) => o.id)).toContain(id);

    const started = await call("POST", `/v1/maintenance/orders/${id}/status`, "eng", { status: "IN_PROGRESS" });
    expect(started.statusCode).toBe(200);
    const bad = await call("POST", `/v1/maintenance/orders/${id}/status`, "resident", { status: "RESOLVED" });
    expect(bad.statusCode).toBe(409);
  });

  it("hides internal notes from the reporter", async () => {
    const id = created[0];
    const internal = multipart({ note: "Needs a new washer, part on order", internal: "true" });
    const r1 = await app.inject({ method: "POST", url: `/v1/maintenance/orders/${id}/notes`, headers: { ...bearer(tokens.coord), "content-type": internal.contentType }, payload: internal.payload });
    expect(r1.statusCode).toBe(200);
    const open = await call("POST", `/v1/maintenance/orders/${id}/notes`, "coord", { note: "We will visit tomorrow morning" });
    expect(open.statusCode).toBe(200);

    const mine = (await call("GET", `/v1/maintenance/mine/${id}`, "resident")).json();
    const texts = mine.notes.map((n: { note: string }) => n.note);
    expect(texts).toContain("We will visit tomorrow morning");
    expect(texts).not.toContain("Needs a new washer, part on order");
    const ops = (await call("GET", `/v1/maintenance/orders/${id}`, "coord")).json();
    expect(ops.notes.map((n: { note: string }) => n.note)).toContain("Needs a new washer, part on order");
  });

  it("lists a resident's own tickets only", async () => {
    const mine = await call("GET", "/v1/maintenance/mine", "resident");
    expect(mine.json().map((o: { id: string }) => o.id)).toContain(created[0]);
    expect((await call("GET", "/v1/maintenance/mine", "other")).json()).toEqual([]);
    expect((await call("GET", "/v1/maintenance/queue", "resident")).statusCode).toBe(403);
  });
});
