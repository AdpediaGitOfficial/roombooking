import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { bearer, ensureUser, tokenFor } from "./helpers";

let app: FastifyInstance;
const tokens: Record<string, string> = {};
const users: Record<string, string> = {};
const ids: Record<string, string> = {};
const code = `API_T_${Date.now().toString(36).toUpperCase()}`;

const call = (method: "GET" | "POST" | "PUT", url: string, who: string, payload?: object) => app.inject({ method, url, headers: bearer(tokens[who]), payload });

beforeAll(async () => {
  app = await buildApp({ config: { sessionCacheTtlMs: 0 } });
  for (const [who, roles] of [["admin", ["ACCOMMODATION_ADMIN"]], ["officer", ["ACCOMMODATION_OFFICER"]], ["resident", ["STAFF"]], ["other", ["STAFF"]], ["auditor", ["AUDITOR"]]] as const) {
    const u = await ensureUser(`req-${who}@apitest.local`, [...roles]);
    users[who] = u.id;
    tokens[who] = await tokenFor(u.id);
  }
});

afterAll(async () => {
  // Types cannot be deleted once used; deactivate so the test type stops appearing for residents.
  if (ids.type) await call("PUT", `/v1/admin/forms/${ids.type}`, "admin", { name: "API test request", status: "INACTIVE" });
  await app.close();
});

describe("form builder API", () => {
  it("is for administrators only", async () => {
    expect((await call("GET", "/v1/admin/forms", "resident")).statusCode).toBe(403);
    expect((await call("GET", "/v1/admin/forms", "officer")).statusCode).toBe(403);
    expect((await call("GET", "/v1/admin/forms", "admin")).statusCode).toBe(200);
  });

  it("creates a type, validates the draft, and publishes a form with a one-step route", async () => {
    const bad = await call("POST", "/v1/admin/forms", "admin", { code: "bad code!", name: "" });
    expect(bad.statusCode).toBe(422);
    const made = await call("POST", "/v1/admin/forms", "admin", { code, name: "API test request", description: "Created by a test" });
    expect(made.statusCode).toBe(200);
    ids.type = made.json().id;

    const type = (await call("GET", `/v1/admin/forms/${ids.type}`, "admin")).json();
    ids.version = type.versions[0].id;
    const invalid = await call("PUT", `/v1/admin/forms/versions/${ids.version}`, "admin", { schema: { fields: [{ name: "Bad Name", label: "", type: "text" }] }, steps: [] });
    expect(invalid.statusCode).toBe(422);

    const published = await call("PUT", `/v1/admin/forms/versions/${ids.version}`, "admin", {
      schema: { fields: [{ name: "reason", label: "Reason", type: "textarea", required: true, maxLength: 200 }] },
      steps: [{ name: "Reception check", approverRole: "ACCOMMODATION_OFFICER", requireComment: false }],
      changeNote: "First version",
      publish: true,
    });
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json().published).toBe(true);
  });
});

