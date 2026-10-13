import { accommodation } from "./ops/accommodation";
import { allocations } from "./ops/allocations";
import { auth } from "./ops/auth";
import { files, maintenance } from "./ops/maintenance";
import { keys } from "./ops/keys";
import { lookups } from "./ops/lookups";
import { me, searchOps } from "./ops/me";

/** Every operation the API offers, grouped by module. */
export const contract = {
  auth,
  me,
  accommodation,
  allocations,
  maintenance,
  files,
  keys,
  lookups,
  search: searchOps,
};

export type ApiContract = typeof contract;
export { createClient, reviveDates, type Client, type ClientOptions } from "./client";
export { ApiError, type ErrorBody } from "./errors";
export * from "./define";
