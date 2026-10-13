import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/authorize";
import { userCan, userCanAccess } from "@/lib/auth/authorize";

/** The maintenance area's sections, each shown only to the roles that can use it. */
export function MaintenanceTabs({ user, active }: { user: CurrentUser; active: string }) {
  const tabs: Array<[string, string, boolean]> = [
    ["queue", "Work orders", true],
    ["board", "Assignment board", userCan(user, "maint.triage")],
    ["approvals", "Cost approvals", userCan(user, "maint.cost_within") || userCan(user, "maint.cost_above")],
    ["permits", "Permits", userCan(user, "maint.permit")],
    ["preventive", "Preventive", userCan(user, "maint.preventive")],
    ["vendors", "Vendors", userCanAccess(user, "maint.vendor_create") || userCanAccess(user, "maint.rate_card") || userCan(user, "maint.workers")],
    ["visits", "Contractor visits", userCan(user, "maint.triage") || userCan(user, "maint.workers")],
  ];
  const href = (k: string) => (k === "queue" ? "/maintenance" : `/maintenance/${k}`);
  return (
    <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Maintenance sections">
      {tabs.filter(([, , show]) => show).map(([k, label]) => <Link key={k} href={href(k)} className={`pill${k === active ? " pill-on" : ""}`}>{label}</Link>)}
    </nav>
  );
}
