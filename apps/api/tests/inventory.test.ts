import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "@sam/core/lib/db";
import { buildApp } from "../src/app";
import { bearer, ensureUser, testOrg, tokenFor } from "./helpers";

let app: FastifyInstance;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const sku = `API-${Date.now().toString(36)}`;

const call = (method: "GET" | "POST" | "PUT", url: string, who: string, payload?: object) => app.inject({ method, url, headers: bearer(tokens[who]), payload });

beforeAll(async () => {
  app = await buildApp({ config: { sessionCacheTtlMs: 0 } });
  for (const [who, roles] of [["custodian", ["INVENTORY_KEY_CUSTODIAN"]], ["officer", ["ACCOMMODATION_OFFICER"]], ["staff", ["STAFF"]], ["maint", ["MAINTENANCE"]]] as const) {
    tokens[who] = await tokenFor((await ensureUser(`inv-${who}@apitest.local`, [...roles])).id);
  }
  const org = await testOrg();
  // Movement history is append-only, so fixtures are reused and items use a fresh SKU each run.
  const site = await prisma.site.upsert({ where: { organizationId_code: { organizationId: org.id, code: "INV-T" } }, update: {}, create: { organizationId: org.id, code: "INV-T", name: "Inventory API Site" } });
  const person = await prisma.staffProfile.upsert({ where: { organizationId_employeeId: { organizationId: org.id, employeeId: "INV-1" } }, update: {}, create: { organizationId: org.id, employeeId: "INV-1", firstName: "Ivy", lastName: "Borrower" } });
  Object.assign(ids, { site: site.id, person: person.id });
});

afterAll(async () => {
  await app.close();
});

describe("inventory API", () => {
  it("shows the register to viewers (including maintenance) but not to residents", async () => {
    expect((await call("GET", "/v1/inventory", "staff")).statusCode).toBe(403);
    expect((await call("GET", "/v1/inventory", "maint")).statusCode).toBe(200);
    expect((await call("GET", "/v1/inventory/target-options", "maint")).statusCode).toBe(403);
  });

  it("creates a stock line with an opening quantity and reports field errors", async () => {
    expect((await call("POST", "/v1/inventory/items", "officer", { siteId: ids.site, sku, name: "Towels", category: "Linen", trackingType: "STOCK" })).statusCode).toBe(403);
    const bad = await call("POST", "/v1/inventory/items", "custodian", { siteId: ids.site, sku: "", name: "", category: "", trackingType: "STOCK" });
    expect(bad.statusCode).toBe(422);
    expect(Object.keys(bad.json().error.fieldErrors)).toEqual(expect.arrayContaining(["sku", "name", "category"]));
    const ok = await call("POST", "/v1/inventory/items", "custodian", { siteId: ids.site, sku, name: "Bath towels", category: "Linen", unit: "pcs", trackingType: "STOCK", reorderThreshold: 5, openingQuantity: 10 });
    expect(ok.statusCode).toBe(200);
    ids.item = ok.json().id;
    const detail = (await call("GET", `/v1/inventory/items/${ids.item}`, "officer")).json();
    expect(detail.item.quantity).toBe(10);
    expect(detail.transactions[0].type).toBe("RECEIPT");
  });

  it("issues stock to a resident, refuses over-issue, and takes it back", async () => {
    const issued = await call("POST", `/v1/inventory/items/${ids.item}/movements`, "officer", { kind: "ISSUE", quantity: 4, staffId: ids.person });
    expect(issued.statusCode).toBe(200);
    expect(issued.json().message).toBe("Issued; 6 on hand.");
    const over = await call("POST", `/v1/inventory/items/${ids.item}/movements`, "officer", { kind: "ISSUE", quantity: 50, staffId: ids.person });
    expect(over.statusCode).toBe(409);
    expect(over.json().error.code).toBe("INSUFFICIENT_STOCK");
    const noTarget = await call("POST", `/v1/inventory/items/${ids.item}/movements`, "officer", { kind: "ISSUE", quantity: 1 });
    expect(noTarget.statusCode).toBe(422);

    const handover = (await call("GET", `/v1/inventory/residents/${ids.person}`, "officer")).json();
    expect(handover.held.find((h: { itemId: string }) => h.itemId === ids.item).quantity).toBe(4);
    expect((await call("GET", `/v1/inventory/items/${ids.item}`, "officer")).json().outstanding[0].quantity).toBe(4);

    const back = await call("POST", `/v1/inventory/items/${ids.item}/movements`, "officer", { kind: "RETURN", quantity: 4, staffId: ids.person });
    expect(back.json().message).toBe("Returned.");
  });

  it("limits adjust, transfer and retire to managers", async () => {
    const denied = await call("POST", `/v1/inventory/items/${ids.item}/movements`, "officer", { kind: "ADJUST", countedQuantity: 9, reason: "Count" });
    expect(denied.statusCode).toBe(403);
    const ok = await call("POST", `/v1/inventory/items/${ids.item}/movements`, "custodian", { kind: "ADJUST", countedQuantity: 9, reason: "Annual count" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().message).toBe("Adjusted by -1; 9 on hand.");
  });

  it("filters the register and downloads the audited movement CSV", async () => {
    const found = (await call("GET", `/v1/inventory?q=${sku}`, "officer")).json();
    expect(found.items).toHaveLength(1);
    expect(found.summary.stockLines).toBeGreaterThanOrEqual(1);
    const csv = await call("GET", `/v1/inventory/movements.csv?itemId=${ids.item}`, "custodian");
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body.split("\n")[0]).toContain("When,Site,SKU");
    expect(csv.body).toContain(sku.toUpperCase());
    expect((await call("GET", `/v1/inventory/movements.csv`, "staff")).statusCode).toBe(403);
    const audits = await prisma.auditEvent.count({ where: { action: "REPORT_EXPORTED", entityId: "inventory-movements" } });
    expect(audits).toBeGreaterThanOrEqual(1);
    const reports = (await call("GET", `/v1/inventory/reports?siteId=${ids.site}`, "officer")).json();
    expect(reports.balance.some((r: { category: string }) => r.category === "Linen")).toBe(true);
  });
});
