import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser, userCan, userCanAccess } from "@/lib/auth/authorize";
import { chargesSummary, listBatches } from "@sam/core/modules/charges/service";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireUser("/charges/export");
  if (!userCanAccess(user, "charges.approve")) redirect("/forbidden");
  const [sum, batches] = await Promise.all([chargesSummary(), listBatches()]);
  const month = new Date().toISOString().slice(0, 7);
  return (
    <div className="max-w-xl space-y-4">
      <section className="card p-4"><p className="text-sm">{sum.approved} approved charge(s), {sum.approvedTotal.toFixed(2)} waiting to be exported.</p>
        {userCan(user, "charges.approve") && sum.approved > 0 && <form action="/api/charges/export" method="post" className="mt-3 flex items-end gap-2"><label className="text-sm">Payroll period<input name="period" defaultValue={month} pattern="\d{4}-\d{2}" className="mt-1 block rounded-md border border-zinc-300 px-3 py-2 text-sm" /></label><button className="btn btn-primary" type="submit">Export CSV</button></form>}
        <p className="mt-2 text-xs text-zinc-500">Exported charges are marked so they are never sent twice. The file is watermarked and the export is logged.</p></section>
      <section className="card p-4"><h3 className="font-medium">Previous batches</h3><ul className="mt-2 divide-y divide-zinc-100 text-sm">{batches.map((b) => <li key={b.id} className="flex justify-between py-1.5"><span>{b.period} · {b.rowCount} rows</span><span>{Number(b.total).toFixed(2)}</span></li>)}{batches.length === 0 && <li className="py-2 text-zinc-500">None yet.</li>}</ul></section>
    </div>
  );
}

export default function ExportPage() {
  return <main><PageHeader title="Payroll export" crumbs={[["Charges", "/charges"], ["Export"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
