"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavGroup } from "./nav";

/** Nav groups with the active entry derived from the current path (longest matching href wins). */
export function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  const active = hrefs.filter((h) => pathname === h || pathname.startsWith(h + "/")).sort((a, b) => b.length - a.length)[0];
  return (
    <>
      {groups.map((g) => (
        <div key={g.label} className="nav">
          <div className="nav-label">{g.label}</div>
          {g.items.map((i) => (
            <Link key={i.href} href={i.href} className={i.href === active ? "active" : undefined} aria-current={i.href === active ? "page" : undefined}>
              <span className="ico" aria-hidden="true">{i.icon}</span>
              {i.label}
            </Link>
          ))}
        </div>
      ))}
    </>
  );
}
