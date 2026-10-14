import type { ApiContract } from "@sam/contract/index";
import { ImportError } from "@sam/core/modules/imports/rules";
import { batchView, commitImport, discardBatch, exportFile, listBatches, previewImport } from "@sam/core/modules/imports/service";
import type { Handlers } from "../register";

const MAX_BYTES = 2 * 1024 * 1024;

export const importHandlers: Handlers<ApiContract>["imports"] = {
  list: (ctx) => listBatches(ctx.user.organizationId),
  get: (ctx, input) => batchView(ctx.user.organizationId, input.id),
  async preview(ctx, input) {
    if (input.file.bytes.length > MAX_BYTES) throw new ImportError("VALIDATION", "Files must be 2 MB or smaller.");
    return previewImport({ kind: input.kind, fileName: input.file.fileName, text: new TextDecoder().decode(input.file.bytes), organizationId: ctx.user.organizationId, actorId: ctx.user.id });
  },
  commit: (ctx, input) => commitImport({ batchId: input.id, actorId: ctx.user.id, skipErrors: input.skipErrors }),
  async discard(ctx, input) {
    await discardBatch({ batchId: input.id, actorId: ctx.user.id });
    return { discarded: true as const };
  },
  async export(ctx, input) {
    const csv = await exportFile({ kind: input.kind, template: input.template, organizationId: ctx.user.organizationId, actorId: ctx.user.id });
    return { body: new TextEncoder().encode(csv), contentType: "text/csv; charset=utf-8", fileName: `${input.kind}${input.template ? "-template" : ""}.csv` };
  },
};
