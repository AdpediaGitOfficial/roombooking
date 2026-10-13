import { accommodation } from "./ops/accommodation";
import { allocations } from "./ops/allocations";
import { auth } from "./ops/auth";
import { me, searchOps } from "./ops/me";

/** Every operation the API offers, grouped by module. */
export const contract = {
  auth,
  me,
  accommodation,
  allocations,
  search: searchOps,
};

export type ApiContract = typeof contract;
export { createClient, reviveDates, type Client, type ClientOptions } from "./client";
export { ApiError, type ErrorBody } from "./errors";
export * from "./define";
