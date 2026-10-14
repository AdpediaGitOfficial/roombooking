import type { ApiContract } from "@sam/contract/index";
import { applyKeyException, getKey, getRegister, issueKey, keysForRoom, registerKey, registerOptions, replaceKey, returnKey } from "@sam/core/modules/keys/service";
import { KeyError } from "@sam/core/modules/keys/errors";
import type { Handlers } from "../register";

export const keyHandlers: Handlers<ApiContract>["keys"] = {
  register: (_ctx, input) => getRegister(input.filter, { page: input.page, pageSize: input.pageSize }),
  registerOptions: () => registerOptions(),
  forRoom: (_ctx, input) => keysForRoom(input.roomId),
  async get(_ctx, input) {
    const key = await getKey(input.id);
    if (!key) throw new KeyError("NOT_FOUND", "Key not found.");
    return key;
  },
  create: (ctx, input) =>
    registerKey({ siteId: input.siteId, code: input.code, label: input.label, roomId: input.roomId ?? null, facilityId: input.facilityId ?? null, allowCopies: input.allowCopies, notes: input.notes, actorId: ctx.user.id }),
  issue: (ctx, input) =>
    issueKey({ keyId: input.id, actorId: ctx.user.id, holderStaffId: input.holderStaffId ?? null, holderName: input.holderName || null, condition: input.condition || null, expectedReturnAt: input.expectedReturnAt || null, notes: input.notes || null }),
  returnKey: (ctx, input) => returnKey({ keyId: input.id, actorId: ctx.user.id, condition: input.condition || null, notes: input.notes || null }),
  exception: (ctx, input) => applyKeyException({ keyId: input.id, actorId: ctx.user.id, kind: input.kind, notes: input.notes, incidentRef: input.incidentRef || null }),
  replace: (ctx, input) => replaceKey({ keyId: input.id, actorId: ctx.user.id, newCode: input.newCode, notes: input.notes || null }),
};
