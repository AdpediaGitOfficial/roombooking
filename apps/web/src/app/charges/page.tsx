import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, userCan, userCanAccess } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { chargesSummary, listCharges, type ChargeFilter } from "@sam/core/modules/charges/service";
import { ActionForm } from "@/components/forms/action-form";
import { decideChargeAction } from "@/modules/charges/actions";
import { PageHeader } from "@/components/shell/page-header";

const FILTERS: Array<[ChargeFilter, string]> = [["pending", "Awaiting approval"], ["approved", "Approved"], ["exported", "Exported"], ["all", "All"]];

async function Content({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireUser("/charges");
  if (!userCanAccess(user, "charges.raise") && !userCanAccess(user, "charges.approve") && !userCanAccess(user, "charges.rates")) redirect("/forbidden");
  const { filter: raw } = await searchParams;
  const filter = (FILTERS.some(([f]) => f === raw) ? raw : "pending") as ChargeFilter;
  const [rows, sum] = await Promise.all([listCharges({ filter, siteIds: await visibleSites(user, "charges.raise", "charges.approve") }), chargesSummary()]);
  const approve = userCan(user, "charges.approve");
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="kpi"><dt className="kpi-label">Awaiting approval</dt><dd className="kpi-value">{sum.pending}</dd></div><div className="kpi"><dt className="kpi-label">Approved, not exported</dt><dd className="kpi-value">{sum.approved}</dd></div><div className="kpi"><dt className="kpi-label">Approved value</dt><dd className="kpi-value">{sum.approvedTotal.toFixed(2)}</dd></div><div className="kpi"><dt className="kpi-label">Exported</dt><dd className="kpi-value">{sum.exported}</dd></div></dl>
      <section className="panel mt-4">
        <div className="toolbar"><nav className="flex flex-wrap gap-1.5">{FILTERS.map(([f, l]) => <Link key={f} href={`/charges?filter=${f}`} className={`pill${f === filter ? " pill-on" : ""}`}>{l}</Link>)}</nav></div>
        <ul className="divide-y divide-zinc-200">
          {rows.map((c) => (
            <li key={c.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2"><div><b>{c.payer}</b> <span className="chip">{c.kind.toLowerCase().replace("_", " ")}</span><div className="text-xs text-zinc-600">{c.description}{Number(c.quantity) !== 1 ? ` × ${Number(c.quantity)}` : ""} · {c.createdAt.toISOString().slice(0, 10)}</div></div><div className="text-right"><b>{Number(c.amount).toFixed(2)} {c.currency}</b><div className="text-xs">{c.status.toLowerCase().replace("_", " ")}</div></div></div>
              {approve && c.status === "PENDING_APPROVAL" && c.raisedById !== user.id && <div className="mt-2 grid gap-2 sm:grid-cols-2"><ActionForm compact action={decideChargeAction} hidden={{ chargeId: c.id, decision: "approve" }} submit="Approve" /><ActionForm compact tone="secondary" action={decideChargeAction} hidden={{ chargeId: c.id, decision: "waive" }} submit="Waive" fields={[{ name: "note", label: "Reason", required: true }]} /></div>}
            </li>
          ))}
          {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-500">No charges.</li>}
        </ul>
      </section>
    </>
  );
}

export default function ChargesPage({ searchParams }: PageProps<"/charges">) {
  return <main><PageHeader title="Charges" subtitle="Damage, fees and rent recorded by the front desk, approved by a different Admin, then exported to payroll." crumbs={[["Charges"]]} actions={<><Link href="/charges/new" className="btn">Record a charge</Link><Link href="/charges/rates" className="btn">Rates</Link><Link href="/charges/export" className="btn">Payroll export</Link></>} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content searchParams={searchParams as Promise<{ filter?: string }>} /></Suspense></main>;
}
