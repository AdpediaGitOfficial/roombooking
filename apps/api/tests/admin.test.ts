import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { prisma } from "@sam/core/lib/db";
import { buildApp } from "../src/app";
import { bearer, ensureUser, tokenFor } from "./helpers";

let app: FastifyInstance;
const tokens: Record<string, string> = {};
const users: Record<string, string> = {};
const ids: Record<string, string> = {};
const tag = Date.now().toString(36);

const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, who: string, payload?: object) => app.inject({ method, url, headers: bearer(tokens[who]), payload });

beforeAll(async () => {
  app = await buildApp({ config: { sessionCacheTtlMs: 0 } });
  for (const [who, roles] of [["sysadmin", ["SYSTEM_ADMIN"]], ["officer", ["ACCOMMODATION_OFFICER"]], ["resident", ["STAFF"]], ["auditor", ["AUDITOR"]]] as const) {
    const u = await ensureUser(`adm-${who}@apitest.local`, [...roles]);
    users[who] = u.id;
    tokens[who] = await tokenFor(u.id);
  }
});

afterAll(async () => {
  await app.close();
});

describe("user administration API", () => {
  it("limits user admin to system administrators, with the auditor read-only", async () => {
    expect((await call("GET", "/v1/admin/users", "resident")).statusCode).toBe(403);
    expect((await call("GET", "/v1/admin/users", "officer")).statusCode).toBe(403);
    expect((await call("GET", "/v1/admin/users", "auditor")).statusCode).toBe(200);
    expect((await call("POST", "/v1/admin/users", "auditor", { name: "X", email: `x-${tag}@apitest.local`, roles: [] })).statusCode).toBe(403);
  });

  it("pages long lists and bounds the page size", async () => {
    const one = (await call("GET", "/v1/admin/users?pageSize=1", "sysadmin")).json();
    expect(one.rows).toHaveLength(1);
    expect(one.total).toBeGreaterThan(1);
    expect(one.pages).toBe(one.total);
    const two = (await call("GET", "/v1/admin/users?pageSize=1&page=2", "sysadmin")).json();
    expect(two.rows[0].id).not.toBe(one.rows[0].id);
    expect((await call("GET", `/v1/admin/users?pageSize=1&page=${one.pages + 5}`, "sysadmin")).json().rows).toEqual([]);
    expect((await call("GET", "/v1/admin/users?pageSize=1000", "sysadmin")).statusCode).toBe(422);
    expect((await call("GET", "/v1/admin/users?page=0", "sysadmin")).statusCode).toBe(422);
  });

  it("creates an invited user, returns the invite path, and never exposes secrets", async () => {
    const bad = await call("POST", "/v1/admin/users", "sysadmin", { name: "", email: "nope", roles: [] });
    expect(bad.statusCode).toBe(422);
    const created = await call("POST", "/v1/admin/users", "sysadmin", { name: "Invited Person", email: `invited-${tag}@apitest.local`, roles: [{ role: "STAFF" }] });
    expect(created.statusCode, created.body).toBe(200);
    ids.user = created.json().id;
    expect(created.json().invitePath).toMatch(/^\/invite\//);

    const view = await call("GET", `/v1/admin/users/${ids.user}?invited=true`, "sysadmin");
    expect(view.statusCode).toBe(200);
    expect(view.json().inviteLink).toBe(created.json().invitePath);
    expect(view.json().hasPassword).toBe(false);
    expect(view.body).not.toContain("passwordHash");
    expect(view.body).not.toContain("tokenHash");
    expect((await call("GET", `/v1/admin/users/${ids.user}`, "sysadmin")).json().inviteLink).toBeNull();
  });

  it("grants and removes roles, changes status, and issues links", async () => {
    const added = await call("POST", `/v1/admin/users/${ids.user}/roles`, "sysadmin", { role: "ACCOMMODATION_OFFICER" });
    expect(added.statusCode).toBe(200);
    const detail = (await call("GET", `/v1/admin/users/${ids.user}`, "sysadmin")).json();
    const assignment = detail.user.roleAssignments.find((r: { role: string }) => r.role === "ACCOMMODATION_OFFICER");
    expect((await call("DELETE", `/v1/admin/users/${ids.user}/roles/${assignment.id}`, "sysadmin")).statusCode).toBe(204);

    const resend = await call("POST", `/v1/admin/users/${ids.user}/tokens`, "sysadmin", { purpose: "INVITE" });
    expect(resend.statusCode).toBe(200);
    expect((await call("POST", `/v1/admin/users/${ids.user}/tokens`, "sysadmin", { purpose: "RESET" })).statusCode).toBe(409);
    const suspended = await call("PUT", `/v1/admin/users/${ids.user}/status`, "sysadmin", { status: "SUSPENDED", reason: "Test" });
    expect(suspended.statusCode).toBe(200);
    const ended = await call("POST", `/v1/admin/users/${ids.user}/sessions/revoke`, "sysadmin");
    expect(ended.json().ended).toBe(0);
  });

  it("records the changes in the audit log, filtered by entity", async () => {
    const log = (await call("GET", `/v1/admin/audit?entityType=User&entityId=${ids.user}`, "auditor")).json();
    const actions = log.events.rows.map((e: { action: string }) => e.action);
    expect(actions, JSON.stringify(actions)).toEqual(expect.arrayContaining(["USER_CREATED", "USER_STATUS_CHANGED"]));
    expect(log.types).toContain("User");
    expect((await call("GET", "/v1/admin/audit", "officer")).statusCode).toBe(403);
  });
});

describe("broadcasts API", () => {
  it("previews, drafts, sends and delivers an announcement to the right people", async () => {
    expect((await call("GET", "/v1/broadcasts", "resident")).statusCode).toBe(403);
    const audience = { roles: ["STAFF"], siteIds: [], buildingIds: [] };
    const preview = await call("POST", "/v1/broadcasts/preview", "officer", { audience });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().count).toBeGreaterThan(0);

    const bad = await call("POST", "/v1/broadcasts", "officer", { title: "", body: "", audience });
    expect(bad.statusCode).toBe(422);
    const draft = await call("POST", "/v1/broadcasts", "officer", { title: `Water shut-off ${tag}`, body: "Water will be off from 9 to 11 on Friday.", audience: { roles: ["VENDOR"], siteIds: [], buildingIds: [] }, send: false });
    expect(draft.statusCode, draft.body).toBe(200);
    ids.broadcast = draft.json().id;
    const view = (await call("GET", `/v1/broadcasts/${ids.broadcast}`, "officer")).json();
    expect(view.broadcast.status).toBe("DRAFT");
    expect(view.options.roles.length).toBeGreaterThan(5);

    const sent = await call("POST", `/v1/broadcasts/${ids.broadcast}/send`, "officer");
    expect(sent.statusCode, sent.body).toBe(200);
    const after = (await call("GET", `/v1/broadcasts/${ids.broadcast}`, "officer")).json();
    expect(after.broadcast.status).toBe("SENT");
    expect((await call("POST", `/v1/broadcasts/${ids.broadcast}/cancel`, "officer")).statusCode).toBe(409);
    // The resident is not in the vendor audience, so they do not see it.
    expect((await call("GET", `/v1/me/announcements/${ids.broadcast}`, "resident")).statusCode).toBe(404);
  });
});

