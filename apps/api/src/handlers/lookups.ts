import type { ApiContract } from "@sam/contract/index";
import { siteOptions, staffOptions } from "@sam/core/modules/lookups/service";
import type { Handlers } from "../register";

export const lookupHandlers: Handlers<ApiContract>["lookups"] = {
  staff: () => staffOptions(),
  sites: () => siteOptions(),
};
