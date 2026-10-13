import { Suspense } from "react";
import { myCharges } from "@sam/core/modules/charges/service";
import { requireResident } from "@/modules/self-service/context";

async function Content() {
  const { staff } = await requireResident("/my/charges");
  const rows = staff ? await myCharges(staff.id) : [];
  return <ul className="mt-4 divide-y divide-zinc-200 card">{rows.map((c) => <li key={c.id} className="flex justify-between gap-3 p-3 text-sm"><span><b>{c.description}</b><span className="block text-xs text-zinc-500">{c.createdAt.toISOString().slice(0, 10)} · {c.status.toLowerCase().replace("_", " ")}</span></span><b>{Number(c.amount).toFixed(2)} {c.currency}</b></li>)}{rows.length === 0 && <li className="p-4 text-sm text-zinc-500">No charges.</li>}</ul>;
}

export default function MyChargesPage() {
  return <main><h1 className="page-title">Charges</h1><Suspense fallback={<p className="mt-4 text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
