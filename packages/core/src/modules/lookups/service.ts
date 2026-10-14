// Pick-lists shared by several screens. Each returns just ids and labels.
import { prisma } from "../../lib/db";

export async function staffOptions() {
  const staff = await prisma.staffProfile.findMany({ where: { employmentStatus: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
  return staff.map((s) => ({ id: s.id, userId: s.userId, label: `${s.lastName}, ${s.firstName} (${s.employeeId})` }));
}

export async function siteOptions() {
  const sites = await prisma.site.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } });
  return sites.map((s) => ({ id: s.id, label: s.name }));
}
