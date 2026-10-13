import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { actorOf, requireUser, userCanAccess } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { listIncidents } from "@sam/core/modules/security/service";
import { SecurityTabs } from "@/modules/security/tabs";
import { PageHeader } from "@/components/shell/page-header";

const SEV: Record<string, string> = { LOW: "", MEDIUM: "chip-info", HIGH: "chip-warning", CRITICAL: "chip-danger" };

async function Content() {
  const user = await requireUser("/security/incidents");
  if (!userCanAccess(user, "sec.incident_report") && !userCanAccess(user, "sec.incident_manage")) redirect("/forbidden");
  const rows = await listIncidents(actorOf(user), { siteIds: await visibleSites(user, "sec.incident_report", "sec.incident_manage") });
  return (
    <>
      <SecurityTabs user={user} active="incidents" />
      <section className="panel">
        <table className="table">
          <thead><tr><th>Reference</th><th>Category</th><th>Severity</th><th>Status</th><th>Reported</th></tr></thead>
          <tbody>
            {rows.map((i) => <tr key={i.id}><td><Link href={`/security/incidents/${i.id}`} className="font-medium underline">{i.reference}</Link><span className="sub">{i.location ?? ""}</span></td><td>{i.category}<span className="sub max-w-xs truncate">{i.description}</span></td><td><span className={`chip ${SEV[i.severity]}`}>{i.severity.toLowerCase()}</span></td><td>{i.status.toLowerCase().replace(/_/g, " ")}</td><td className="tabular-nums">{i.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td></tr>)}
            {rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-sm text-zinc-500">No incidents.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}

export default function IncidentsPage() {
  return <main><PageHeader title="Incidents" subtitle="Reported, under review, action taken, closed (by an Admin who did not report it)." crumbs={[["Security", "/security"], ["Incidents"]]} actions={<Link href="/security/incidents/new" className="btn btn-primary">＋ Report an incident</Link>} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
