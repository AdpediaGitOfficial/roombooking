import { Suspense } from "react";
import { listParcels } from "@sam/core/modules/security/service";
import { requireResident } from "@/modules/self-service/context";

async function Content() {
  const { staff } = await requireResident("/my/parcels");
  const rows = staff ? await listParcels({ staffId: staff.id }) : [];
  return <ul className="mt-4 divide-y divide-zinc-200 card">{rows.map((p) => <li key={p.id} className="flex justify-between gap-3 p-3 text-sm"><span><b>{p.carrier ?? "Parcel"}</b><span className="block text-xs text-zinc-500">{p.reference ?? ""} · {p.receivedAt.toISOString().slice(0, 10)}</span></span><span className={`chip ${p.status === "COLLECTED" ? "chip-success" : "chip-warning"}`}>{p.status === "COLLECTED" ? "collected" : "collect from reception"}</span></li>)}{rows.length === 0 && <li className="p-4 text-sm text-zinc-500">No parcels.</li>}</ul>;
}

export default function MyParcelsPage() {
  return <main><h1 className="page-title">Parcels</h1><Suspense fallback={<p className="mt-4 text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
