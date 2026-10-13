import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser, userCan, userCanAccess } from "@/lib/auth/authorize";
import { RATE_KINDS, listRates } from "@sam/core/modules/charges/service";
import { ActionForm } from "@/components/forms/action-form";
import { deactivateRateAction, setRateAction } from "@/modules/charges/actions";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireUser("/charges/rates");
  if (!userCanAccess(user, "charges.rates")) redirect("/forbidden");
  const rates = await listRates();
  const edit = userCan(user, "charges.rates");
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <section className="panel"><ul className="divide-y divide-zinc-200">{rates.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"><div><b>{r.name}</b> <span className="chip">{r.kind.toLowerCase().replace("_", " ")}</span> <span className="text-xs text-zinc-500">{r.code}</span></div><div className="flex items-center gap-3"><b>{Number(r.amount).toFixed(2)} {r.currency} / {r.unit}</b>{edit && <ActionForm compact tone="secondary" action={deactivateRateAction} hidden={{ rateId: r.id }} submit="Remove" />}</div></li>)}{rates.length === 0 && <li className="px-4 py-6 text-center text-zinc-500">No rates yet.</li>}</ul></section>
      {edit ? <ActionForm action={setRateAction} title="Add or update a rate" submit="Save rate" fields={[{ name: "kind", label: "Kind", type: "select", options: RATE_KINDS.map((k) => ({ value: k, label: k.toLowerCase().replace("_", " ") })) }, { name: "code", label: "Code", required: true, placeholder: "DOOR" }, { name: "name", label: "Name", required: true }, { name: "amount", label: "Amount", type: "number", step: "0.01", required: true }, { name: "unit", label: "Unit", defaultValue: "each" }]} /> : <p className="text-sm text-zinc-500">Rate setup needs the Admin overrides grant.</p>}
    </div>
  );
}

export default function RatesPage() {
  return <main><PageHeader title="Charge rates" subtitle="Room rent, facility fees and the damage rate card." crumbs={[["Charges", "/charges"], ["Rates"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
