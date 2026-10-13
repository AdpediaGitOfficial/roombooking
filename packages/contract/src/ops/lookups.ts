import { z } from "zod";
import { ALLOCATION_OPERATE_ROLES } from "@sam/core/modules/allocations/access";
import { INVENTORY_OPERATE_ROLES } from "@sam/core/modules/inventory/access";
import { KEY_OPERATE_ROLES } from "@sam/core/modules/keys/access";
import { LOST_FOUND_OPERATE_ROLES } from "@sam/core/modules/lost-found/access";
import type * as svc from "@sam/core/modules/lookups/service";
import { op, out, type Ret } from "../define";

const STAFF_PICKER_ROLES = [...new Set([...ALLOCATION_OPERATE_ROLES, ...KEY_OPERATE_ROLES, ...INVENTORY_OPERATE_ROLES, ...LOST_FOUND_OPERATE_ROLES])];

export const lookups = {
  staff: op({
    id: "lookups.staff",
    method: "GET",
    path: "/v1/lookups/staff",
    summary: "Active staff for pickers (name and employee number)",
    tag: "Lookups",
    access: STAFF_PICKER_ROLES,
    input: z.object({}),
    output: out<Ret<typeof svc.staffOptions>>(),
  }),
  sites: op({
    id: "lookups.sites",
    method: "GET",
    path: "/v1/lookups/sites",
    summary: "Active sites for pickers",
    tag: "Lookups",
    access: STAFF_PICKER_ROLES,
    input: z.object({}),
    output: out<Ret<typeof svc.siteOptions>>(),
  }),
};
