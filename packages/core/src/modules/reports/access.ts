import type { Role } from "@prisma/client";
import { rolesWithAnyDefault, rolesWithDefault } from "../../lib/permissions/matrix";

/** May see the occupancy dashboard and operational (L2) reports. */
export const REPORT_VIEW_ROLES: Role[] = [
  ...new Set<Role>([...rolesWithDefault("rep.l1"), ...rolesWithDefault("rep.l2"), ...rolesWithDefault("rep.l3"), ...rolesWithAnyDefault("rep.l4")]),
].filter((r) => r !== "VENDOR" && r !== "SECURITY");

/** Audit log and exception reports (L4). */
export const AUDIT_VIEW_ROLES: Role[] = rolesWithAnyDefault("rep.l4");