describe("notifications, imports and reports API", () => {
  it("shows the outbox to administrators and lets only system administrators act", async () => {
    expect((await call("GET", "/v1/admin/notifications", "officer")).statusCode).toBe(403);
    const view = await call("GET", "/v1/admin/notifications?channel=WHATSAPP", "auditor");
    expect(view.statusCode).toBe(200);
    expect(view.json().templates.length).toBeGreaterThan(0);
    expect(view.json().transport).toHaveProperty("name");
    expect((await call("POST", "/v1/admin/notifications/run", "auditor")).statusCode).toBe(403);
    expect((await call("POST", "/v1/admin/notifications/run", "sysadmin")).json()).toHaveProperty("claimed");
    expect((await call("POST", "/v1/admin/notifications/none/retry", "sysadmin")).json().queued).toBe(false);
  });

  it("previews, commits and exports a staff import", async () => {
    const csv = `employeeId,firstName,lastName,gender,department,company,phone,employmentStatus\nIMP-${tag},Imported,Person,,Ops,Acme,,ACTIVE\n`;
    const boundary = "----imp" + tag;
    const payload = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nstaff\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="staff.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}--\r\n`);
    expect((await app.inject({ method: "POST", url: "/v1/admin/imports", headers: { ...bearer(tokens.officer), "content-type": `multipart/form-data; boundary=${boundary}` }, payload })).statusCode).toBe(403);
    const preview = await app.inject({ method: "POST", url: "/v1/admin/imports", headers: { ...bearer(tokens.sysadmin), "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
    expect(preview.statusCode, preview.body).toBe(200);
    ids.batch = preview.json().id;
    expect(preview.json().summary.create).toBe(1);
    expect((await call("GET", `/v1/admin/imports/${ids.batch}`, "sysadmin")).json().rows[0].action).toBe("create");
    const committed = await call("POST", `/v1/admin/imports/${ids.batch}/commit`, "sysadmin", {});
    expect(committed.statusCode, committed.body).toBe(200);
    expect((await call("POST", `/v1/admin/imports/${ids.batch}/commit`, "sysadmin", {})).statusCode).toBe(409);
    const exported = await call("GET", "/v1/admin/imports/export/staff", "sysadmin");
    expect(exported.statusCode).toBe(200);
    expect(exported.body).toContain(`IMP-${tag}`);
    expect((await call("GET", "/v1/admin/imports/export/staff?template=true", "sysadmin")).body).toContain("E2001");
    await prisma.staffProfile.deleteMany({ where: { employeeId: `IMP-${tag}` } });
  });

  it("serves reports to report roles only, with masked names for auditors", async () => {
    expect((await call("GET", "/v1/reports/overview", "resident")).statusCode).toBe(403);
    for (const path of ["overview", "dashboard", "movements", "maintenance", "facilities", "keys"]) {
      expect((await call("GET", `/v1/reports/${path}`, "officer")).statusCode, path).toBe(200);
    }
    expect((await call("GET", "/v1/reports/movements", "officer")).json().canSeeNames).toBe(true);
    expect((await call("GET", "/v1/reports/movements", "auditor")).json().canSeeNames).toBe(false);
    expect((await call("GET", "/v1/reports/movements?from=2026-01-01&to=2025-01-01", "officer")).json().range).toEqual({ from: "2026-01-01", to: "2026-01-01" });
    const csv = await call("GET", "/v1/reports/maintenance.csv", "officer");
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain("maintenance-");
  });
});

describe("raw endpoints", () => {
  it("answers the WhatsApp handshake only with the right token and checks signatures", async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
    process.env.WHATSAPP_APP_SECRET = "s3cret";
    expect((await app.inject({ method: "GET", url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc" })).statusCode).toBe(403);
    const ok = await app.inject({ method: "GET", url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc" });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("abc");

    const body = JSON.stringify({ entry: [] });
    const bad = await app.inject({ method: "POST", url: "/webhooks/whatsapp", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" }, payload: body });
    expect(bad.statusCode).toBe(401);
    const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
    const good = await app.inject({ method: "POST", url: "/webhooks/whatsapp", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, payload: body });
    expect(good.statusCode).toBe(200);
  });

  it("runs scheduled jobs only with the shared secret", async () => {
    process.env.JOBS_SECRET = "job-secret";
    expect((await app.inject({ method: "POST", url: "/jobs/run" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/jobs/run", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/jobs/run", headers: { authorization: "Bearer job-secret" } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toHaveProperty("bookings");
    expect(ok.json()).toHaveProperty("requests");
  });
});
