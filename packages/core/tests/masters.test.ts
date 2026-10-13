import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "../src/lib/db";
import type { ActorLike } from "../src/lib/permissions/actor";
import { MasterError, acknowledgeHouseRule, listHouseRules, pendingHouseRules, publishHouseRule, saveMaster, saveTemplate, listTemplates } from "../src/modules/masters/service";
import { renderEmail } from "../src/modules/notifications/templates";
import { processOutbox } from "../src/modules/notifications/worker";
import { enqueueNotification } from "../src/lib/notifications";

const stamp = Date.now().toString(36);
let orgId: string;
const A: Record<string, ActorLike> = {};
async function mk(key: string, roles: Role[]) {
  const u = await prisma.user.create({ data: { organizationId: orgId, email: `ms-${key}-${stamp}@example.com`, name: `${key} User`, status: "ACTIVE", username: `ms_${key}_${stamp}` } });
  for (const role of roles) await prisma.roleAssignment.create({ data: { userId: u.id, role } });
  A[key] = { id: u.id, roles };
}
beforeAll(async () => {
  orgId = (await prisma.organization.upsert({ where: { code: "TEST" }, update: {}, create: { code: "TEST", name: "Test Org" } })).id;
  await mk("sa", ["SYSTEM_ADMIN"]); await mk("aa", ["ACCOMMODATION_ADMIN"]); await mk("res", ["STAFF"]);
});
afterAll(async () => { await prisma.$disconnect(); });

describe("masters", () => {
  it("lets an Admin manage masters, rejects duplicates and blocks HRMS-owned lists when the HRMS is on", async () => {
    const m = await saveMaster(A.sa, orgId, { kind: "ROOM_TYPE", code: `suite ${stamp}`, name: "Suite" });
    expect(m.code).toBe(`SUITE_${stamp.toUpperCase()}`);
    await expect(saveMaster(A.sa, orgId, { kind: "ROOM_TYPE", code: `suite ${stamp}`, name: "Suite again" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(saveMaster(A.res, orgId, { kind: "ROOM_TYPE", code: "X", name: "X" })).rejects.toBeInstanceOf(MasterError);
    await prisma.integrationConfig.upsert({ where: { organizationId_kind: { organizationId: orgId, kind: "HRMS" } }, update: { enabled: true }, create: { organizationId: orgId, kind: "HRMS", name: "HRMS", enabled: true } });
    await expect(saveMaster(A.sa, orgId, { kind: "DEPARTMENT", code: "ops", name: "Operations" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.integrationConfig.update({ where: { organizationId_kind: { organizationId: orgId, kind: "HRMS" } }, data: { enabled: false } });
    await saveMaster(A.sa, orgId, { kind: "DEPARTMENT", code: `ops${stamp}`, name: "Operations" });
  });
});

describe("house rules", () => {
  it("versions a rule and asks residents to acknowledge only the current version", async () => {
    const code = `QUIET_${stamp}`;
    const v1 = await publishHouseRule(A.aa, orgId, { code, title: "Quiet hours", body: "Quiet between 22:00 and 06:00 in all corridors." });
    expect(v1.version).toBe(1);
    expect((await pendingHouseRules(A.res.id, orgId)).some((r) => r.id === v1.id)).toBe(true);
    await acknowledgeHouseRule(A.res.id, v1.id);
    expect((await pendingHouseRules(A.res.id, orgId)).some((r) => r.id === v1.id)).toBe(false);
    const v2 = await publishHouseRule(A.aa, orgId, { code, title: "Quiet hours", body: "Quiet between 23:00 and 06:00 in all corridors and lounges." });
    expect(v2.version).toBe(2);
    const pending = await pendingHouseRules(A.res.id, orgId);
    expect(pending.some((r) => r.id === v2.id)).toBe(true);
    await expect(acknowledgeHouseRule(A.res.id, v1.id)).rejects.toBeInstanceOf(MasterError); // superseded
    await expect(publishHouseRule(A.res, orgId, { code: "X", title: "x", body: "y".repeat(30) })).rejects.toBeInstanceOf(MasterError);
    expect((await listHouseRules(orgId)).filter((r) => r.code === code.toUpperCase())).toHaveLength(2);
  });
});

describe("notification templates", () => {
  it("renders an edited template with merge fields and suppresses a switched-off event", async () => {
    const r = renderEmail("parcel.arrived", { carrier: "DHL" }, "Sam Resident", { subject: "Hi {{name}}: {{carrier}} parcel", body: "Collect your {{carrier}} parcel.\nBring ID." });
    expect(r.subject).toBe("Hi Sam: DHL parcel");
    expect(r.text).toContain("Bring ID.");
    await saveTemplate(A.sa, orgId, { event: "parcel.arrived", channel: "EMAIL", enabled: true, subject: "Parcel for you", body: "Collect it." });
    await expect(saveTemplate(A.aa, orgId, { event: "parcel.arrived", channel: "EMAIL", enabled: false })).rejects.toBeInstanceOf(MasterError);
    await expect(saveTemplate(A.sa, orgId, { event: "parcel.arrived", channel: "WHATSAPP", enabled: true, body: "x" })).rejects.toBeInstanceOf(MasterError);
    expect((await listTemplates(orgId)).find((t) => t.event === "parcel.arrived")!.channels[0].override?.subject).toBe("Parcel for you");
    // Switched off: the queued email is marked sent-as-suppressed, not delivered.
    await saveTemplate(A.sa, orgId, { event: "parcel.arrived", channel: "EMAIL", enabled: false });
    await prisma.$transaction((tx) => enqueueNotification(tx, { recipientId: A.res.id, event: "parcel.arrived", idempotencyKey: `tpl:${stamp}`, payload: { carrier: "DHL" } }));
    const sent: string[] = [];
    await processOutbox({ channels: ["EMAIL"], transport: { name: "test", description: "t", send: async (m: { subject: string }) => { sent.push(m.subject); return { messageId: "x" }; } } as never, limit: 5000 });
    expect(sent).not.toContain("Parcel for you");
    const n = await prisma.notification.findUniqueOrThrow({ where: { idempotencyKey: `tpl:${stamp}:email` } });
    expect(n.subject).toContain("switched off");
  }, 60_000);
});
