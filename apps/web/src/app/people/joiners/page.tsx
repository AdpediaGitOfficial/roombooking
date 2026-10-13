import { Suspense } from "react";
import Link from "next/link";
import { requireCapability } from "@/lib/auth/authorize";
import { listJoiners } from "@sam/core/modules/people/lifecycle";
import { isoDate } from "@sam/core/modules/accommodation/occupancy";
import { ActionForm } from "@/components/forms/action-form";
import { cancelJoinerAction } from "@/modules/people/actions";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireCapability("people.view", { returnTo: "/people/joiners", level: "access" });
  const joiners = await listJoiners({ status: "OPEN" });
  const canCancel = user.roleAssignments.some((r) => r.role === "SYSTEM_ADMIN" || r.role === "ACCOMMODATION_ADMIN");
  return (
    <section className="panel">
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>Person</th><th>Expected</th><th>Stay</th><th>Status</th><th>Source</th><th></th></tr></thead>
          <tbody>
            {joiners.map((j) => (
              <tr key={j.id}>
                <td><Link href={`/people/${j.staffId}`} className="font-medium underline">{j.staff.firstName} {j.staff.lastName}</Link><span className="sub">{j.staff.employeeId}</span></td>
                <td className="tabular-nums">{isoDate(j.expectedArrival)}</td>
                <td>{j.stayType.toLowerCase()}</td>
                <td><span className={`chip ${j.status === "ALLOCATED" ? "chip-ok" : "chip-info"}`}>{j.status === "ALLOCATED" ? "Bed reserved" : "Awaiting allocation"}</span></td>
                <td>{j.source.toLowerCase()}</td>
                <td className="num">
                  {j.status === "EXPECTED" && <Link href={`/accommodation/allocations/new?staffId=${j.staffId}`} className="btn btn-small">Allocate</Link>}
                  {canCancel && <details className="inline-block"><summary className="btn btn-small btn-ghost cursor-pointer">Cancel</summary><div className="mt-2 w-64 text-left"><ActionForm action={cancelJoinerAction} hidden={{ joinerId: j.id }} submit="Cancel joiner" tone="danger" fields={[{ name: "reason", label: "Reason", required: true }]} /></div></details>}
                </td>
              </tr>
            ))}
            {joiners.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-sm text-zinc-500">No joiners expected. Raise one from a person's page.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function JoinersPage() {
  return <main><PageHeader title="Joiners" subtitle="New hires and transferees expected to arrive, from HR or raised by an Accommodation Admin." crumbs={[["People", "/people"], ["Joiners"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
