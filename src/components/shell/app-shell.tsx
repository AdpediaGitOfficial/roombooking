import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth/authorize";
import { logout } from "@/app/login/actions";
import { visibleGroups } from "./nav";
import { SidebarNav } from "./sidebar-nav";

function roleLabel(role: string) {
  return role.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/** Navigation and account block for the signed-in user (dynamic: reads the session cookie). */
async function UserNav({ returnTo }: { returnTo: string }) {
  const user = await requireUser(returnTo);
  const roles = user.roleAssignments.map((r) => r.role);
  return (
    <>
      <SidebarNav groups={visibleGroups(roles)} />
      <div className="sidebar-note">
        <div className="truncate font-semibold text-[var(--text)]">{user.name}</div>
        <div className="truncate">{user.email}</div>
        <div className="mt-1">{[...new Set(roles)].map(roleLabel).join(", ") || "No roles"}</div>
        <form action={logout} className="mt-3">
          <button type="submit" className="btn btn-small">Sign out</button>
        </form>
      </div>
    </>
  );
}

const Brand = () => (
  <Link href="/" className="brand"><span className="brand-mark" aria-hidden="true">S</span>Accommodation</Link>
);

const navFallback = (
  <div className="nav" aria-hidden="true">
    {[0, 1, 2, 3, 4].map((i) => <div key={i} className="mx-3 my-3 h-4 animate-pulse rounded bg-zinc-100" />)}
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
        <main className="shell-main">{children}</main>
      </div>
    </div>
  );
}
