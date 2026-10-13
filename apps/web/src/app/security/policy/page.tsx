import { Suspense } from "react";
import { requireCapability } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { visitorPolicy } from "@sam/core/modules/security/service";
import { ActionForm } from "@/components/forms/action-form";
import { policyAction } from "@/modules/security/actions";
import { siteOptions } from "@/modules/security/context";
import { SecurityTabs } from "@/modules/security/tabs";
import { PageHeader } from "@/components/shell/page-header";

async function Content({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const user = await requireCapability("sec.visitor_policy", { returnTo: "/security/policy" });
  const sites = await siteOptions(await visibleSites(user, "sec.visitor_policy"));
  const { site } = await searchParams;
  const siteId = sites.find((s) => s.id === site)?.id ?? sites[0]?.id;
  const p = siteId ? await visitorPolicy(siteId) : null;
  return (
    <>
      <SecurityTabs user={user} active="policy" />
      <nav className="mb-3 flex gap-2">{sites.map((s) => <a key={s.id} href={`/security/policy?site=${s.id}`} className={`pill${s.id === siteId ? " pill-on" : ""}`}>{s.name}</a>)}</nav>
      {p && siteId && <div className="max-w-xl"><ActionForm key={siteId} action={policyAction} hidden={{ siteId }} title="Visitor policy" submit="Save policy" fields={[
        { name: "dayVisitorsAllowed", label: "Day visitors allowed", type: "checkbox", defaultValue: p.dayVisitorsAllowed }, { name: "overnightAllowed", label: "Overnight visitors allowed", type: "checkbox", defaultValue: p.overnightAllowed }, { name: "requireIdAtGate", label: "Record ID for walk-ins", type: "checkbox", defaultValue: p.requireIdAtGate },
        { name: "maxDayHours", label: "Longest day visit (hours)", type: "number", defaultValue: p.maxDayHours }, { name: "maxNights", label: "Most nights", type: "number", defaultValue: p.maxNights }, { name: "maxActivePerHost", label: "Visitors per resident at once", type: "number", defaultValue: p.maxActivePerHost }, { name: "curfewHour", label: "Curfew hour (UTC, 0-23, blank for none)", type: "number", min: 0, max: 23, defaultValue: p.curfewHour ?? "" },
      ]} /></div>}
    </>
  );
}

export default function PolicyPage({ searchParams }: PageProps<"/security/policy">) {
  return <main><PageHeader title="Visitor policy" subtitle="Limits per site: who can visit, for how long and how many at once." crumbs={[["Security", "/security"], ["Visitor policy"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content searchParams={searchParams as Promise<{ site?: string }>} /></Suspense></main>;
}
