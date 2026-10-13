import "server-only";
import { effectiveSites, visibleSiteIds, siteVisible, type SiteScope } from "@sam/core/lib/permissions/scope";
import { principalOf, type CurrentUser } from "@/lib/auth/authorize";

/** Sites the user can see for any of the capabilities: null means every site. */
export async function visibleSites(user: CurrentUser, ...keys: string[]): Promise<string[] | null> {
  const p = principalOf(user);
  const lists = await Promise.all(keys.map((k) => visibleSiteIds(p, k)));
  if (lists.some((l) => l === null)) return null;
  return [...new Set(lists.flatMap((l) => l ?? []))];
}

/** A site filter for queries: the site chosen in the UI, narrowed to what the user may see. */
export async function sitesFor(user: CurrentUser, keys: string | string[], chosen?: string | null): Promise<SiteScope> {
  return effectiveSites(await visibleSites(user, ...(Array.isArray(keys) ? keys : [keys])), chosen);
}

/** Whether a record's site is inside the user's scope for the capabilities. */
export async function canSeeSite(user: CurrentUser, keys: string | string[], siteId: string | null | undefined): Promise<boolean> {
  return siteVisible(await visibleSites(user, ...(Array.isArray(keys) ? keys : [keys])), siteId);
}
