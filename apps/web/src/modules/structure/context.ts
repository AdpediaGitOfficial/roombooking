import "server-only";
import type { MasterKind } from "@prisma/client";
import { prisma } from "@sam/core/lib/db";

const DEFAULTS: Partial<Record<MasterKind, Array<{ code: string; name: string }>>> = {
  PROPERTY_TYPE: [{ code: "VILLA_COMPOUND", name: "Villa compound" }, { code: "APARTMENT", name: "Apartment" }, { code: "HOSTEL", name: "Hostel / dorm" }],
  ROOM_TYPE: [{ code: "SINGLE", name: "Single" }, { code: "DOUBLE", name: "Double" }, { code: "TRIPLE", name: "Triple" }, { code: "DORM", name: "Dormitory" }, { code: "SUITE", name: "Suite" }],
  BED_TYPE: [{ code: "SINGLE", name: "Single bed" }, { code: "BUNK_TOP", name: "Bunk (top)" }, { code: "BUNK_BOTTOM", name: "Bunk (bottom)" }, { code: "DOUBLE", name: "Double bed" }],
};

/** Configured masters of a kind, or the built-in defaults until the Super Admin sets their own. */
export async function masterOptions(organizationId: string, kind: MasterKind, siteId?: string | null) {
  const rows = await prisma.masterItem.findMany({ where: { organizationId, kind, status: "ACTIVE", ...(siteId ? { OR: [{ siteId: null }, { siteId }] } : {}) }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { code: true, name: true } });
  return rows.length ? rows : (DEFAULTS[kind] ?? []);
}
