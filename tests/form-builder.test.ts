import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { RequestError } from "@/modules/requests/errors";
import { isFieldVisible, validateSubmission, visibleFields, type FormSchema } from "@/modules/requests/forms";
import { createDraft, createType, discardDraft, getType, normaliseSchema, publishVersion, saveDraft, slugify, updateType, validateSchema, validateSteps } from "@/modules/requests/builder";
import { getCurrentWorkflow, listRequestTypes, submitRequest } from "@/modules/requests/service";

const stamp = Date.now().toString(36).toUpperCase();
let orgId: string; let adminId: string;

async function expectError<T>(p: Promise<T>, code: string) {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(RequestError); expect((e as RequestError).code).toBe(code); return e as RequestError; }
  throw new Error(`expected RequestError ${code}`);
}

beforeAll(async () => {
  const org = await prisma.organization.upsert({ where: { code: `FB-${stamp}` }, update: {}, create: { code: `FB-${stamp}`, name: "Form Builder Org" } });
  orgId = org.id;
  adminId = (await prisma.user.create({ data: { organizationId: orgId, email: `fb-${stamp}@example.com`, name: "Form Admin", status: "ACTIVE", roleAssignments: { create: [{ role: "ACCOMMODATION_ADMIN" }] } } })).id;
});

afterAll(async () => { await prisma.$disconnect(); });

const schema: FormSchema = { fields: [
  { name: "hasVehicle", label: "Do you have a vehicle?", type: "checkbox" },
  { name: "plate", label: "Number plate", type: "text", required: true, visibleWhen: { field: "hasVehicle", op: "isTrue" } },
  { name: "kind", label: "Permit kind", type: "select", options: ["Resident", "Visitor"], required: true },
  { name: "visitorName", label: "Visitor name", type: "text", required: true, visibleWhen: { field: "kind", op: "equals", value: "Visitor" } },
  { name: "notes", label: "Notes", type: "textarea", visibleWhen: { field: "visitorName", op: "isSet" } },
] };

describe("conditional visibility", () => {
  it("shows fields only when their condition holds, never revealing fields that depend on hidden ones", () => {
    expect(isFieldVisible(schema.fields[1], { hasVehicle: "on" })).toBe(true);
    expect(isFieldVisible(schema.fields[1], { hasVehicle: "" })).toBe(false);
    expect(isFieldVisible(schema.fields[3], { kind: "Visitor" })).toBe(true);
    expect(isFieldVisible(schema.fields[3], { kind: "Resident" })).toBe(false);
    expect(visibleFields(schema.fields, { kind: "Resident" }).map((f) => f.name)).toEqual(["hasVehicle", "kind"]);
    expect(visibleFields(schema.fields, { kind: "Visitor", visitorName: "Ann", hasVehicle: "on" }).map((f) => f.name)).toEqual(["hasVehicle", "plate", "kind", "visitorName", "notes"]);
    // notes depends on visitorName, which is hidden for residents even if a value lingers
    expect(visibleFields(schema.fields, { kind: "Resident", visitorName: "Ann" }).map((f) => f.name)).toEqual(["hasVehicle", "kind"]);
  });
  it("neither requires nor stores hidden fields on submission", () => {
    const r = validateSubmission(schema, { kind: "Resident", visitorName: "stale", notes: "stale" });
    expect(r.errors).toEqual({});
    expect(r.data).toMatchObject({ hasVehicle: false, plate: null, kind: "Resident", visitorName: null, notes: null });
    const v = validateSubmission(schema, { hasVehicle: "on", kind: "Visitor" });
    expect(Object.keys(v.errors).sort()).toEqual(["plate", "visitorName"]);
  });
});

