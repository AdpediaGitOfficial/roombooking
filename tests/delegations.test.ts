import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { RequestError } from "@/modules/requests/errors";
import { coveredRoles, createDelegation, delegatedRolesFor, isLive, listDelegations, revokeDelegation } from "@/modules/requests/delegations";
import { canDecide, decideRequest, getRequest, listInbox, submitRequest, withDelegations } from "@/modules/requests/service";

const stamp = Date.now().toString(36).toUpperCase();
let orgId: string; let admin: string; let manager: string; let cover: string; let resident: string; let other: string;
const plus = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const actor = (id: string, roles: Parameters<typeof canDecide>[1]["roles"]) => ({ id, roles });

async function expectError<T>(p: Promise<T>, code: string) {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(RequestError); expect((e as RequestError).code).toBe(code); return e as RequestError; }
  throw new Error(`expected RequestError ${code}`);
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { code: `DL-${stamp}`, name: "Delegation Org" } });
  orgId = org.id;
  const mk = async (name: string, roles: Array<"SYSTEM_ADMIN" | "APPROVER" | "ACCOMMODATION_ADMIN" | "STAFF" | "ACCOMMODATION_OFFICER">) => (await prisma.user.create({ data: { organizationId: orgId, email: `dl-${name}-${stamp}@example.com`, name: `${name} ${stamp}`, status: "ACTIVE", roleAssignments: { create: roles.map((role) => ({ role })) } } })).id;
  admin = await mk("Admin", ["SYSTEM_ADMIN"]);
  manager = await mk("Manager", ["APPROVER"]);
  cover = await mk("Cover", ["ACCOMMODATION_OFFICER"]);
  resident = await mk("Resident", ["STAFF"]);
  other = await mk("Other", ["STAFF"]);
  // A one-step type routed to APPROVER.
  const type = await prisma.requestType.create({ data: { organizationId: orgId, code: "LEAVE", name: "Leave note" } });
  await prisma.workflowVersion.create({ data: { requestTypeId: type.id, version: 1, isCurrent: true, publishedAt: new Date(), formSchema: { fields: [{ name: "note", label: "Note", type: "text", required: true }] }, steps: { create: [{ order: 1, name: "Manager approval", approverRole: "APPROVER", requireComment: false }] } } });
});

afterAll(async () => { await prisma.$disconnect(); });

