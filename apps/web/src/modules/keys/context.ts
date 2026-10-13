import "server-only";
import { prisma } from "@sam/core/lib/db";

export async function staffOptions() {
  const staff = await prisma.staffProfile.findMany({ where: { employmentStatus: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
  return staff.map((s) => ({ id: s.id, label: `${s.lastName}, ${s.firstName} (${s.employeeId})` }));
}

export async function registerOptions() {
  const [sites, rooms, facilities] = await Promise.all([
    prisma.site.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
    prisma.room.findMany({ where: { status: { not: "INACTIVE" } }, include: { building: true }, orderBy: [{ building: { code: "asc" } }, { code: "asc" }] }),
    prisma.facility.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
  ]);
  return {
    sites: sites.map((s) => ({ id: s.id, label: s.name })),
    rooms: rooms.map((r) => ({ id: r.id, siteId: r.building.siteId, label: `${r.building.name} · Room ${r.code}` })),
    facilities: facilities.map((f) => ({ id: f.id, siteId: f.siteId, label: f.name })),
  };
}
