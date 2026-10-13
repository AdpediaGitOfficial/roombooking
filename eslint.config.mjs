import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { settings: { next: { rootDir: ["apps/web"] } } },
  {
    // The web app is a client of the API: it may share pure rules, role lists and types with the
    // core package, but never reach the database or a data service directly.
    files: ["apps/web/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Everything in the core package except pure rules (access, rules, *-rules, forms, errors) and time helpers.
              regex: "^@sam/core/(?!modules/[^/]+/(access|rules|[a-z-]+-rules|forms|errors)$|lib/time$)",
              allowTypeImports: true,
              message: "The web app talks to the API. Call api.<module>.<operation>() from @/lib/api, or import only pure rules (access, rules, errors, forms) from @sam/core.",
            },
            { group: ["@sam/api", "@sam/api/**", "@sam/worker", "@sam/worker/**"], message: "The web app must not depend on the API or worker packages." },
          ],
          paths: [{ name: "@prisma/client", allowTypeImports: true, message: "Import types only; the web app has no database access." }],
        },
      ],
    },
  },
  globalIgnores([
    "**/.next/**",
    "**/node_modules/**",
    "**/dist/**",
    "**/.cache/**",
    "**/next-env.d.ts",
    "out/**",
    "build/**",
  ]),
]);

export default eslintConfig;
