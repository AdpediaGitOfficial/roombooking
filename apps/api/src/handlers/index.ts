import type { ApiContract } from "@sam/contract/index";
import type { Handlers } from "../register";
import { authHandlers } from "./auth";
import { meHandlers, searchHandlers } from "./me";

export const handlers: Handlers<ApiContract> = {
  auth: authHandlers,
  me: meHandlers,
  search: searchHandlers,
};
