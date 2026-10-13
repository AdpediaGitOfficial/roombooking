import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, userCan, userCanAccess } from "@/lib/auth/authorize";
import { listVendors, vendorCompliance } from "@sam/core/modules/maintenance/extras";
import { ActionForm } from "@/components/forms/action-form";
import { vendorCreateAction } from "@/modules/maintenance/extras-actions";
import { MaintenanceTabs } from "@/modules/maintenance/components/tabs";
import { PageHeader } from "@/components/shell/page-header";
import { CATEGORIES } from "@sam/core/modules/maintenance/service";

const TONE: Record<string, string> = { ACTIVE: "chip-success", PENDING_APPROVAL: "chip-warning", EXPIRED: "chip-danger", SUSPENDED: "chip-danger", TERMINATED: "" };

async function Content() {
  const user = await requireUser("/maintenance/vendors");
  if (user.vendorId && user.roleAssignments.some((r) => r.role === "VENDOR") && !userCanAccess(user, "maint.vendor_create")) redirect(`/maintenance/vendors/${user.vendorId}`);
  if (!userCanAccess(user, "maint.vendor_create") && !userCanAccess(user, "maint.rate_card") && !userCan(user, "maint.workers")) redirect("/forbidden");
  const [vendors, compliance] = await Promise.all([listVendors(), vendorCompliance()]);
  return (
    <>
      <MaintenanceTabs user={user} active="vendors" />
      {compliance.length > 0 && (
        <div className="alert alert-warning mb-4"><span>!</span><div><b>{compliance.length} compliance item{compliance.length === 1 ? "" : "s"} expiring within 30 days</b>
          <ul className="mt-1 text-sm">{compliance.slice(0, 6).map((c, i) => <li key={i}><Link href={`/maintenance/vendors/${c.vendorId}`} className="underline">{c.vendor}</Link>: {c.what} {c.daysLeft < 0 ? `expired ${-c.daysLeft} days ago` : `expires in ${c.daysLeft} days`} ({c.expiresOn})</li>)}</ul></div></div>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <section className="panel">
          <div className="toolbar"><h2 className="font-medium">Vendors & contractors ({vendors.length})</h2></div>
          <table className="table">
            <thead><tr><th>Vendor</th><th>State</th><th>Contract ends</th><th>Open jobs</th><th>Rating</th></tr></thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id}><td><Link href={`/maintenance/vendors/${v.id}`} className="font-medium underline">{v.name}</Link><span className="sub">{v.tradeCategories.join(", ")}</span></td><td><span className={`chip ${TONE[v.state] ?? ""}`}>{v.state.toLowerCase().replace(/_/g, " ")}</span></td><td className="tabular-nums">{v.contractEnd ? v.contractEnd.toISOString().slice(0, 10) : "—"}</td><td>{v.open}</td><td>{v.rating ? `${Number(v.rating).toFixed(1)} ★` : "—"}</td></tr>
              ))}
              {vendors.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-sm text-zinc-500">No vendors yet.</td></tr>}
            </tbody>
          </table>
        </section>
        {userCan(user, "maint.vendor_create") && (
          <ActionForm action={vendorCreateAction} title="New vendor" intro={userCan(user, "maint.vendor_manage") ? "Created active." : "Created as pending until an Admin approves."} submit="Create vendor" fields={[
            { name: "name", label: "Name", required: true }, { name: "contactName", label: "Contact" }, { name: "contactPhone", label: "Phone", type: "tel" }, { name: "contactEmail", label: "Email", type: "email" },
            { name: "contractStart", label: "Contract start", type: "date" }, { name: "contractEnd", label: "Contract end", type: "date" },
            { name: "tradeCategories", label: "Trades", type: "multiselect", options: CATEGORIES.map((c) => ({ value: c, label: c })) },
          ]} />
        )}
      </div>
    </>
  );
}

export default function VendorsPage() {
  return <main><PageHeader title="Vendors & contractors" subtitle="Lifecycle: pending approval, active, expired, suspended, terminated." crumbs={[["Maintenance", "/maintenance"], ["Vendors"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
