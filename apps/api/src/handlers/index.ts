import type { ApiContract } from "@sam/contract/index";
import type { Handlers } from "../register";
import { authHandlers } from "./auth";

export const handlers: Handlers<ApiContract> = {
  auth: authHandlers,
};
