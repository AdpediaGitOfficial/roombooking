import Link from "next/link";
import { Suspense } from "react";
import { prisma } from "@sam/core/lib/db";
import { hasRole, requireUser, userCan, type CurrentUser } from "@/lib/auth/authorize";
import type { Role } from "@prisma/client";
import { ROLE_META } from "@sam/core/lib/permissions/roles";
import { logout } from "@/app/login/actions";
import { countUnreadNotifications } from "@sam/core/modules/self-service/service";
import { ALLOCATION_OPERATE_ROLES } from "@sam/core/modules/allocations/access";
import { APPROVALS_AREA_ROLES } from "@sam/core/modules/requests/access";
import { visibleGroups } from "./nav";
import { SidebarNav } from "./sidebar-nav";

function roleLabel(role: Role) {
  return ROLE_META[role].label;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Attention counts shown next to navigation entries, for the roles that act on them. */
async function navCounts(user: CurrentUser): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const jobs: Promise<void>[] = [];
  if (hasRole(user, ...ALLOCATION_OPERATE_ROLES)) {
    jobs.push(prisma.allocation.count({ where: { status: "CONFIRMED", startDate: { lt: new Date() } } }).then((n) => { if (n) counts["/accommodation/allocations"] = n; }));
  }
  if (hasRole(user, ...APPROVALS_AREA_ROLES)) {
    jobs.push(prisma.request.count({ where: { status: { in: ["SUBMITTED", "PENDING_APPROVAL", "RESUBMITTED"] } } }).then((n) => { if (n) counts["/approvals"] = n; }));
  }
  if (userCan(user, "maint.triage")) {
    jobs.push(prisma.workOrder.count({ where: { status: { in: ["NEW", "TRIAGED"] }, assigneeId: null, vendorId: null } }).then((n) => { if (n) counts["/maintenance"] = n; }));
  }
  await Promise.all(jobs);
  return counts;
}

/** Navigation and account block for the signed-in user (dynamic: reads the session cookie). */
async function UserNav({ returnTo }: { returnTo: string }) {
  const user = await requireUser(returnTo);
  const roles = user.roleAssignments.map((r) => r.role);
  const counts = await navCounts(user);
  return (
    <>
      <SidebarNav groups={visibleGroups(roles)} counts={counts} />
      <div className="sidebar-note">
        <div className="flex items-center" style={{ gap: 10 }}>
          <span className="av av-primary">{initials(user.name)}</span>
          <div className="min-w-0">
            <b className="block truncate">{user.name}</b>
            <span className="block truncate">{[...new Set(roles)].map(roleLabel).join(", ") || "No roles"}</span>
          </div>
        </div>
        <form action={logout} className="mt-3">
          <button type="submit" className="btn btn-small">Sign out</button>
        </form>
      </div>
    </>
  );
}

/** Top bar: search, site scope, notifications and the account. */
async function TopBar({ returnTo }: { returnTo: string }) {
  const user = await requireUser(returnTo);
  const siteIds = [...new Set(user.roleAssignments.map((r) => r.siteId).filter((id): id is string => !!id))];
  const [sites, unread] = await Promise.all([
    siteIds.length ? prisma.site.findMany({ where: { id: { in: siteIds } }, select: { name: true } }) : Promise.resolve([]),
    countUnreadNotifications(user.id),
  ]);
  const scope = sites.length === 0 ? "All sites" : sites.length === 1 ? sites[0].name : `${sites.length} sites`;
  return (
    <>
      <form action="/search" className="topbar-search" role="search">
        <span aria-hidden="true">⌕</span>
        <input type="search" name="q" placeholder="Search people, beds, tickets…" aria-label="Search" />
      </form>
      <div className="flex-1" />
      <span className="topbar-site" title="Your site scope"><small>Scope</small>{scope}</span>
      <Link href="/my" className="icbtn" aria-label={unread ? `${unread} unread notifications` : "Notifications"} title="Notifications">🔔{unread > 0 && <span className="dot" />}</Link>
      <span className="av av-primary" title={user.username}>{initials(user.name)}</span>
    </>
  );
}

const Brand = () => (
  <Link href="/" className="brand"><span className="brand-mark" aria-hidden="true">S</span>Accommodation</Link>
);

const navFallback = (
  <div className="nav" aria-hidden="true">
    {[0, 1, 2, 3, 4].map((i) => <div key={i} className="mx-3 my-3 h-4 animate-pulse rounded" style={{ background: "rgba(255,255,255,.08)" }} />)}
  </div>
);

/** Sidebar layout for the operational modules; the resident portal keeps its own phone layout. */
export function AppShell({ children, returnTo }: { children: React.ReactNode; returnTo: string }) {
  return (
    <div className="layout">
      <aside className="sidebar">
        <Brand />
        <Suspense fallback={navFallback}><UserNav returnTo={returnTo} /></Suspense>
      </aside>
      <div className="min-w-0">
        <details className="mobile-bar">
          <summary><span className="brand"><span className="brand-mark" aria-hidden="true">S</span>Accommodation</span><span className="btn btn-small">Menu</span></summary>
          <div className="px-3 pb-3"><Suspense fallback={navFallback}><UserNav returnTo={returnTo} /></Suspense></div>
        </details>
        <div className="topbar"><Suspense fallback={<div className="h-[34px]" />}><TopBar returnTo={returnTo} /></Suspense></div>
        <main className="shell-main">{children}</main>
      </div>
    </div>
  );
}
