import type { ApiContract } from "@sam/contract/index";
import { INVENTORY_MANAGE_ROLES } from "@sam/core/modules/inventory/access";
import { InventoryError } from "@sam/core/modules/inventory/errors";
import { MANAGER_MOVEMENTS, applyMovement, createItem, getItem, getRegister, movementCsv, reportsView, residentHandover, targetOptions, updateItem } from "@sam/core/modules/inventory/service";
import type { Handlers } from "../register";

export const inventoryHandlers: Handlers<ApiContract>["inventory"] = {
  register: (_ctx, input) => getRegister({ filter: input.filter, q: input.q || null, category: input.category || null }, { page: input.page, pageSize: input.pageSize }),
  targetOptions: () => targetOptions(),
  reports: (_ctx, input) => reportsView({ siteId: input.siteId ?? null, from: input.from, to: input.to, type: input.type }),
  async movementsCsv(ctx, input) {
    const csv = await movementCsv({ siteId: input.siteId ?? null, from: input.from ?? null, to: input.to ?? null, type: input.type ?? null, itemId: input.itemId ?? null }, ctx.user.id);
    return { body: new TextEncoder().encode(csv), contentType: "text/csv; charset=utf-8", fileName: `inventory-movements-${new Date().toISOString().slice(0, 10)}.csv` };
  },
  residentHandover: (_ctx, input) => residentHandover(input.staffId),
  async get(_ctx, input) {
    const detail = await getItem(input.id);
    if (!detail) throw new InventoryError("NOT_FOUND", "Item not found.");
    return detail;
  },
  create: (ctx, input) => createItem({ ...input, actorId: ctx.user.id, condition: input.condition ?? null }),
  update: (ctx, input) => updateItem({ itemId: input.id, actorId: ctx.user.id, name: input.name, category: input.category, description: input.description, unit: input.unit, condition: input.condition ?? null, reorderThreshold: input.reorderThreshold, storageLocation: input.storageLocation, notes: input.notes }),
  async movement(ctx, input) {
    if (MANAGER_MOVEMENTS.includes(input.kind) && !ctx.user.roleAssignments.some((r) => INVENTORY_MANAGE_ROLES.includes(r.role))) {
      throw new InventoryError("FORBIDDEN", "Only inventory managers can adjust, transfer or retire items.");
    }
    return applyMovement({
      kind: input.kind, itemId: input.id, actorId: ctx.user.id, quantity: input.quantity,
      target: { roomId: input.roomId, staffId: input.staffId, facilityId: input.facilityId },
      condition: input.condition ?? null, reference: input.reference, notes: input.notes,
      countedQuantity: input.countedQuantity, reason: input.reason, toSiteId: input.toSiteId,
    });
  },
};
