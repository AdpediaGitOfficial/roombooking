// Pure user-administration shapes and labels. No database access, so the web
// app and the API can both import this file.
import type { Prisma, Role } from "@prisma/client";

export const userInclude = {
  roleAssignments: { include: { site: { select: { id: true, name: true } }, building: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
  staffProfile: { select: { id: true, employeeId: true, firstName: true, lastName: true, department: true } },
  vendor: { select: { id: true, name: true } },
  _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } } },
} satisfies Prisma.UserInclude;

export type UserRecord = Prisma.UserGetPayload<{ include: typeof userInclude }>;
export type RoleGrant = { role: Role; siteId?: string | null; buildingId?: string | null };

export function scopeLabel(a: { site?: { name: string } | null; building?: { name: string } | null }): string {
  if (a.building) return a.building.name;
  if (a.site) return a.site.name;
  return "All sites";
}
