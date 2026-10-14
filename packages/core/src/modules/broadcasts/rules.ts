// Pure broadcast rules: audience shape and parsing, limits and labels. No
// database access, so the web app and the API can both import this file.
import type { BroadcastStatus, Role } from "@prisma/client";
import { ALL_ROLES } from "../admin/access";

export type Audience = { roles: Role[]; siteIds: string[]; buildingIds: string[] };
export const TITLE_MAX = 120;
export const BODY_MAX = 2000;

export function parseAudience(raw: unknown): Audience {
  const o = (raw ?? {}) as Partial<Record<keyof Audience, unknown>>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : []);
  return { roles: list(o.roles).filter((r): r is Role => (ALL_ROLES as string[]).includes(r)), siteIds: list(o.siteIds), buildingIds: list(o.buildingIds) };
}

export function describeStatus(status: BroadcastStatus): string {
  return { DRAFT: "Draft", SENT: "Sent", CANCELLED: "Cancelled" }[status];
}
