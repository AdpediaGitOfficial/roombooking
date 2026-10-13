import "server-only";
import { prisma } from "@/lib/db";
import { ALL_ROLES, ROLE_DESCRIPTIONS } from "@/modules/admin/access";

export async function audienceOptions(organizationId: string) {
  const sites = await prisma.site.findMany({ where: { organizationId, status: "ACTIVE" }, include: { buildings: { where: { status: "ACTIVE" }, orderBy: { code: "asc" } } }, orderBy: { name: "asc" } });
  return {
    sites: sites.map((s) => ({ id: s.id, label: s.name })),
    buildings: sites.flatMap((s) => s.buildings.map((b) => ({ id: b.id, label: `${s.name} · ${b.name}`, siteId: s.id }))),
    roles: ALL_ROLES.map((r) => ({ id: r, label: r === "STAFF" ? "Residents (staff)" : r.toLowerCase().replaceAll("_", " "), hint: ROLE_DESCRIPTIONS[r] })),
  };
}
