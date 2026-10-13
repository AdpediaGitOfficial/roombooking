import path from "node:path";
import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";

// One `.env` at the repository root configures every service in development.
const repoRoot = path.resolve(process.cwd(), "../..");
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
