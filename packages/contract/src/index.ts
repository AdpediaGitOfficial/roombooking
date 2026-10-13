import { auth } from "./ops/auth";

/** Every operation the API offers, grouped by module. */
export const contract = {
  auth,
};

export type ApiContract = typeof contract;
export { createClient, reviveDates, type Client, type ClientOptions } from "./client";
export { ApiError, type ErrorBody } from "./errors";
export * from "./define";
