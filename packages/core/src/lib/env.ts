import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Loads the repository's root `.env` into process.env (without overriding
 * variables that are already set). Services started from a workspace folder
 * (api, worker, tests) call this once at start-up so one `.env` configures
 * every service in development; in production the environment is set by the
 * process manager and no file is needed.
 */
export function loadRootEnv(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate) && existsSync(path.join(dir, "package.json")) && existsSync(path.join(dir, "packages"))) {
      try { process.loadEnvFile(candidate); } catch { /* unreadable file: rely on the real environment */ }
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The repository root (the folder holding the workspaces), or the working directory when not found. */
export function repoRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "package.json")) && existsSync(path.join(dir, "packages")) && existsSync(path.join(dir, "apps"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir);
}
