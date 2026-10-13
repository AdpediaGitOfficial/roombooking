import { defineConfig } from "tsup";

// Bundles the worker and the workspace libraries into one file; third-party packages stay external.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@sam\//],
  external: ["@prisma/client", ".prisma/client", "nodemailer"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
