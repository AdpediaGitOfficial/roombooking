import { Suspense } from "react";
import { prisma } from "@sam/core/lib/db";
import { requireCapability } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { listKeyAudits } from "@sam/core/modules/keys/extras";
import { ActionForm } from "@/components/forms/action-form";
import { auditCompleteAction, auditStartAction } from "@/modules/keys/extras-actions";
import { KeyTabs } from "@/modules/keys/components/tabs";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireCapability("keys.audit", { returnTo: "/keys/audit", level: "access" });
  const visible = await visibleSites(user, "keys.audit");
  const [audits, sites] = await Promise.all([listKeyAudits(visible), prisma.site.findMany({ where: { archivedAt: null, ...(visible ? { id: { in: visible } } : {}) }, select: { id: true, name: true } })]);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  return (
    <>
      <KeyTabs user={user} active="audit" />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <ul className="space-y-3">
          {audits.map((a) => {
            const v = a.variances as { missing: string[]; unexpected: Array<{ code: string; recorded: string }>; matched: number } | null;
            return (
              <li key={a.id} className="card p-4 text-sm">
                <div className="flex justify-between"><b>{siteName.get(a.siteId) ?? "Site"} · {a.startedAt.toISOString().slice(0, 16).replace("T", " ")}</b><span className="chip">{a.status.toLowerCase().replace("_", " ")}</span></div>
                {a.status === "IN_PROGRESS" ? (
                  <div className="mt-3"><ActionForm compact action={auditCompleteAction} hidden={{ auditId: a.id }} submit="Complete audit" intro={`${(a.expected as unknown[]).length} keys are on the register. Enter the codes of the keys physically in the cabinet.`} fields={[{ name: "codes", label: "Key codes found (separated by spaces, commas or lines)", type: "textarea", required: true }]} /></div>
                ) : v && (
                  <div className="mt-2 text-zinc-700">{v.matched} matched · {v.missing.length} missing{v.missing.length ? `: ${v.missing.join(", ")}` : ""} · {v.unexpected.length} unexpected{v.unexpected.length ? `: ${v.unexpected.map((u) => `${u.code} (${u.recorded.toLowerCase()})`).join(", ")}` : ""}</div>
                )}
              </li>
            );
          })}
          {audits.length === 0 && <li className="card p-6 text-center text-sm text-zinc-500">No audits yet.</li>}
        </ul>
        <ActionForm action={auditStartAction} title="Start an audit" intro="Takes a snapshot of the register to reconcile against what is in the cabinet." submit="Start audit" fields={[{ name: "siteId", label: "Site", type: "select", options: sites.map((s) => ({ value: s.id, label: s.name })) }]} />
      </div>
    </>
  );
}

export default function KeyAuditPage() {
  return <main><PageHeader title="Key audit" subtitle="Reconcile the register with the keys physically in the cabinet." crumbs={[["Keys", "/keys"], ["Audit"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
