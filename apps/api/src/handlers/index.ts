import type { ApiContract } from "@sam/contract/index";
import type { Handlers } from "../register";
import { accommodationHandlers } from "./accommodation";
import { allocationHandlers } from "./allocations";
import { authHandlers } from "./auth";
import { importHandlers } from "./imports";
import { inventoryHandlers } from "./inventory";
import { keyHandlers } from "./keys";
import { lookupHandlers } from "./lookups";
import { facilityHandlers } from "./facilities";
import { fileHandlers, maintenanceHandlers } from "./maintenance";
import { lostFoundHandlers } from "./lost-found";
import { auditHandlers, userHandlers } from "./admin";
import { broadcastHandlers } from "./broadcasts";
import { notificationHandlers } from "./notifications";
import { reportHandlers } from "./reports";
import { approvalHandlers, delegationHandlers, formHandlers, requestHandlers } from "./requests";
import { meHandlers, searchHandlers } from "./me";

export const handlers: Handlers<ApiContract> = {
  auth: authHandlers,
  me: meHandlers,
  accommodation: accommodationHandlers,
  allocations: allocationHandlers,
  maintenance: maintenanceHandlers,
  files: fileHandlers,
  keys: keyHandlers,
  inventory: inventoryHandlers,
  lostFound: lostFoundHandlers,
  facilities: facilityHandlers,
  requests: requestHandlers,
  approvals: approvalHandlers,
  delegations: delegationHandlers,
  forms: formHandlers,
  reports: reportHandlers,
  users: userHandlers,
  audit: auditHandlers,
  broadcasts: broadcastHandlers,
  notifications: notificationHandlers,
  imports: importHandlers,
  lookups: lookupHandlers,
  search: searchHandlers,
};