describe("schema and route validation", () => {
  it("slugifies labels and reports duplicate names, bad types, empty selects, bad ranges and invalid conditions", () => {
    expect(slugify("Visitor full name")).toBe("visitorFullName");
    expect(slugify("  2nd contact (phone) ")).toBe("2ndContactPhone");
    expect(slugify("")).toBe("");
    const bad: FormSchema = { fields: [
      { name: "Bad name", label: "", type: "text" },
      { name: "a", label: "A", type: "select" },
      { name: "a", label: "A2", type: "number", min: 5, max: 1 },
      { name: "b", label: "B", type: "text", visibleWhen: { field: "zzz", op: "isSet" } },
      { name: "c", label: "C", type: "text", visibleWhen: { field: "d", op: "isSet" } },
      { name: "d", label: "D", type: "checkbox" },
      { name: "e", label: "E", type: "text", visibleWhen: { field: "d", op: "equals", value: "x" } },
      { name: "f", label: "F", type: "text", visibleWhen: { field: "a", op: "equals" } },
      { name: "g", label: "G", type: "text", visibleWhen: { field: "a", op: "isTrue" } },
    ] };
    const e = validateSchema(bad);
    expect(e["fields.0.label"]).toBeTruthy();
    expect(e["fields.0.name"]).toBeTruthy();
    expect(e["fields.1.options"]).toBeTruthy();
    expect(e["fields.2.name"]).toContain("Duplicate");
    expect(e["fields.2.max"]).toBeTruthy();
    expect(e["fields.3.visibleWhen"]).toContain("earlier");
    expect(e["fields.4.visibleWhen"]).toContain("earlier");
    expect(e["fields.6.visibleWhen"]).toContain("ticked");
    expect(e["fields.7.visibleWhen"]).toContain("value");
    expect(e["fields.8.visibleWhen"]).toContain("checkbox");
    expect(validateSchema(schema)).toEqual({});
    expect(validateSteps([{ name: "", approverRole: "STAFF", requireComment: false }])).toEqual({ "steps.0.name": expect.any(String), "steps.0.approverRole": expect.any(String) });
    const n = normaliseSchema({ fields: [{ name: " x ", label: " X ", type: "select", options: ["a", " ", "b "], help: "", min: 3 }, { name: "y", label: "Y", type: "number", min: "1", max: "9", options: ["z"] }] });
    expect(n.fields[0]).toEqual({ name: "x", label: "X", type: "select", options: ["a", "b"] });
    expect(n.fields[1]).toEqual({ name: "y", label: "Y", type: "number", min: 1, max: 9 });
  });
});

