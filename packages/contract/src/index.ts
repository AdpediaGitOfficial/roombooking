import { accommodation } from "./ops/accommodation";
import { audit, users } from "./ops/admin";
import { broadcasts } from "./ops/broadcasts";
import { allocations } from "./ops/allocations";
import { auth } from "./ops/auth";
import { facilities } from "./ops/facilities";
import { files, maintenance } from "./ops/maintenance";
import { imports } from "./ops/imports";
import { inventory } from "./ops/inventory";
import { keys } from "./ops/keys";
import { lookups } from "./ops/lookups";
import { lostFound } from "./ops/lost-found";
import { me, searchOps } from "./ops/me";
import { notifications } from "./ops/notifications";
import { reports } from "./ops/reports";
import { approvals, delegations_, forms, requests } from "./ops/requests";

/** Every operation the API offers, grouped by module. */
export const contract = {
  auth,
  me,
  accommodation,
  allocations,
  maintenance,
  files,
  keys,
  inventory,
  lostFound,
  facilities,
  requests,
  approvals,
  delegations: delegations_,
  forms,
  reports,
  users,
  audit,
  broadcasts,
  notifications,
  imports,
  lookups,
  search: searchOps,
};

export type ApiContract = typeof contract;
export { createClient, reviveDates, type Client, type ClientOptions } from "./client";
export { ApiError, type ErrorBody } from "./errors";
export * from "./define";
