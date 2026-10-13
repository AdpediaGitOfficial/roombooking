import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@sam/core/lib/db";
import { canSeeSite } from "@/lib/auth/scope";
import type { CurrentUser } from "@/lib/auth/authorize";

export type EntityKind = "allocation" | "bed" | "room" | "building" | "key" | "inventoryItem" | "facility" | "booking" | "lostFoundItem" | "lostFoundClaim";

async function siteOf(kind: EntityKind, id: string): Promise<string | null> {
  switch (kind) {
    case "allocation": return (await prisma.allocation.findUnique({ where: { id }, select: { bed: { select: { room: { select: { building: { select: { siteId: true } } } } } } } }))?.bed.room.building.siteId ?? null;
    case "bed": return (await prisma.bed.findUnique({ where: { id }, select: { room: { select: { building: { select: { siteId: true } } } } } }))?.room.building.siteId ?? null;
    case "room": return (await prisma.room.findUnique({ where: { id }, select: { building: { select: { siteId: true } } } }))?.building.siteId ?? null;
    case "building": return (await prisma.building.findUnique({ where: { id }, select: { siteId: true } }))?.siteId ?? null;
    case "key": return (await prisma.key.findUnique({ where: { id }, select: { siteId: true } }))?.siteId ?? null;
    case "inventoryItem": return (await prisma.inventoryItem.findUnique({ where: { id }, select: { siteId: true } }))?.siteId ?? null;
    case "facility": return (await prisma.facility.findUnique({ where: { id }, select: { siteId: true } }))?.siteId ?? null;
    case "booking": return (await prisma.facilityBooking.findUnique({ where: { id }, select: { facility: { select: { siteId: true } } } }))?.facility.siteId ?? null;
    case "lostFoundItem": return (await prisma.lostFoundItem.findUnique({ where: { id }, select: { siteId: true } }))?.siteId ?? null;
    case "lostFoundClaim": return (await prisma.lostFoundClaim.findUnique({ where: { id }, select: { item: { select: { siteId: true } } } }))?.item.siteId ?? null;
  }
}

/**
 * The API enforces the same scope the UI shows (document principle 7): an action that names a record
 * outside the user's assigned sites is refused, whatever the form claims. Unknown ids pass through to the
 * service, which reports "not found" itself.
 */
export async function guardScope(user: CurrentUser, keys: string | string[], formData: FormData, fields: Array<[field: string, kind: EntityKind]>) {
  for (const [field, kind] of fields) {
    const id = formData.get(field);
    if (typeof id !== "string" || !id) continue;
    const siteId = await siteOf(kind, id);
    if (siteId && !(await canSeeSite(user, keys, siteId))) redirect("/forbidden");
  }
}
