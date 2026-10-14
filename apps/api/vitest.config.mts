import { defineConfig } from "vitest/config";
import { loadRootEnv } from "@sam/core/lib/env";

loadRootEnv();

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    // Most tests change data behind the API's back; the cache has its own tests.
    env: { READ_CACHE_TTL_MS: "0" },
  },
});
