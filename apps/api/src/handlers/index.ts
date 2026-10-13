import type { ApiContract } from "@sam/contract/index";
import type { Handlers } from "../register";
import { accommodationHandlers } from "./accommodation";
import { allocationHandlers } from "./allocations";
import { authHandlers } from "./auth";
import { inventoryHandlers } from "./inventory";
import { keyHandlers } from "./keys";
import { lookupHandlers } from "./lookups";
import { fileHandlers, maintenanceHandlers } from "./maintenance";
import { lostFoundHandlers } from "./lost-found";
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
  lookups: lookupHandlers,
  search: searchHandlers,
};
