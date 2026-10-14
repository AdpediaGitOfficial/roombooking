import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";

// One `.env` at the repository root configures every service in development.
// Resolved from this file, not the working directory, so it is right however the process is started (PM2, npm -w, a shell).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadEnvConfig(repoRoot);

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The shared domain library is consumed as TypeScript source.
  transpilePackages: ["@sam/core"],
  turbopack: {
    root: repoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
