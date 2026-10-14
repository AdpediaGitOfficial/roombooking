import type { ApiContract } from "@sam/contract/index";
import { ALLOCATION_ADMIN_ROLES } from "@sam/core/modules/allocations/access";
import { AllocationError } from "@sam/core/modules/allocations/errors";
import { allocate, allocationFormOptions, cancel, checkIn, checkOut, findAvailableBeds, getAllocationDetail, listAllocations, transfer } from "@sam/core/modules/allocations/service";
import type { Handlers } from "../register";

export const allocationHandlers: Handlers<ApiContract>["allocations"] = {
  list: (_ctx, input) => listAllocations(input.filter, input.staffId ?? null, { page: input.page, pageSize: input.pageSize }),
  formOptions: () => allocationFormOptions(),
  availableBeds: (_ctx, input) => findAvailableBeds({ ...input, endDate: input.endDate ?? null }),
  async get(_ctx, input) {
    const detail = await getAllocationDetail(input.id);
    if (!detail) throw new AllocationError("NOT_FOUND", "Allocation not found.");
    return detail;
  },
  allocate: (ctx, input) => allocate({ ...input, endDate: input.endDate ?? null, reason: input.reason ?? null, actorId: ctx.user.id }),
  checkIn: (ctx, input) => checkIn({ allocationId: input.id, actorId: ctx.user.id, notes: input.notes ?? null }),
  checkOut: (ctx, input) =>
    checkOut({
      allocationId: input.id,
      actorId: ctx.user.id,
      notes: input.notes ?? null,
      overrideReason: input.overrideReason ?? null,
      // Decided here from the verified session, never from the request body.
      canOverride: ctx.user.roleAssignments.some((r) => ALLOCATION_ADMIN_ROLES.includes(r.role)),
    }),
  cancel: (ctx, input) => cancel({ allocationId: input.id, actorId: ctx.user.id, reason: input.reason }),
  transfer: (ctx, input) =>
    transfer({ allocationId: input.id, toBedId: input.toBedId, effectiveDate: input.effectiveDate, reason: input.reason, requestId: input.requestId ?? null, actorId: ctx.user.id }),
};
