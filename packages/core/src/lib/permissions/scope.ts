// Scope-based data (document principle 2): every list, record and report is
// filtered to the sites, buildings, jobs or self the viewer is assigned to.
import { prisma } from "../db";
import { dataScope, type Principal } from "./engine";

/** A site filter: one site, several sites (an empty list matches nothing), or null for every site. */
export type SiteScope = string | string[] | null | undefined;

/** Prisma `where` fragment for a column holding a site id. */
export function siteWhere(scope: SiteScope, column = "siteId"): Record<string, unknown> {
  if (scope === null || scope === undefined || scope === "") return {};
  if (Array.isArray(scope)) return { [column]: { in: scope } };
  return { [column]: scope };
}

/** The sites a principal can see for a capability: null means every site. Buildings resolve to their sites. */
export async function visibleSiteIds(principal: Principal, key: string): Promise<string[] | null> {
  const scope = dataScope(principal, key);
  if (scope.all) return null;
  const ids = new Set(scope.siteIds);
  if (scope.buildingIds.length) {
    for (const b of await prisma.building.findMany({ where: { id: { in: scope.buildingIds } }, select: { siteId: true } })) ids.add(b.siteId);
  }
  return [...ids];
}

/** Narrows a site chosen in the UI to the sites the viewer may see; a site outside the scope yields an empty set. */
export function effectiveSites(visible: string[] | null, chosen?: string | null): SiteScope {
  if (chosen) return visible === null || visible.includes(chosen) ? chosen : [];
  return visible;
}

/** Whether a record's site is inside the viewer's visible sites. */
export function siteVisible(visible: string[] | null, siteId: string | null | undefined): boolean {
  return visible === null || (!!siteId && visible.includes(siteId));
}
