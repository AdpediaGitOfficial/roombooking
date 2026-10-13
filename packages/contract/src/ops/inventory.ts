import { z } from "zod";
import { INVENTORY_MANAGE_ROLES, INVENTORY_OPERATE_ROLES, INVENTORY_VIEW_ROLES } from "@sam/core/modules/inventory/access";
import type * as svc from "@sam/core/modules/inventory/service";
import { cuid, fileOp, isoDate, op, out, type Ret } from "../define";

const text = (max: number) => z.string().max(max).optional();
const count = () => z.number().int().optional();
const condition = z.enum(["NEW", "GOOD", "FAIR", "DAMAGED"]);
const txType = z.enum(["RECEIPT", "ISSUE", "RETURN", "TRANSFER", "ADJUSTMENT", "DAMAGE", "RETIREMENT"]);

export const inventory = {
  register: op({
    id: "inventory.register",
    method: "GET",
    path: "/v1/inventory",
    summary: "The inventory register for a filter, with summary counts and categories",
    tag: "Inventory",
    access: INVENTORY_VIEW_ROLES,
    input: z.object({ filter: z.enum(["all", "stock", "assets", "low", "issued", "damaged", "retired"]).default("all"), q: text(200), category: text(100) }),
    output: out<Ret<typeof svc.getRegister>>(),
  }),
  targetOptions: op({
    id: "inventory.targetOptions",
    method: "GET",
    path: "/v1/inventory/target-options",
    summary: "Rooms, residents, facilities and sites items can be issued or moved to",
    tag: "Inventory",
    access: INVENTORY_OPERATE_ROLES,
    input: z.object({}),
    output: out<Ret<typeof svc.targetOptions>>(),
  }),
  reports: op({
    id: "inventory.reports",
    method: "GET",
    path: "/v1/inventory/reports",
    summary: "Stock balance, movements, allocated items and asset condition",
    tag: "Inventory",
    access: INVENTORY_VIEW_ROLES,
    input: z.object({ siteId: cuid().optional(), from: isoDate().optional(), to: isoDate().optional(), type: txType.optional() }),
    output: out<Ret<typeof svc.reportsView>>(),
  }),
  movementsCsv: fileOp({
    id: "inventory.movementsCsv",
    method: "GET",
    path: "/v1/inventory/movements.csv",
    summary: "Download the movement log as CSV (audited)",
    tag: "Inventory",
    access: INVENTORY_VIEW_ROLES,
    input: z.object({ siteId: cuid().optional(), from: isoDate().optional(), to: isoDate().optional(), type: txType.optional(), itemId: cuid().optional() }),
  }),
  residentHandover: op({
    id: "inventory.residentHandover",
    method: "GET",
    path: "/v1/inventory/residents/:staffId",
    summary: "Items a resident holds and items that could be issued to them",
    tag: "Inventory",
    access: INVENTORY_OPERATE_ROLES,
    input: z.object({ staffId: cuid() }),
    output: out<Ret<typeof svc.residentHandover>>(),
  }),
  get: op({
    id: "inventory.get",
    method: "GET",
    path: "/v1/inventory/items/:id",
    summary: "One item with its movement history and where stock is out",
    tag: "Inventory",
    access: INVENTORY_VIEW_ROLES,
    input: z.object({ id: cuid() }),
    output: out<NonNullable<Ret<typeof svc.getItem>>>(),
  }),
  create: op({
    id: "inventory.create",
    method: "POST",
    path: "/v1/inventory/items",
    summary: "Add a stock line or a serialised asset",
    tag: "Inventory",
    access: INVENTORY_MANAGE_ROLES,
    input: z.object({
      siteId: cuid(), sku: z.string().max(80), name: z.string().max(200), category: z.string().max(100), description: text(2000), unit: text(40),
      trackingType: z.enum(["STOCK", "SERIALIZED"]), serialNumber: text(120), condition: condition.optional(), reorderThreshold: count(),
      storageLocation: text(200), openingQuantity: count(), notes: text(2000),
    }),
    output: out<Ret<typeof svc.createItem>>(),
  }),
  update: op({
    id: "inventory.update",
    method: "PUT",
    path: "/v1/inventory/items/:id",
    summary: "Edit an item's descriptive details",
    tag: "Inventory",
    access: INVENTORY_MANAGE_ROLES,
    input: z.object({ id: cuid(), name: z.string().max(200), category: z.string().max(100), description: text(2000), unit: text(40), condition: condition.optional(), reorderThreshold: count(), storageLocation: text(200), notes: text(2000) }),
    output: out<Ret<typeof svc.updateItem>>(),
  }),
  movement: op({
    id: "inventory.movement",
    method: "POST",
    path: "/v1/inventory/items/:id/movements",
    summary: "Receive, issue, return, damage (operators) or adjust, transfer, retire (managers)",
    tag: "Inventory",
    access: INVENTORY_OPERATE_ROLES,
    input: z.object({
      id: cuid(),
      kind: z.enum(["RECEIVE", "ISSUE", "RETURN", "DAMAGE", "ADJUST", "TRANSFER", "RETIRE"]),
      quantity: count(),
      roomId: cuid().optional(), staffId: cuid().optional(), facilityId: cuid().optional(),
      condition: condition.optional(), reference: text(200), notes: text(2000),
      countedQuantity: count(), reason: text(500), toSiteId: cuid().optional(),
    }),
    output: out<{ message: string }>(),
  }),
};
