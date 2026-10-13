import { z } from "zod";
import { IMPORT_ROLES } from "@sam/core/modules/imports/rules";
import type * as svc from "@sam/core/modules/imports/service";
import { bool, cuid, fileInput, fileOp, op, out, type Ret } from "../define";

const kind = z.enum(["staff", "accommodation"]);

export const imports = {
  list: op({
    id: "imports.list",
    method: "GET",
    path: "/v1/admin/imports",
    summary: "Recent import batches",
    tag: "Imports",
    access: IMPORT_ROLES,
    input: z.object({}),
    output: out<Ret<typeof svc.listBatches>>(),
  }),
  get: op({
    id: "imports.get",
    method: "GET",
    path: "/v1/admin/imports/:id",
    summary: "One import batch with its per-row results",
    tag: "Imports",
    access: IMPORT_ROLES,
    input: z.object({ id: cuid() }),
    output: out<Ret<typeof svc.batchView>>(),
  }),
  preview: op({
    id: "imports.preview",
    method: "POST",
    path: "/v1/admin/imports",
    summary: "Upload a CSV and validate it into a preview batch (nothing is written yet)",
    tag: "Imports",
    access: IMPORT_ROLES,
    multipart: true,
    input: z.object({ kind, file: fileInput }),
    output: out<Ret<typeof svc.previewImport>>(),
  }),
  commit: op({
    id: "imports.commit",
    method: "POST",
    path: "/v1/admin/imports/:id/commit",
    summary: "Apply a previewed batch in one transaction",
    tag: "Imports",
    access: IMPORT_ROLES,
    input: z.object({ id: cuid(), skipErrors: bool().default(false) }),
    output: out<Ret<typeof svc.commitImport>>(),
  }),
  discard: op({
    id: "imports.discard",
    method: "POST",
    path: "/v1/admin/imports/:id/discard",
    summary: "Discard a preview",
    tag: "Imports",
    access: IMPORT_ROLES,
    input: z.object({ id: cuid() }),
    output: out<{ discarded: true }>(),
  }),
  export: fileOp({
    id: "imports.export",
    method: "GET",
    path: "/v1/admin/imports/export/:kind",
    summary: "Download current data in the import layout, or an example template",
    tag: "Imports",
    access: IMPORT_ROLES,
    input: z.object({ kind, template: bool().default(false) }),
  }),
};