describe("types and versions", () => {
  let typeId: string;
  it("creates a type with an empty draft, hidden from residents until published", async () => {
    await expectError(createType({ organizationId: orgId, actorId: adminId, code: "bad code!", name: "x" }), "VALIDATION");
    const t = await createType({ organizationId: orgId, actorId: adminId, code: "parking permit", name: "Parking permit", description: "Apply for a parking space." });
    typeId = t.id;
    expect(t.code).toBe("PARKING_PERMIT");
    await expectError(createType({ organizationId: orgId, actorId: adminId, code: "PARKING_PERMIT", name: "Dup" }), "VALIDATION");
    const full = (await getType(typeId))!;
    expect(full.versions).toHaveLength(1);
    expect(full.versions[0].publishedAt).toBeNull();
    expect((await listRequestTypes(orgId)).some((x) => x.id === typeId)).toBe(false);
    expect(await getCurrentWorkflow(orgId, "PARKING_PERMIT")).toBeNull();
  });

  it("saves a draft with fields and route, refuses invalid drafts and publishing an empty form, then publishes", async () => {
    const draft = (await getType(typeId))!.versions[0];
    await expectError(publishVersion({ versionId: draft.id, actorId: adminId }), "VALIDATION");
    const bad = await expectError(saveDraft({ versionId: draft.id, actorId: adminId, schema: { fields: [{ name: "x", label: "", type: "text" }] }, steps: [] }), "VALIDATION");
    expect(bad.fieldErrors["fields.0.label"]).toBeTruthy();
    await saveDraft({ versionId: draft.id, actorId: adminId, schema, steps: [{ name: "Security review", approverRole: "ACCOMMODATION_OFFICER", requireComment: false }, { name: "Admin approval", approverRole: "ACCOMMODATION_ADMIN", requireComment: true }], changeNote: "First version" });
    await expectError(createDraft({ typeId, actorId: adminId }), "INVALID_STATE");
    const published = await publishVersion({ versionId: draft.id, actorId: adminId });
    expect(published.isCurrent).toBe(true);
    expect(published.publishedAt).not.toBeNull();
    await expectError(saveDraft({ versionId: draft.id, actorId: adminId, schema, steps: [] }), "INVALID_STATE");
    await expectError(discardDraft({ versionId: draft.id, actorId: adminId }), "INVALID_STATE");
    const wf = (await getCurrentWorkflow(orgId, "PARKING_PERMIT"))!;
    expect(wf.schema.fields.map((f) => f.name)).toEqual(["hasVehicle", "plate", "kind", "visitorName", "notes"]);
    expect(wf.version.steps.map((s) => s.approverRole)).toEqual(["ACCOMMODATION_OFFICER", "ACCOMMODATION_ADMIN"]);
    expect((await listRequestTypes(orgId)).some((x) => x.id === typeId)).toBe(true);
  });

  it("a resident submits against the published form with conditional fields; a new draft does not touch it", async () => {
    const resident = await prisma.user.create({ data: { organizationId: orgId, email: `fb-res-${stamp}@example.com`, name: "Res", status: "ACTIVE", roleAssignments: { create: [{ role: "STAFF" }] } } });
    const bad = await expectError(submitRequest({ requesterId: resident.id, organizationId: orgId, typeCode: "PARKING_PERMIT", raw: { hasVehicle: "on", kind: "Visitor" }, idempotencyKey: `fb-${stamp}-1` }), "VALIDATION");
    expect(Object.keys(bad.fieldErrors).sort()).toEqual(["plate", "visitorName"]);
    const { request } = await submitRequest({ requesterId: resident.id, organizationId: orgId, typeCode: "PARKING_PERMIT", raw: { kind: "Resident", visitorName: "stale" }, idempotencyKey: `fb-${stamp}-2` });
    expect(request.status).toBe("PENDING_APPROVAL");
    expect((request.data as Record<string, unknown>).visitorName).toBeNull();
    const v2 = await createDraft({ typeId, actorId: adminId });
    expect(v2.version).toBe(2);
    expect((await prisma.approvalStep.count({ where: { workflowVersionId: v2.id } }))).toBe(2);
    await saveDraft({ versionId: v2.id, actorId: adminId, schema: { fields: [{ name: "kind", label: "Permit kind", type: "select", options: ["Resident"] }] }, steps: [] });
    // Still version 1 for residents and for the pinned request
    expect((await getCurrentWorkflow(orgId, "PARKING_PERMIT"))!.version.version).toBe(1);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: request.id }, include: { workflowVersion: true } })).workflowVersion.version).toBe(1);
    await discardDraft({ versionId: v2.id, actorId: adminId });
    expect((await getType(typeId))!.versions).toHaveLength(1);
    const v3 = await createDraft({ typeId, actorId: adminId });
    expect(v3.version).toBe(2);
    await saveDraft({ versionId: v3.id, actorId: adminId, schema: { fields: [{ name: "kind", label: "Permit kind", type: "select", options: ["Resident"] }] }, steps: [] });
    await publishVersion({ versionId: v3.id, actorId: adminId });
    expect((await getCurrentWorkflow(orgId, "PARKING_PERMIT"))!.version.steps).toHaveLength(0);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: request.id }, include: { workflowVersion: true } })).workflowVersion.version).toBe(1);
    await updateType({ typeId, actorId: adminId, name: "Parking permit", status: "INACTIVE" });
    expect(await getCurrentWorkflow(orgId, "PARKING_PERMIT")).toBeNull();
    expect(await prisma.auditEvent.count({ where: { entityType: "WorkflowVersion", action: "WORKFLOW_PUBLISHED" } })).toBeGreaterThanOrEqual(2);
  });
});
