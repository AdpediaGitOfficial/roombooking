import "server-only";
import { prisma } from "@/lib/db";

export type Opt = { id: string; label: string };

/** Destinations an item can be issued to. */
export async function targetOptions(): Promise<{ rooms: Opt[]; staff: Opt[]; facilities: Opt[]; sites: Opt[] }> {
  const [rooms, staff, facilities, sites] = await Promise.all([
    prisma.room.findMany({ where: { status: { not: "INACTIVE" } }, include: { building: { include: { site: { select: { name: true } } } } }, orderBy: [{ building: { code: "asc" } }, { code: "asc" }] }),
    prisma.staffProfile.findMany({ where: { employmentStatus: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
    prisma.facility.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
    prisma.site.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
  ]);
  return {
    rooms: rooms.map((r) => ({ id: r.id, label: `${r.building.name} · Room ${r.code}` })),
    staff: staff.map((s) => ({ id: s.id, label: `${s.lastName}, ${s.firstName} (${s.employeeId})` })),
    facilities: facilities.map((f) => ({ id: f.id, label: f.name })),
    sites: sites.map((s) => ({ id: s.id, label: s.name })),
  };
}
