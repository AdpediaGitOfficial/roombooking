import { accommodation } from "./ops/accommodation";
import { allocations } from "./ops/allocations";
import { auth } from "./ops/auth";
import { facilities } from "./ops/facilities";
import { files, maintenance } from "./ops/maintenance";
import { inventory } from "./ops/inventory";
import { keys } from "./ops/keys";
import { lookups } from "./ops/lookups";
import { lostFound } from "./ops/lost-found";
import { me, searchOps } from "./ops/me";
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
  lookups,
  search: searchOps,
};

export type ApiContract = typeof contract;
export { createClient, reviveDates, type Client, type ClientOptions } from "./client";
export { ApiError, type ErrorBody } from "./errors";
export * from "./define";
