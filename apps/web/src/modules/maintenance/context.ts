import "server-only";
import { prisma } from "@sam/core/lib/db";
import type { CurrentUser } from "@/lib/auth/authorize";
import type { Actor } from "@sam/core/modules/maintenance/service";

export function actorOf(user: CurrentUser): Actor {
  return { id: user.id, roles: user.roleAssignments.map((r) => r.role), vendorId: user.vendorId };
}

/** Rooms a resident can report against: their current bed's room. */
export async function residentRoomOptions(userId: string) {
  const staff = await prisma.staffProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!staff) return [];
  const allocations = await prisma.allocation.findMany({
    where: { staffId: staff.id, status: { in: ["CONFIRMED", "CHECKED_IN"] } },
    include: { bed: { include: { room: { include: { building: true } } } } },
    orderBy: { startDate: "desc" },
  });
  const seen = new Set<string>();
  return allocations.flatMap((a) => {
    const room = a.bed.room;
    if (seen.has(room.id)) return [];
    seen.add(room.id);
    return [{ id: room.id, label: `My room · ${room.building.name} room ${room.code}` }];
  });
}

export async function allRoomOptions() {
  const rooms = await prisma.room.findMany({ where: { status: { not: "INACTIVE" } }, include: { building: true }, orderBy: [{ building: { code: "asc" } }, { code: "asc" }] });
  return rooms.map((r) => ({ id: r.id, label: `${r.building.name} · Room ${r.code}` }));
}

export async function buildingOptions() {
  const buildings = await prisma.building.findMany({ where: { status: "ACTIVE" }, include: { site: true }, orderBy: [{ site: { name: "asc" } }, { code: "asc" }] });
  return buildings.map((b) => ({ id: b.id, label: `${b.site.name} · ${b.name}` }));
}
