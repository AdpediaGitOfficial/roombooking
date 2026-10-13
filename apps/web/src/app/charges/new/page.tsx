import { Suspense } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@sam/core/lib/db";
import { requireUser, userCanAccess } from "@/lib/auth/authorize";
import { RATE_KINDS, listRates } from "@sam/core/modules/charges/service";
import { staffOptions } from "@sam/core/modules/people/service";
import { ActionForm } from "@/components/forms/action-form";
import { raiseChargeAction } from "@/modules/charges/actions";
import { PageHeader } from "@/components/shell/page-header";

async function Content({ searchParams }: { searchParams: Promise<{ staffId?: string }> }) {
  const user = await requireUser("/charges/new");
  if (!userCanAccess(user, "charges.raise")) redirect("/forbidden");
  const { staffId } = await searchParams;
  const [staff, rates, vendors] = await Promise.all([staffOptions({ includeUnverified: false }), listRates(), prisma.vendor.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  return <div className="max-w-2xl"><ActionForm action={raiseChargeAction} submit="Record charge" intro="Recorded charges wait for a different Admin to approve." fields={[
    { name: "staffId", label: "Resident", type: "select", defaultValue: staffId ?? "", options: [{ value: "", label: "(none: charging a vendor)" }, ...staff.map((s) => ({ value: s.id, label: `${s.firstName} ${s.lastName} (${s.employeeId})` }))] },
    { name: "vendorId", label: "Or vendor", type: "select", options: [{ value: "", label: "(none)" }, ...vendors.map((v) => ({ value: v.id, label: v.name }))] },
    { name: "kind", label: "Kind", type: "select", options: RATE_KINDS.map((k) => ({ value: k, label: k.toLowerCase().replace("_", " ") })) },
    { name: "rateCode", label: "Rate", type: "select", options: [{ value: "", label: "Enter an amount instead" }, ...rates.map((r) => ({ value: r.code, label: `${r.name} (${Number(r.amount).toFixed(2)} ${r.currency}/${r.unit})` }))] },
    { name: "quantity", label: "Quantity", type: "number", defaultValue: 1, step: "0.5", min: 0 },
    { name: "amount", label: "Amount (if no rate)", type: "number", step: "0.01" },
    { name: "description", label: "What for", type: "textarea", required: true },
  ]} /></div>;
}

export default function NewChargePage({ searchParams }: PageProps<"/charges/new">) {
  return <main><PageHeader title="Record a charge" crumbs={[["Charges", "/charges"], ["Record"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content searchParams={searchParams as Promise<{ staffId?: string }>} /></Suspense></main>;
}
