import type { ApiContract } from "@sam/contract/index";
import { readAttachment } from "@sam/core/modules/attachments/service";
import { addNote, assignWorkOrder, changeStatus, createWorkOrder, getQueue, getWorkOrderView, listMyWorkOrders, opsLocationOptions, residentRoomOptions, triageWorkOrder } from "@sam/core/modules/maintenance/service";
import { actorOf } from "../actor";
import type { Handlers } from "../register";

export const maintenanceHandlers: Handlers<ApiContract>["maintenance"] = {
  queue: (ctx, input) => getQueue(actorOf(ctx.user), input.filter, { page: input.page, pageSize: input.pageSize }),
  mine: (ctx) => listMyWorkOrders(ctx.user.id),
  get: (ctx, input) => getWorkOrderView(actorOf(ctx.user), input.id, "ops"),
  getMine: (ctx, input) => getWorkOrderView(actorOf(ctx.user), input.id, "mine"),
  myRoomOptions: (ctx) => residentRoomOptions(ctx.user.id),
  locationOptions: () => opsLocationOptions(),
  create: (ctx, input) =>
    createWorkOrder({
      requesterId: ctx.user.id,
      roomId: input.roomId ?? null,
      buildingId: input.buildingId ?? null,
      locationNote: input.locationNote || null,
      category: input.category,
      description: input.description,
      priority: input.priority,
      preferredContact: input.preferredContact || null,
      photo: input.photo ?? null,
    }),
  assign: (ctx, input) => assignWorkOrder({ workOrderId: input.id, actor: actorOf(ctx.user), assigneeId: input.assigneeId ?? null, vendorId: input.vendorId ?? null, note: input.note ?? null }),
  changeStatus: (ctx, input) => changeStatus({ workOrderId: input.id, actor: actorOf(ctx.user), status: input.status, note: input.note ?? null }),
  triage: (ctx, input) => triageWorkOrder({ workOrderId: input.id, actor: actorOf(ctx.user), category: input.category || null, priority: input.priority ?? null, markTriaged: true }),
  addNote: (ctx, input) => addNote({ workOrderId: input.id, actor: actorOf(ctx.user), note: input.note, internal: input.internal, photo: input.photo ?? null }),
};

export const fileHandlers: Handlers<ApiContract>["files"] = {
  attachment: (ctx, input) => readAttachment(actorOf(ctx.user), input.id),
};
