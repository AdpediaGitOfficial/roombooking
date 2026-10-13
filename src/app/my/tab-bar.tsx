"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV = [
  ["/my", "Home"],
  ["/my/stay", "My stay"],
  ["/my/requests", "Requests"],
  ["/my/maintenance", "Maintenance"],
  ["/my/facilities", "Facilities"],
  ["/my/profile", "Profile"],
] as const;

export function TabLinks({ active }: { active?: string }) {
  return (
    <nav aria-label="Staff navigation" className="tabbar">
      <ul className="mx-auto flex max-w-md">
        {NAV.map(([href, label]) => (
          <li key={href} className="min-w-0 flex-1">
            <Link href={href} className={href === active ? "active" : undefined} aria-current={href === active ? "page" : undefined}>{label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Bottom tabs with the current section highlighted (reads the path, so it renders inside Suspense). */
export function TabBar() {
  const pathname = usePathname();
  const active = NAV.map(([h]) => h).filter((h) => pathname === h || pathname.startsWith(h + "/")).sort((a, b) => b.length - a.length)[0];
  return <TabLinks active={active} />;
}
