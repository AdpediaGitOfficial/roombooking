import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/authorize";
import { userCan, userCanAccess } from "@/lib/auth/authorize";

export function SecurityTabs({ user, active }: { user: CurrentUser; active: string }) {
  const tabs: Array<[string, string, string, boolean]> = [
    ["gate", "/security", "Gate", userCanAccess(user, "sec.verify_resident") || userCanAccess(user, "sec.checkin_visitors")],
    ["visitors", "/security/visitors", "Visitors", true],
    ["incidents", "/security/incidents", "Incidents", userCanAccess(user, "sec.incident_report")],
    ["parcels", "/security/parcels", "Parcels", userCanAccess(user, "sec.parcels")],
    ["sos", "/security/sos", "SOS", userCanAccess(user, "sec.sos_respond")],
    ["patrol", "/security/patrol", "Patrols", userCanAccess(user, "sec.patrol")],
    ["restricted", "/security/restricted", "Restricted list", userCanAccess(user, "sec.restricted_view")],
    ["policy", "/security/policy", "Visitor policy", userCan(user, "sec.visitor_policy")],
  ];
  return <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Security sections">{tabs.filter((t) => t[3]).map(([k, href, label]) => <Link key={k} href={href} className={`pill${k === active ? " pill-on" : ""}`}>{label}</Link>)}</nav>;
}
