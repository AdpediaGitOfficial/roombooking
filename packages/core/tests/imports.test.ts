import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/db";
import { parseCsv, toRecords } from "../src/modules/imports/csv";
import { ImportError, commitImport, discardBatch, exportAccommodationCsv, exportStaffCsv, previewImport, templateCsv, type RowResult } from "../src/modules/imports/service";

const stamp = Date.now().toString(36).toUpperCase();
let orgId: string; let actorId: string;

async function expectError<T>(p: Promise<T>, code: string) {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(ImportError); expect((e as ImportError).code).toBe(code); return e as ImportError; }
  throw new Error(`expected ImportError ${code}`);
}
const rows = (b: { rows: unknown }) => b.rows as RowResult[];

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { code: `IM-${stamp}`, name: "Import Org" } });
  orgId = org.id;
  actorId = (await prisma.user.create({ data: { organizationId: orgId, email: `im-${stamp}@example.com`, name: "Importer", status: "ACTIVE" } })).id;
  await prisma.site.create({ data: { organizationId: orgId, code: "HQ", name: "HQ", timezone: "UTC", buildings: { create: [{ code: "A", name: "Block A", rooms: { create: [{ code: "A-01", type: "shared", beds: { create: [{ code: "A-01-1" }] } }] } }] } } });
  await prisma.staffProfile.create({ data: { organizationId: orgId, employeeId: "E1", firstName: "Old", lastName: "Name", department: "Ops" } });
});

afterAll(async () => { await prisma.$disconnect(); });

describe("csv", () => {
  it("parses quoted fields, doubled quotes, CRLF, BOM and blank lines", () => {
    const p = parseCsv('﻿a,b,"c"\r\n1,"x, y","say ""hi"""\r\n\r\n2,,"multi\nline"\n');
    expect(p.headers).toEqual(["a", "b", "c"]);
    expect(p.rows.map((r) => r.values)).toEqual([["1", "x, y", 'say "hi"'], ["2", "", "multi\nline"]]);
    expect(p.rows.map((r) => r.line)).toEqual([2, 4]);
    expect(toRecords(p)[0].values).toEqual({ a: "1", b: "x, y", c: 'say "hi"' });
    expect(parseCsv("").rows).toEqual([]);
  });
});

describe("staff import", () => {
  it("previews creates, updates, unchanged rows, validation errors and in-file duplicates", async () => {
    const text = ["employeeId,firstName,lastName,gender,department,company,phone,employmentStatus",
      "E1,New,Name,FEMALE,Ops,,,ACTIVE",
      "E2,Ann,Lee,male,Finance,Acme,+971500000001,on_leave",
      ",Missing,Id,,,,,",
      "E3,Bad,Gender,OTHER,,,,RETIRED",
      "E2,Dup,Row,,,,,",
    ].join("\n");
    const b = await previewImport({ kind: "staff", fileName: "staff.csv", text, organizationId: orgId, actorId });
    expect(b.summary).toEqual({ total: 5, create: 1, update: 1, unchanged: 0, error: 3 });
    const r = rows(b);
    expect(r[0]).toMatchObject({ line: 2, action: "update", note: "Updates Old Name" });
    expect(r[1].action).toBe("create");
    expect(r[2].errors[0]).toContain("employeeId is required");
    expect(r[3].errors).toEqual([expect.stringContaining("gender"), expect.stringContaining("employmentStatus")]);
    expect(r[4].errors[0]).toContain("Duplicate of line 3");
    await expectError(commitImport({ batchId: b.id, actorId }), "HAS_ERRORS");
    expect(await prisma.staffProfile.count({ where: { organizationId: orgId } })).toBe(1);
    const done = await commitImport({ batchId: b.id, actorId, skipErrors: true });
    expect(done.status).toBe("IMPORTED");
    expect(done.result).toMatchObject({ create: 1, update: 1, skipped: 3 });
    expect((await prisma.staffProfile.findUniqueOrThrow({ where: { organizationId_employeeId: { organizationId: orgId, employeeId: "E1" } } })).firstName).toBe("New");
    expect((await prisma.staffProfile.findUniqueOrThrow({ where: { organizationId_employeeId: { organizationId: orgId, employeeId: "E2" } } })).employmentStatus).toBe("ON_LEAVE");
    await expectError(commitImport({ batchId: b.id, actorId }), "INVALID_STATE");
    expect(await prisma.auditEvent.findFirst({ where: { entityId: b.id, action: "IMPORT_COMMITTED" } })).not.toBeNull();
  });

  it("rejects files without the required columns or rows, and a re-upload of imported data is all unchanged", async () => {
    await expectError(previewImport({ kind: "staff", fileName: "x.csv", text: "name,phone\nA,1", organizationId: orgId, actorId }), "VALIDATION");
    await expectError(previewImport({ kind: "staff", fileName: "x.csv", text: "employeeId,firstName,lastName\n", organizationId: orgId, actorId }), "VALIDATION");
    const again = await previewImport({ kind: "staff", fileName: "export.csv", text: await exportStaffCsv(orgId), organizationId: orgId, actorId });
    expect(again.summary).toMatchObject({ total: 2, unchanged: 2, error: 0 });
    await expectError(commitImport({ batchId: again.id, actorId }), "VALIDATION");
    await discardBatch({ batchId: again.id, actorId });
    await expectError(discardBatch({ batchId: again.id, actorId }), "INVALID_STATE");
    expect(templateCsv("staff")).toContain("employeeId,firstName");
  });
});

