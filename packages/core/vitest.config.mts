import { defineConfig } from "vitest/config";
import { loadRootEnv } from "./src/lib/env";

loadRootEnv();

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
  },
});
