import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "../src/lib/db";
import type { ActorLike } from "../src/lib/permissions/actor";
import { EXCEPTION_GROUPS, REPORTS, exceptionReport, recordTimeline, reportCsv, runReport } from "../src/modules/reports/layers";
import { createAlert, createSubscription, evaluateAlerts, runSubscriptions, ScheduleError } from "../src/modules/reports/schedule";
import { PrivacyError, acceptConsent, buildDataExport, consentNeeded, decideDataRequest, executeDataRequest, proposeRetention, runRetention, submitDataRequest } from "../src/modules/privacy/service";
import { IntegrationError, createApiKey, createWebhook, deliverWebhooks, revokeApiKey, sign, syncHrms, systemHealth, verifyApiKey, verifySignature } from "../src/modules/integrations/service";
import { recordAudit } from "../src/lib/audit";

const stamp = Date.now().toString(36);
let orgId: string, siteId: string;
const A: Record<string, ActorLike> = {};
async function mk(key: string, roles: Role[], sets: string[] = []) {
  const u = await prisma.user.create({ data: { organizationId: orgId, email: `p6-${key}-${stamp}@example.com`, name: key, status: "ACTIVE", username: `p6_${key}_${stamp}` } });
  for (const role of roles) await prisma.roleAssignment.create({ data: { userId: u.id, role } });
  A[key] = { id: u.id, roles, grants: sets.map((capabilitySet) => ({ capabilitySet, userId: u.id })) };
  return u;
}
const range = () => ({ from: new Date(Date.now() - 30 * 86400000), to: new Date(Date.now() + 86400000) });

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } });
  orgId = org.id;
  siteId = (await prisma.site.create({ data: { organizationId: orgId, code: `P6${stamp}`.slice(0, 12), name: "P6 Site", timezone: "UTC" } })).id;
  await mk("sa", ["SYSTEM_ADMIN"]);
  await mk("sa2", ["SYSTEM_ADMIN"]);
  await mk("aa", ["ACCOMMODATION_ADMIN"], ["COMPLIANCE"]);
  await mk("officer", ["ACCOMMODATION_OFFICER"]);
  await mk("res", ["STAFF"]);
});
afterAll(async () => { await prisma.$disconnect(); });

describe("report layers", () => {
  it("runs every L2 and L3 report without error and states its as-of time", async () => {
    for (const def of REPORTS) {
      const r = await runReport(def.slug, { siteIds: [siteId], names: true }, range());
      expect(r, def.slug).not.toBeNull();
      expect(r!.asOf).toBeInstanceOf(Date);
      for (const row of r!.rows) expect(row.length, def.slug).toBe(r!.columns.length);
      expect(reportCsv(r!)).toContain(r!.columns[0]);
    }
    const unscoped = await runReport("occupancy", { siteIds: null, names: false }, range());
    expect(unscoped!.columns).toContain("Occupancy %");
  }, 120_000);

  it("shows exception reports, hiding Super Admin actions from an Accommodation Admin, and a record timeline", async () => {
    await recordAudit({ actorId: A.sa.id, action: "ELIGIBILITY_OVERRIDE", entityType: "Allocation", entityId: `E-${stamp}`, after: { reason: "sa did it" } });
    await recordAudit({ actorId: A.aa.id, action: "CLEARANCE_OVERRIDE", entityType: "Allocation", entityId: `E-${stamp}`, reason: "aa did it" });
    const full = await exceptionReport({ groupKey: "overrides", range: range(), excludeSuperAdmin: false });
    expect(full.rows.filter((r) => r.entityId === `E-${stamp}`)).toHaveLength(2);
    const aaView = await exceptionReport({ groupKey: "overrides", range: range(), excludeSuperAdmin: true });
    expect(aaView.rows.filter((r) => r.entityId === `E-${stamp}`).map((r) => r.reason)).toEqual(["aa did it"]);
    const t = await recordTimeline("Allocation", `E-${stamp}`);
    expect(t.map((x) => x.action)).toEqual(["ELIGIBILITY_OVERRIDE", "CLEARANCE_OVERRIDE"]);
    expect(t[0].reason).toBe("sa did it"); // taken from the change's reason
    expect(EXCEPTION_GROUPS.length).toBeGreaterThanOrEqual(8);
  });
});

