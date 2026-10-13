import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser, userCan, userCanAccess } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { listParcels } from "@sam/core/modules/security/service";
import { ActionForm } from "@/components/forms/action-form";
import { collectParcelAction, parcelAction } from "@/modules/security/actions";
import { hostOptions, siteOptions } from "@/modules/security/context";
import { SecurityTabs } from "@/modules/security/tabs";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireUser("/security/parcels");
  if (!userCanAccess(user, "sec.parcels")) redirect("/forbidden");
  const sites = await visibleSites(user, "sec.parcels");
  const [rows, siteList, hosts] = await Promise.all([listParcels({ siteIds: sites }), siteOptions(sites), hostOptions(sites)]);
  const canLog = userCan(user, "sec.parcels");
  return (
    <>
      <SecurityTabs user={user} active="parcels" />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <section className="panel">
          <ul className="divide-y divide-zinc-200">
            {rows.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div><b>{p.recipient}</b> <span className={`chip ${p.status === "COLLECTED" ? "chip-success" : "chip-warning"}`}>{p.status.toLowerCase()}</span><div className="text-xs text-zinc-500">{p.carrier ?? "Parcel"}{p.reference ? ` · ${p.reference}` : ""} · received {p.receivedAt.toISOString().slice(0, 16).replace("T", " ")}{p.collectedAt ? ` · collected ${p.collectedAt.toISOString().slice(0, 16).replace("T", " ")}` : ""}</div></div>
                {canLog && p.status !== "COLLECTED" && <ActionForm compact action={collectParcelAction} hidden={{ parcelId: p.id }} submit="Hand over" fields={[{ name: "name", label: "Collected by" }]} />}
              </li>
            ))}
            {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-500">No parcels.</li>}
          </ul>
        </section>
        {canLog && <ActionForm action={parcelAction} title="Log a parcel" submit="Log parcel" fields={[{ name: "siteId", label: "Site", type: "select", options: siteList.map((s) => ({ value: s.id, label: s.name })) }, { name: "staffId", label: "Resident", type: "select", options: [{ value: "", label: "Not a listed resident" }, ...hosts.map((h) => ({ value: h.id, label: h.label }))] }, { name: "recipientName", label: "Or recipient name" }, { name: "carrier", label: "Carrier" }, { name: "reference", label: "Reference" }, { name: "notes", label: "Notes" }]} />}
      </div>
    </>
  );
}

export default function ParcelsPage() {
  return <main><PageHeader title="Parcels" subtitle="Log, notify the resident, hand over." crumbs={[["Security", "/security"], ["Parcels"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