describe("delegations", () => {
  let delegationId: string;
  it("validates dates, people and roles, and refuses overlapping cover", async () => {
    await expectError(createDelegation({ delegatorId: manager, delegateId: manager, startsAt: plus(0), endsAt: plus(2), actor: { id: manager, isAdmin: false } }), "VALIDATION");
    await expectError(createDelegation({ delegatorId: manager, delegateId: cover, startsAt: plus(2), endsAt: plus(0), actor: { id: manager, isAdmin: false } }), "VALIDATION");
    await expectError(createDelegation({ delegatorId: manager, delegateId: cover, startsAt: plus(-5), endsAt: plus(-1), actor: { id: manager, isAdmin: false } }), "VALIDATION");
    await expectError(createDelegation({ delegatorId: manager, delegateId: cover, startsAt: plus(0), endsAt: plus(2), actor: { id: cover, isAdmin: false } }), "FORBIDDEN");
    await expectError(createDelegation({ delegatorId: resident, delegateId: cover, startsAt: plus(0), endsAt: plus(2), actor: { id: resident, isAdmin: false } }), "VALIDATION");
    await expectError(createDelegation({ delegatorId: manager, delegateId: cover, roles: ["ACCOMMODATION_ADMIN"], startsAt: plus(0), endsAt: plus(2), actor: { id: manager, isAdmin: false } }), "VALIDATION");
    const d = await createDelegation({ delegatorId: manager, delegateId: cover, startsAt: plus(0), endsAt: plus(2), reason: "Annual leave", actor: { id: manager, isAdmin: false } });
    delegationId = d.id;
    expect(d.status).toBe("ACTIVE");
    await expectError(createDelegation({ delegatorId: manager, delegateId: cover, startsAt: plus(1), endsAt: plus(3), actor: { id: manager, isAdmin: false } }), "CONFLICT");
    expect(await prisma.notification.findFirst({ where: { recipientId: cover, event: "delegation.started" } })).not.toBeNull();
    expect(isLive(d, new Date())).toBe(true);
    expect(isLive(d, new Date(Date.now() + 5 * 86400000))).toBe(false);
  });

  it("gives the delegate the delegator's approver roles only while the delegation is live", async () => {
    const roles = await delegatedRolesFor(cover);
    expect(roles).toEqual([{ role: "APPROVER", delegatorId: manager, delegatorName: `Manager ${stamp}`, delegationId }]);
    expect(await delegatedRolesFor(cover, new Date(Date.now() + 5 * 86400000))).toEqual([]);
    expect(coveredRoles({ roles: [], delegator: { roleAssignments: [{ role: "APPROVER" }, { role: "STAFF" }] } })).toEqual(["APPROVER"]);
    expect(coveredRoles({ roles: ["ACCOMMODATION_ADMIN"], delegator: { roleAssignments: [{ role: "APPROVER" }] } })).toEqual([]);
    const future = await createDelegation({ delegatorId: manager, delegateId: other, startsAt: plus(10), endsAt: plus(12), actor: { id: admin, isAdmin: true } });
    expect(await delegatedRolesFor(other)).toEqual([]);
    expect(await prisma.notification.findFirst({ where: { recipientId: manager, event: "delegation.arranged" } })).not.toBeNull();
    const list = await listDelegations({ id: manager, isAdmin: false });
    expect(list.find((x) => x.id === future.id)?.upcoming).toBe(true);
    expect(list.find((x) => x.id === delegationId)?.live).toBe(true);
  });

  it("lets the delegate see and decide the delegator's step on their behalf, but not the delegator's own request", async () => {
    const { request } = await submitRequest({ requesterId: resident, organizationId: orgId, typeCode: "LEAVE", raw: { note: "Two days off" }, idempotencyKey: `dl-${stamp}-1` });
    const plain = actor(cover, ["ACCOMMODATION_OFFICER"]);
    expect(canDecide(await getRequest(request.id) as never, plain).ok).toBe(false);
    const covering = await withDelegations(plain);
    const p = canDecide(await getRequest(request.id) as never, covering);
    expect(p.ok && p.onBehalfOf?.delegatorId).toBe(manager);
    const inbox = await listInbox(covering);
    expect(inbox.find((r) => r.id === request.id)?.coveringFor).toBe(`Manager ${stamp}`);
    // The manager's own request cannot be approved with the manager's delegated authority.
    const own = await submitRequest({ requesterId: manager, organizationId: orgId, typeCode: "LEAVE", raw: { note: "My own" }, idempotencyKey: `dl-${stamp}-2` });
    expect((await listInbox(covering)).some((r) => r.id === own.request.id)).toBe(false);
    await expectError(decideRequest({ requestId: own.request.id, actor: covering, action: "APPROVE" }), "FORBIDDEN");
    await expectError(decideRequest({ requestId: request.id, actor: plain, action: "APPROVE" }), "FORBIDDEN");
    const decided = await decideRequest({ requestId: request.id, actor: covering, action: "APPROVE", comment: "Covering for the manager" });
    expect(["APPROVED", "FULFILLED"]).toContain(decided.status);
    const full = (await getRequest(request.id))!;
    expect(full.decisions[0].approver.id).toBe(cover);
    expect(full.decisions[0].onBehalfOf?.id).toBe(manager);
    expect(full.decisions[0].delegationId).toBe(delegationId);
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: request.id, action: "REQUEST_DECIDED" } });
    expect((audit?.after as { onBehalfOf?: string }).onBehalfOf).toBe(manager);
  });

  it("revocation ends cover immediately and is restricted to the people involved or an administrator", async () => {
    await expectError(revokeDelegation({ delegationId, actor: { id: other, isAdmin: false } }), "FORBIDDEN");
    await revokeDelegation({ delegationId, actor: { id: cover, isAdmin: false } });
    expect(await delegatedRolesFor(cover)).toEqual([]);
    await expectError(revokeDelegation({ delegationId, actor: { id: manager, isAdmin: false } }), "INVALID_STATE");
    const { request } = await submitRequest({ requesterId: other, organizationId: orgId, typeCode: "LEAVE", raw: { note: "Later" }, idempotencyKey: `dl-${stamp}-3` });
    expect((await listInbox(await withDelegations(actor(cover, ["ACCOMMODATION_OFFICER"])))).some((r) => r.id === request.id)).toBe(false);
    expect(await prisma.auditEvent.findFirst({ where: { entityType: "ApprovalDelegation", entityId: delegationId, action: "DELEGATION_REVOKED" } })).not.toBeNull();
  });
});
