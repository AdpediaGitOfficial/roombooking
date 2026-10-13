import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser, userCan, userCanAccess } from "@/lib/auth/authorize";
import { getVendor } from "@sam/core/modules/maintenance/extras";
import { MaintenanceError } from "@sam/core/modules/maintenance/errors";
import { ActionForm } from "@/components/forms/action-form";
import { rateAction, vendorDocumentAction, vendorStateAction, vendorUpdateAction, verifyDocumentAction, workerAddAction, workerStatusAction, workerVerifyAction } from "@/modules/maintenance/extras-actions";
import { MaintenanceTabs } from "@/modules/maintenance/components/tabs";
import { PageHeader } from "@/components/shell/page-header";
import { CATEGORIES } from "@sam/core/modules/maintenance/service";

const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "");

async function Content({ params }: { params: Promise<{ vendorId: string }> }) {
  const { vendorId } = await params;
  const user = await requireUser(`/maintenance/vendors/${vendorId}`);
  const own = user.vendorId === vendorId;
  if (!own && !userCanAccess(user, "maint.vendor_create") && !userCanAccess(user, "maint.rate_card") && !userCan(user, "maint.workers")) redirect("/forbidden");
  const data = await getVendor(vendorId).catch((e) => { if (e instanceof MaintenanceError && e.code === "NOT_FOUND") notFound(); throw e; });
  const { vendor: v, documents, rates, workers } = data;
  const manage = userCan(user, "maint.vendor_manage");
  const edit = userCan(user, "maint.vendor_create");
  const addWorker = userCan(user, "maint.workers");
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <MaintenanceTabs user={user} active="vendors" />
      <PageHeader title={v.name} status={<span className="chip">{v.state.toLowerCase().replace(/_/g, " ")}</span>} subtitle={`Contract ${d(v.contractStart) || "—"} → ${d(v.contractEnd) || "open"}${v.stateReason ? ` · ${v.stateReason}` : ""}${v.rating ? ` · rating ${Number(v.rating).toFixed(1)}★` : ""}`} crumbs={[["Maintenance", "/maintenance"], ["Vendors", "/maintenance/vendors"], [v.name]]} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <section className="card p-4">
            <h3 className="font-medium">Documents</h3>
            <ul className="mt-2 divide-y divide-zinc-100 text-sm">
              {documents.map((doc) => (
                <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>{doc.kind.replace(/_/g, " ").toLowerCase()}{doc.reference ? ` · ${doc.reference}` : ""}</span>
                  <span className="flex items-center gap-2"><span className={doc.expiresAt && d(doc.expiresAt) < today ? "text-red-700" : "text-zinc-500"}>{doc.expiresAt ? `expires ${d(doc.expiresAt)}` : "no expiry"}</span>{doc.verifiedAt ? <span className="chip chip-success">verified</span> : manage ? <ActionForm compact tone="secondary" action={verifyDocumentAction} hidden={{ documentId: doc.id }} submit="Verify" /> : <span className="chip">unverified</span>}</span>
                </li>
              ))}
              {documents.length === 0 && <li className="py-2 text-zinc-500">No documents on file.</li>}
            </ul>
            {(edit || (own && addWorker)) && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Add a document</summary><div className="mt-2"><ActionForm compact action={vendorDocumentAction} hidden={{ vendorId }} submit="Add" fields={[{ name: "kind", label: "Type", type: "select", options: ["TRADE_LICENCE", "INSURANCE", "CONTRACT", "ID_VERIFICATION", "OTHER"].map((k) => ({ value: k, label: k.replace(/_/g, " ").toLowerCase() })) }, { name: "reference", label: "Reference" }, { name: "issuedAt", label: "Issued", type: "date" }, { name: "expiresAt", label: "Expires", type: "date" }]} /></div></details>}
          </section>
          <section className="card p-4">
            <h3 className="font-medium">Rate card</h3>
            <ul className="mt-2 divide-y divide-zinc-100 text-sm">{rates.map((r) => <li key={r.id} className="flex justify-between py-1.5"><span>{r.category}</span><span>{Number(r.rate).toFixed(2)} {r.currency} / {r.unit}</span></li>)}{rates.length === 0 && <li className="py-2 text-zinc-500">No rates set.</li>}</ul>
            {userCan(user, "maint.rate_card") && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Set a rate</summary><div className="mt-2"><ActionForm compact action={rateAction} hidden={{ vendorId }} submit="Save rate" fields={[{ name: "category", label: "Category", type: "select", options: CATEGORIES.map((c) => ({ value: c, label: c })) }, { name: "unit", label: "Unit", defaultValue: "hour" }, { name: "rate", label: "Rate", type: "number", step: "0.01", required: true }]} /></div></details>}
          </section>
          <section className="card p-4">
            <h3 className="font-medium">Recent jobs</h3>
            <ul className="mt-2 divide-y divide-zinc-100 text-sm">{v.workOrders.map((w) => <li key={w.id} className="flex justify-between py-1.5"><Link href={`/maintenance/${w.id}`} className="underline">{w.ticketNumber}</Link><span className="text-zinc-500">{w.category} · {w.status.toLowerCase().replace(/_/g, " ")}{w.rating ? ` · ${w.rating}★` : ""}</span></li>)}{v.workOrders.length === 0 && <li className="py-2 text-zinc-500">No jobs yet.</li>}</ul>
          </section>
        </div>
        <div className="space-y-4">
          <section className="card p-4">
            <h3 className="font-medium">Contractor workers</h3>
            <ul className="mt-2 divide-y divide-zinc-100 text-sm">
              {workers.map((w) => (
                <li key={w.id} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span><b>{w.name}</b>{w.isSupervisor ? " · supervisor" : ""} <span className="text-xs text-zinc-500">{w.idType ? `${w.idType} ` : ""}{w.idNumber ?? "no ID"}</span></span><span className={`chip ${w.status === "VERIFIED" ? "chip-success" : w.status === "PENDING" ? "chip-warning" : "chip-danger"}`}>{w.status.toLowerCase()}{w.policeVerified ? " · police cleared" : ""}</span></div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {w.status === "PENDING" && (manage || userCan(user, "maint.triage")) && <ActionForm compact action={workerVerifyAction} hidden={{ workerId: w.id }} submit="Verify" fields={[{ name: "police", label: "Police verified", type: "checkbox" }]} />}
                    {w.status !== "SUSPENDED" && addWorker && <ActionForm compact tone="secondary" action={workerStatusAction} hidden={{ workerId: w.id, status: "SUSPENDED" }} submit="Suspend" />}
                    {addWorker && <ActionForm compact tone="secondary" action={workerStatusAction} hidden={{ workerId: w.id, status: "REMOVED" }} submit="Remove" />}
                  </div>
                </li>
              ))}
              {workers.length === 0 && <li className="py-2 text-zinc-500">No workers registered. Only verified workers can enter.</li>}
            </ul>
            {addWorker && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Add a worker</summary><div className="mt-2"><ActionForm compact action={workerAddAction} hidden={{ vendorId }} submit="Add worker" fields={[{ name: "name", label: "Name", required: true }, { name: "idType", label: "ID type" }, { name: "idNumber", label: "ID number" }, { name: "phone", label: "Phone", type: "tel" }, { name: "isSupervisor", label: "Vendor supervisor", type: "checkbox" }]} /></div></details>}
          </section>
          {edit && (
            <details className="card p-4"><summary className="cursor-pointer font-medium">Edit vendor</summary>
              <div className="mt-3"><ActionForm compact action={vendorUpdateAction} hidden={{ vendorId }} submit="Save" fields={[{ name: "name", label: "Name", defaultValue: v.name }, { name: "contactName", label: "Contact", defaultValue: v.contactName ?? "" }, { name: "contactPhone", label: "Phone", defaultValue: v.contactPhone ?? "" }, { name: "contactEmail", label: "Email", defaultValue: v.contactEmail ?? "" }, { name: "contractStart", label: "Contract start", type: "date", defaultValue: d(v.contractStart) }, { name: "contractEnd", label: "Contract end", type: "date", defaultValue: d(v.contractEnd) }]} /></div>
            </details>
          )}
          {manage && v.state !== "TERMINATED" && (
            <section className="card p-4 space-y-3">
              <h3 className="font-medium">Lifecycle</h3>
              {v.state !== "ACTIVE" && <ActionForm compact action={vendorStateAction} hidden={{ vendorId, to: "approve" }} submit={v.state === "PENDING_APPROVAL" ? "Approve vendor" : "Reinstate vendor"} />}
              {v.state === "ACTIVE" && <ActionForm compact tone="secondary" action={vendorStateAction} hidden={{ vendorId, to: "suspend" }} submit="Suspend" fields={[{ name: "reason", label: "Reason", required: true }]} />}
              <ActionForm compact tone="danger" action={vendorStateAction} hidden={{ vendorId, to: "terminate" }} submit="Terminate" intro="Ends access for the vendor's workers and cancels pending visits." fields={[{ name: "reason", label: "Reason", required: true }]} />
            </section>
          )}
        </div>
      </div>
    </>
  );
}

export default function VendorPage({ params }: PageProps<"/maintenance/vendors/[vendorId]">) {
  return <main><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content params={params} /></Suspense></main>;
}
