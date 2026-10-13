import { Suspense } from "react";
import Link from "next/link";
import { actorOf, requireUser, userCan, userCanAccess } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { listVisitors, type VisitorFilter } from "@sam/core/modules/security/service";
import { ActionForm } from "@/components/forms/action-form";
import { decideVisitorAction, preRegisterAction } from "@/modules/security/actions";
import { hostOptions, siteOptions } from "@/modules/security/context";
import { SecurityTabs } from "@/modules/security/tabs";
import { PageHeader } from "@/components/shell/page-header";

const FILTERS: Array<[VisitorFilter, string]> = [["today", "Today"], ["expected", "Expected"], ["inside", "Inside"], ["overstay", "Overstay"], ["pending", "Awaiting approval"], ["denied", "Denied today"], ["all", "All"]];

async function Content({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireUser("/security/visitors");
  const { filter: raw } = await searchParams;
  const filter = (FILTERS.some(([f]) => f === raw) ? raw : "today") as VisitorFilter;
  const sites = await visibleSites(user, "sec.checkin_visitors", "sec.verify_resident", "sec.approve_overnight", "sec.preregister");
  const rows = await listVisitors({ filter, siteIds: sites });
  const canRegister = userCanAccess(user, "sec.preregister") && !user.roleAssignments.every((r) => r.role === "STAFF");
  const [siteList, hosts] = canRegister ? await Promise.all([siteOptions(sites), hostOptions(sites)]) : [[], []];
  const canApprove = userCan(user, "sec.approve_overnight");
  void actorOf;
  return (
    <>
      <SecurityTabs user={user} active="visitors" />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="panel">
          <div className="toolbar"><nav className="flex flex-wrap gap-1.5">{FILTERS.map(([f, label]) => <Link key={f} href={`/security/visitors?filter=${f}`} className={`pill${f === filter ? " pill-on" : ""}`}>{label}</Link>)}</nav><span className="ml-auto text-xs text-zinc-500">{rows.length}</span></div>
          <table className="table">
            <thead><tr><th>Visitor</th><th>Kind</th><th>Host</th><th>When</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td><Link href={`/security/visitors/${v.id}`} className="font-medium underline">{v.name}</Link><span className="sub">{v.company ?? v.purpose ?? ""}</span></td>
                  <td>{v.kind.toLowerCase().replace("_", " ")}{v.nights ? ` · ${v.nights}n` : ""}</td><td>{v.hostName}</td>
                  <td className="tabular-nums">{v.expectedAt ? v.expectedAt.toISOString().slice(5, 16).replace("T", " ") : "—"}</td>
                  <td><span className={`chip ${v.status === "CHECKED_IN" ? (v.overstay ? "chip-danger" : "chip-success") : v.status === "DENIED" ? "chip-danger" : v.status.includes("PENDING") ? "chip-warning" : ""}`}>{v.status.toLowerCase().replace(/_/g, " ")}{v.overstay ? " · overstay" : ""}</span></td>
                  <td className="num">{canApprove && v.status === "PENDING_APPROVAL" && v.registeredById !== user.id && <ActionForm compact action={decideVisitorAction} hidden={{ visitorId: v.id, decision: "approve" }} submit="Approve" fields={[]} />}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-sm text-zinc-500">No visitors.</td></tr>}
            </tbody>
          </table>
        </section>
        {canRegister && <ActionForm action={preRegisterAction} title="Register a visitor for a resident" submit="Register" fields={[
          { name: "siteId", label: "Site", type: "select", options: siteList.map((s) => ({ value: s.id, label: s.name })) },
          { name: "hostStaffId", label: "Resident", type: "select", options: hosts.map((h) => ({ value: h.id, label: h.label })) },
          { name: "kind", label: "Kind", type: "select", options: [{ value: "DAY", label: "Day visitor" }, { value: "OVERNIGHT", label: "Overnight" }, { value: "RESTRICTED_AREA", label: "Restricted area" }] },
          { name: "name", label: "Visitor name", required: true }, { name: "phone", label: "Phone", type: "tel" }, { name: "idNumber", label: "ID number" },
          { name: "expectedAt", label: "Arrives", type: "datetime-local", required: true }, { name: "nights", label: "Nights (overnight)", type: "number", min: 1 }, { name: "restrictedArea", label: "Restricted area" }, { name: "purpose", label: "Purpose" },
        ]} />}
      </div>
    </>
  );
}

export default function VisitorsPage({ searchParams }: PageProps<"/security/visitors">) {
  return <main><PageHeader title="Visitors" subtitle="Day visitors within policy are approved automatically; overnight and restricted-area visitors need approval." crumbs={[["Security", "/security"], ["Visitors"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content searchParams={searchParams as Promise<{ filter?: string }>} /></Suspense></main>;
}
