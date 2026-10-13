import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/authorize";
import { userCan } from "@/lib/auth/authorize";

export function KeyTabs({ user, active }: { user: CurrentUser; active: string }) {
  const tabs: Array<[string, string, string, boolean]> = [
    ["register", "/keys", "Key register", true],
    ["losses", "/keys/losses", "Lost keys", userCan(user, "keys.loss_approve") || userCan(user, "keys.report_lost")],
    ["audit", "/keys/audit", "Audit", userCan(user, "keys.audit")],
    ["bulk", "/keys/bulk", "Bulk create", userCan(user, "keys.bulk_create")],
  ];
  return <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Key sections">{tabs.filter((t) => t[3]).map(([k, href, label]) => <Link key={k} href={href} className={`pill${k === active ? " pill-on" : ""}`}>{label}</Link>)}</nav>;
}