describe("scheduled reports and alerts", () => {
  it("delivers a due report only to someone who may still see it", async () => {
    await expect(createSubscription(A.res, { report: "occupancy", frequency: "WEEKLY" })).rejects.toBeInstanceOf(ScheduleError);
    const sub = await createSubscription(A.aa, { report: "occupancy", frequency: "WEEKLY" });
    await prisma.reportSubscription.update({ where: { id: sub.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
    const before = await prisma.notification.count({ where: { recipientId: A.aa.id, event: "report.scheduled", channel: "IN_APP" } });
    await runSubscriptions();
    expect(await prisma.notification.count({ where: { recipientId: A.aa.id, event: "report.scheduled", channel: "IN_APP" } })).toBe(before + 1);
    // Role removed: the next run is skipped, not sent.
    await prisma.roleAssignment.deleteMany({ where: { userId: A.aa.id } });
    await prisma.reportSubscription.update({ where: { id: sub.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
    const r = await runSubscriptions();
    expect(r.skipped).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.count({ where: { recipientId: A.aa.id, event: "report.scheduled", channel: "IN_APP" } })).toBe(before + 1);
    await prisma.roleAssignment.create({ data: { userId: A.aa.id, role: "ACCOMMODATION_ADMIN" } });
  }, 60_000);

  it("fires a threshold alert once a day", async () => {
    const a = await createAlert(A.sa, { kpiKey: "beds_available", comparison: "ABOVE", threshold: -1 });
    expect(await evaluateAlerts()).toBeGreaterThanOrEqual(1);
    const n = await prisma.notification.count({ where: { recipientId: A.sa.id, event: "report.alert", channel: "IN_APP" } });
    expect(n).toBe(1);
    await evaluateAlerts();
    expect(await prisma.notification.count({ where: { recipientId: A.sa.id, event: "report.alert", channel: "IN_APP" } })).toBe(1);
    await prisma.reportAlert.update({ where: { id: a.id }, data: { active: false } });
  }, 60_000);
});

describe("privacy", () => {
  it("captures consent, runs the request -> Compliance -> Super Admin path, and erases personal data", async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: A.res.id } });
    expect(consentNeeded(u)).toBe(true);
    await acceptConsent(u.id);
    expect(consentNeeded(await prisma.user.findUniqueOrThrow({ where: { id: u.id } }))).toBe(false);
    const staff = await prisma.staffProfile.create({ data: { organizationId: orgId, employeeId: `P6-${stamp}`, firstName: "Erase", lastName: "Me", userId: u.id, phone: "0509998888", idNumber: "ID-ERASE", verificationStatus: "VERIFIED" } });
    const exp = await buildDataExport(u.id);
    expect(exp.profile?.idNumber).toBe("ID-ERASE");
    await expect(submitDataRequest(u.id, "ERASURE", "")).rejects.toBeInstanceOf(PrivacyError);
    const req = await submitDataRequest(u.id, "ERASURE", "Leaving the company");
    await expect(submitDataRequest(u.id, "ERASURE", "again")).rejects.toBeInstanceOf(PrivacyError);
    await expect(decideDataRequest(A.sa, req.id, true)).rejects.toBeInstanceOf(PrivacyError); // SA cannot approve: that is Compliance
    await expect(executeDataRequest(A.sa, req.id)).rejects.toBeInstanceOf(PrivacyError); // not approved yet
    await decideDataRequest(A.aa, req.id, true, "Verified identity");
    await executeDataRequest(A.sa, req.id);
    const after = await prisma.staffProfile.findUniqueOrThrow({ where: { id: staff.id } });
    expect(after.firstName).toBe("Erased");
    expect(after.phone).toBeNull();
    expect(after.idNumber).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).status).toBe("DEACTIVATED");
    expect((await prisma.dataRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("COMPLETED");
  });

  it("applies retention to old visitor records only after a second Super Admin approves the policy", async () => {
    const policyKey = "VISITORS";
    await prisma.retentionPolicy.deleteMany({ where: { organizationId: orgId } });
    const r = await proposeRetention(A.sa, orgId, { recordType: policyKey, retainDays: 90, action: "ANONYMISE", active: true });
    expect(["PENDING", "APPLIED"]).toContain(r.status);
    if (r.status === "PENDING") {
      const { decideChange } = await import("../src/modules/admin/change-requests");
      await decideChange({ changeRequestId: r.changeRequestId!, actorId: A.sa2.id, approve: true });
    }
    const old = await prisma.visitor.create({ data: { siteId, name: "Old Visitor", phone: "050", status: "CHECKED_OUT", createdAt: new Date(Date.now() - 200 * 86400000) } });
    const fresh = await prisma.visitor.create({ data: { siteId, name: "Fresh Visitor", status: "CHECKED_OUT" } });
    const out = await runRetention();
    expect(out.VISITORS).toBeGreaterThanOrEqual(1);
    expect((await prisma.visitor.findUniqueOrThrow({ where: { id: old.id } })).name).toBe("Erased");
    expect((await prisma.visitor.findUniqueOrThrow({ where: { id: fresh.id } })).name).toBe("Fresh Visitor");
    await expect(proposeRetention(A.officer, orgId, { recordType: policyKey, retainDays: 90, action: "DELETE", active: true })).rejects.toBeInstanceOf(PrivacyError);
    await expect(proposeRetention(A.sa, orgId, { recordType: policyKey, retainDays: 5, action: "DELETE", active: true })).rejects.toBeInstanceOf(PrivacyError);
  }, 60_000);
});

describe("integrations", () => {
  it("syncs HRMS records: creates, updates, rehires without duplicating, and cancels reservations on exit", async () => {
    const e1 = `H1-${stamp}`, e2 = `H2-${stamp}`;
    const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const first = await syncHrms(orgId, [{ employeeId: e1, firstName: "Hira", lastName: "One", department: "Ops", joiningDate: future }, { employeeId: e2, firstName: "Hari", lastName: "Two" }, { employeeId: "", firstName: "", lastName: "" }], { actorId: A.sa.id });
    expect(first).toMatchObject({ created: 2, failed: 1, joiners: 1 });
    const p1 = await prisma.staffProfile.findUniqueOrThrow({ where: { organizationId_employeeId: { organizationId: orgId, employeeId: e1 } } });
    expect(p1.source).toBe("HRMS");
    expect(p1.verificationStatus).toBe("VERIFIED");
    const second = await syncHrms(orgId, [{ employeeId: e1, firstName: "Hira", lastName: "Renamed", department: "Finance" }], { actorId: A.sa.id });
    expect(second).toMatchObject({ created: 0, updated: 1 });
    expect((await prisma.staffProfile.findUniqueOrThrow({ where: { id: p1.id } })).department).toBe("Finance");
    // Exit with a reservation that has not started.
    const b = await prisma.building.create({ data: { siteId, code: `HB${stamp}`.slice(0, 12), name: "HB" } });
    const room = await prisma.room.create({ data: { buildingId: b.id, code: "H-1" } });
    const bed = await prisma.bed.create({ data: { roomId: room.id, code: "H-1-1" } });
    const alloc = await prisma.allocation.create({ data: { staffId: p1.id, bedId: bed.id, startDate: new Date(Date.now() + 3 * 86400000), status: "CONFIRMED" } });
    const exit = await syncHrms(orgId, [{ employeeId: e1, firstName: "Hira", lastName: "Renamed", status: "EXITED", lastDay: future }], { actorId: A.sa.id });
    expect(exit.exits).toBe(1);
    expect((await prisma.allocation.findUniqueOrThrow({ where: { id: alloc.id } })).status).toBe("CANCELLED");
    expect(await prisma.exitCase.count({ where: { staffId: p1.id, source: "HRMS" } })).toBe(1);
    // Rehire: same employee ID comes back active; no second profile.
    await prisma.staffProfile.update({ where: { id: p1.id }, data: { archivedAt: new Date(), employmentStatus: "TERMINATED" } });
    const re = await syncHrms(orgId, [{ employeeId: e1, firstName: "Hira", lastName: "Renamed" }], { actorId: A.sa.id });
    expect(re.rehired).toBe(1);
    expect(await prisma.staffProfile.count({ where: { organizationId: orgId, employeeId: e1 } })).toBe(1);
    expect((await prisma.staffProfile.findUniqueOrThrow({ where: { id: p1.id } })).archivedAt).toBeNull();
  }, 60_000);

  it("issues API keys once, checks scope and revocation", async () => {
    await expect(createApiKey(A.officer, orgId, { name: "x", scopes: ["hrms.sync"] })).rejects.toBeInstanceOf(IntegrationError);
    const { key, token } = await createApiKey(A.sa, orgId, { name: `Key ${stamp}`, scopes: ["hrms.sync"] });
    expect(token.startsWith("sam_")).toBe(true);
    expect(JSON.stringify(key)).not.toContain(token);
    await verifyApiKey(token, "hrms.sync");
    await expect(verifyApiKey(token, "occupancy.read")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await revokeApiKey(A.sa, key.id);
    await expect(verifyApiKey(token, "hrms.sync")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("delivers signed webhook events with retry", async () => {
    process.env.ALLOW_INSECURE_WEBHOOKS = "true";
    await expect(createWebhook(A.sa, orgId, { url: "ftp://x", events: ["stay.checked_in"] })).rejects.toBeInstanceOf(IntegrationError);
    const { hook, secret } = await createWebhook(A.sa, orgId, { url: "http://hooks.test/in", events: ["sos.raised"] });
    await recordAudit({ actorId: A.sa.id, action: "SOS_RAISED", entityType: "SosAlert", entityId: `S-${stamp}`, after: { location: "Room 1" } });
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const ok = (async (url: string, init: RequestInit) => { calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) }); return new Response("ok", { status: 200 }); }) as unknown as typeof fetch;
    const r1 = await deliverWebhooks({ fetchImpl: ok });
    expect(r1.delivered).toBeGreaterThanOrEqual(1);
    const call = calls.find((c) => c.body.includes(`S-${stamp}`))!;
    expect(call.headers["x-sam-event"]).toBe("sos.raised");
    expect(verifySignature(secret, call.body, call.headers["x-sam-timestamp"], call.headers["x-sam-signature"])).toBe(true);
    expect(sign(secret, call.body, "1")).not.toBe(sign(secret, call.body, "2"));
    // A failing endpoint is retried later, not lost.
    await recordAudit({ actorId: A.sa.id, action: "SOS_RAISED", entityType: "SosAlert", entityId: `S2-${stamp}`, after: {} });
    const bad = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    const r2 = await deliverWebhooks({ fetchImpl: bad });
    expect(r2.failed).toBeGreaterThanOrEqual(1);
    const pending = await prisma.webhookDelivery.findFirst({ where: { webhookId: hook.id, deliveredAt: null } });
    expect(pending?.attempts).toBe(1);
    expect(pending?.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    await prisma.webhook.update({ where: { id: hook.id }, data: { active: false } });
  }, 60_000);

  it("reports system health", async () => {
    const h = await systemHealth(orgId);
    expect(h.checks.map((c) => c.name)).toContain("Notification delivery");
    expect(typeof h.ok).toBe("boolean");
  });
});