describe("accommodation import", () => {
  it("creates buildings, rooms and beds, updates existing rooms, detects duplicates and unknown sites, and rolls back on failure", async () => {
    const text = ["site,building,buildingName,buildingType,room,roomType,floor,genderPolicy,beds",
      "HQ,A,,,A-01,shared,G,MALE,A-01-1|A-01-2",
      "HQ,B,Block B,villa,B-01,single,1,,1",
      "HQ,B,,,B-02,shared,1,FEMALE,3",
      "HQ,C,,,C-01,,,,2",
      "ZZ,A,,,A-05,,,,2",
      "HQ,A,,,a-01,,,,1",
      "HQ,B,,,B-03,,,,B-03-1|B-03-1",
    ].join("\n");
    const b = await previewImport({ kind: "accommodation", fileName: "rooms.csv", text, organizationId: orgId, actorId });
    const r = rows(b);
    expect(r[0]).toMatchObject({ action: "update", note: "Updates room; adds 1 bed" });
    expect(r[1]).toMatchObject({ action: "create", note: "Building and room with 1 bed" });
    expect(r[2]).toMatchObject({ action: "create", note: "Room with 3 beds" });
    expect(r[3].errors[0]).toContain("buildingName is required");
    expect(r[4].errors[0]).toContain('site "ZZ" does not exist');
    expect(r[5].errors[0]).toContain("Duplicate of line 2");
    expect(r[6].errors[0]).toContain("repeat");
    expect(b.summary).toMatchObject({ create: 2, update: 1, error: 4 });
    await expectError(commitImport({ batchId: b.id, actorId }), "HAS_ERRORS");
    expect(await prisma.building.count({ where: { site: { organizationId: orgId } } })).toBe(1);
    await commitImport({ batchId: b.id, actorId, skipErrors: true });
    const site = await prisma.site.findFirstOrThrow({ where: { organizationId: orgId, code: "HQ" }, include: { buildings: { include: { rooms: { include: { beds: true } } }, orderBy: { code: "asc" } } } });
    expect(site.buildings.map((x) => `${x.code}:${x.type}`)).toEqual(["A:BUILDING", "B:VILLA"]);
    const a01 = site.buildings[0].rooms.find((x) => x.code === "A-01")!;
    expect(a01.beds.map((x) => x.code).sort()).toEqual(["A-01-1", "A-01-2"]);
    expect(a01.genderPolicy).toBe("MALE");
    const b02 = site.buildings[1].rooms.find((x) => x.code === "B-02")!;
    expect(b02.beds.map((x) => x.code).sort()).toEqual(["B-02-1", "B-02-2", "B-02-3"]);
    const csv = await exportAccommodationCsv(orgId);
    expect(csv).toContain("HQ,B,Block B,VILLA,B-02,shared,1,FEMALE,B-02-1|B-02-2|B-02-3");
    const again = await previewImport({ kind: "accommodation", fileName: "export.csv", text: csv, organizationId: orgId, actorId });
    expect(again.summary).toMatchObject({ unchanged: 3, error: 0 });
  });
});
