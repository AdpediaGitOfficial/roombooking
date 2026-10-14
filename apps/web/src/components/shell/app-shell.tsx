import Link from "next/link";
import { Suspense } from "react";
import { cache } from "react";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/auth/authorize";
import { logout } from "@/app/login/actions";
import { visibleGroups } from "./nav";
import { SidebarNav } from "./sidebar-nav";

/** One API call per request, however many shell parts need it. */
const getShell = cache(() => api.me.shell());

function roleLabel(role: string) {
  return role.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Navigation and account block for the signed-in user (dynamic: reads the session cookie). */
async function UserNav({ returnTo }: { returnTo: string }) {
  const user = await requireUser(returnTo);
  const roles = user.roleAssignments.map((r) => r.role);
  const { navCounts: counts } = await getShell();
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
  const { unread, siteNames } = await getShell();
  const scope = siteNames.length === 0 ? "All sites" : siteNames.length === 1 ? siteNames[0] : `${siteNames.length} sites`;
  return (
    <>
      <form action="/search" className="topbar-search" role="search">
        <span aria-hidden="true">⌕</span>
        <input type="search" name="q" placeholder="Search people, beds, tickets…" aria-label="Search" />
      </form>
      <div className="flex-1" />
      <span className="topbar-site" title="Your site scope"><small>Scope</small>{scope}</span>
      <Link href="/my" className="icbtn" aria-label={unread ? `${unread} unread notifications` : "Notifications"} title="Notifications">🔔{unread > 0 && <span className="dot" />}</Link>
      <span className="av av-primary" title={user.email}>{initials(user.name)}</span>
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