describe("requests and approvals API", () => {
  it("lists the published type and its form for residents", async () => {
    const types = (await call("GET", "/v1/requests/types", "resident")).json();
    expect(types.some((t: { code: string }) => t.code === code)).toBe(true);
    const form = await call("GET", `/v1/requests/types/${code}/form`, "resident");
    expect(form.statusCode).toBe(200);
    expect(form.json().fields[0].name).toBe("reason");
    expect(form.json().steps).toHaveLength(1);
    expect((await call("GET", "/v1/requests/types/NO_SUCH_TYPE/form", "resident")).statusCode).toBe(404);
  });

  it("validates a submission, accepts a good one, and treats a repeat as the same request", async () => {
    const key = `key-${code}`;
    const bad = await call("POST", "/v1/requests", "resident", { typeCode: code, idempotencyKey: key, fields: { reason: "" } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.fieldErrors.reason).toBeTruthy();
    const ok = await call("POST", "/v1/requests", "resident", { typeCode: code, idempotencyKey: key, fields: { reason: "Need a quieter room" } });
    expect(ok.statusCode).toBe(200);
    ids.request = ok.json().request.id;
    expect(ok.json().request.status).toBe("PENDING_APPROVAL");
    const again = await call("POST", "/v1/requests", "resident", { typeCode: code, idempotencyKey: key, fields: { reason: "Need a quieter room" } });
    expect(again.json().request.id).toBe(ids.request);
  });

  it("keeps requests private to their owner", async () => {
    const mine = (await call("GET", "/v1/requests/mine", "resident")).json();
    expect(mine.map((r: { id: string }) => r.id)).toContain(ids.request);
    expect((await call("GET", `/v1/requests/mine/${ids.request}`, "resident")).statusCode).toBe(200);
    expect((await call("GET", `/v1/requests/mine/${ids.request}`, "other")).statusCode).toBe(404);
    expect((await call("GET", "/v1/approvals", "resident")).statusCode).toBe(403);
    expect((await call("GET", `/v1/approvals/${ids.request}`, "resident")).statusCode).toBe(403);
  });

  it("puts the request in the approver's inbox, and not in anyone else's", async () => {
    const inbox = (await call("GET", "/v1/approvals", "officer")).json();
    expect(inbox.requests.map((r: { id: string }) => r.id)).toContain(ids.request);
    expect(inbox.isAdmin).toBe(false);
    // Only administrators can browse other lists; a filter from anyone else falls back to the inbox.
    expect((await call("GET", "/v1/approvals?filter=all", "officer")).json().filter).toBe("inbox");
    const adminAll = (await call("GET", "/v1/approvals?filter=pending", "admin")).json();
    expect(adminAll.filter).toBe("pending");
    expect(adminAll.requests.map((r: { id: string }) => r.id)).toContain(ids.request);

    const view = (await call("GET", `/v1/approvals/${ids.request}`, "officer")).json();
    expect(view.decision.ok).toBe(true);
    expect(view.step.name).toBe("Reception check");
    const auditorView = (await call("GET", `/v1/approvals/${ids.request}`, "auditor"));
    expect(auditorView.statusCode).toBe(404);
  });

  it("returns for changes with a comment, lets the resident correct it, then approves", async () => {
    const noComment = await call("POST", `/v1/approvals/${ids.request}/decision`, "officer", { action: "REQUEST_CHANGES" });
    expect(noComment.statusCode).toBe(422);
    const returned = await call("POST", `/v1/approvals/${ids.request}/decision`, "officer", { action: "REQUEST_CHANGES", comment: "Please say which floor" });
    expect(returned.statusCode, returned.body).toBe(200);

    const mine = (await call("GET", `/v1/requests/mine/${ids.request}`, "resident")).json();
    expect(mine.request.status).toBe("CHANGES_REQUESTED");
    expect(mine.fields.length).toBe(1);
    const resent = await call("POST", `/v1/requests/${ids.request}/resubmit`, "resident", { fields: { reason: "Need a quieter room on a higher floor" } });
    expect(resent.statusCode, resent.body).toBe(200);

    const approved = await call("POST", `/v1/approvals/${ids.request}/decision`, "officer", { action: "APPROVE" });
    expect(approved.statusCode, approved.body).toBe(200);
    const after = (await call("GET", `/v1/requests/mine/${ids.request}`, "resident")).json();
    expect(["APPROVED", "FULFILLED"]).toContain(after.request.status);
    expect(after.request.decisions.length).toBeGreaterThanOrEqual(2);
  });

  it("stops an approver deciding their own request", async () => {
    const own = await call("POST", "/v1/requests", "officer", { typeCode: code, idempotencyKey: `own-${code}`, fields: { reason: "For myself" } });
    expect(own.statusCode).toBe(200);
    const res = await call("POST", `/v1/approvals/${own.json().request.id}/decision`, "officer", { action: "APPROVE" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("SELF_APPROVAL");
    // The owner can withdraw it, which closes it.
    expect((await call("POST", `/v1/requests/${own.json().request.id}/withdraw`, "officer", { reason: "Changed my mind" })).statusCode).toBe(200);
  });
});

describe("delegations API", () => {
  it("lets an approver arrange and end cover, and rejects bad dates", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    expect((await call("GET", "/v1/delegations", "resident")).statusCode).toBe(403);
    const view = (await call("GET", "/v1/delegations", "officer")).json();
    expect(view.myRoles).toContain("ACCOMMODATION_OFFICER");
    expect(view.delegators).toBeNull();
    const bad = await call("POST", "/v1/delegations", "officer", { delegateId: users.admin, startsAt: tomorrow, endsAt: today });
    expect(bad.statusCode).toBe(422);
    const self = await call("POST", "/v1/delegations", "officer", { delegateId: users.officer, startsAt: today, endsAt: tomorrow });
    expect(self.statusCode).toBe(422);
    const made = await call("POST", "/v1/delegations", "officer", { delegateId: users.admin, startsAt: today, endsAt: tomorrow, reason: "Annual leave" });
    expect(made.statusCode, made.body).toBe(200);

    const rows = (await call("GET", "/v1/delegations", "officer")).json().rows;
    const mine = rows.find((r: { id: string }) => r.id === made.json().id);
    expect(mine.live).toBe(true);
    expect((await call("POST", `/v1/delegations/${made.json().id}/revoke`, "auditor", {})).statusCode).toBe(403);
    expect((await call("POST", `/v1/delegations/${made.json().id}/revoke`, "officer", { reason: "Back early" })).statusCode).toBe(200);
  });
});
