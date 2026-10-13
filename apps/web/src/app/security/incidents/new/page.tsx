import { Suspense } from "react";
import { requireCapability } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { INCIDENT_CATEGORIES } from "@sam/core/modules/security/service";
import { ActionForm } from "@/components/forms/action-form";
import { incidentAction } from "@/modules/security/actions";
import { siteOptions } from "@/modules/security/context";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireCapability("sec.incident_report", { returnTo: "/security/incidents/new" });
  const sites = await siteOptions(await visibleSites(user, "sec.incident_report"));
  return <div className="max-w-2xl"><ActionForm action={incidentAction} submit="Report incident" fields={[
    { name: "siteId", label: "Site", type: "select", options: sites.map((s) => ({ value: s.id, label: s.name })) },
    { name: "category", label: "Category", type: "select", options: INCIDENT_CATEGORIES.map((c) => ({ value: c, label: c })) },
    { name: "severity", label: "Severity", type: "select", defaultValue: "MEDIUM", options: ["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => ({ value: s, label: s.toLowerCase() })) },
    { name: "location", label: "Where" },
    { name: "description", label: "What happened", type: "textarea", required: true },
  ]} /></div>;
}

export default function NewIncidentPage() {
  return <main><PageHeader title="Report an incident" crumbs={[["Security", "/security"], ["Incidents", "/security/incidents"], ["New"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
