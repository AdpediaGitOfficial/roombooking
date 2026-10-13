import { Suspense } from "react";
import Link from "next/link";
import { requireCapability, userCan } from "@/lib/auth/authorize";
import { clearanceStatus, listExits } from "@sam/core/modules/people/lifecycle";
import { isoDate } from "@sam/core/modules/accommodation/occupancy";
import { ActionForm } from "@/components/forms/action-form";
import { cancelExitAction, closeClearanceAction } from "@/modules/people/actions";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireCapability("people.clearance", { returnTo: "/people/exits", level: "access" });
  const exits = await listExits({ status: "OPEN" });
  const clearances = new Map((await Promise.all(exits.map((e) => clearanceStatus(e.id)))).map((c) => [c.exit.id, c]));
  const canClose = userCan(user, "people.clearance") && user.roleAssignments.some((r) => r.role === "SYSTEM_ADMIN" || r.role === "ACCOMMODATION_ADMIN");
  return (
    <ul className="space-y-3">
      {exits.map((e) => {
        const c = clearances.get(e.id)!;
        const bed = e.staff.allocations[0];
        return (
          <li key={e.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><Link href={`/people/${e.staffId}`} className="font-medium underline">{e.staff.firstName} {e.staff.lastName}</Link> <span className="text-xs text-zinc-500">{e.staff.employeeId}</span><div className="text-sm text-zinc-600">Last day {isoDate(e.lastDay)} · {e.status.toLowerCase().replace("_", " ")}{bed ? ` · ${bed.bed.code} (${bed.bed.room.building.name})` : ""}</div></div>
              <span className={`chip ${c.ready ? "chip-ok" : "chip-warn"}`}>{c.ready ? "Ready to clear" : "Blocked"}</span>
            </div>
            <ul className="mt-2 text-sm">
              {c.stay && <li>• Still holds a bed ({c.stay.status.toLowerCase().replace("_", " ")}) — <Link href={`/accommodation/allocations?staffId=${e.staffId}`} className="underline">check out</Link></li>}
              {c.blockers.map((b) => <li key={b.label}>• {b.label} not returned</li>)}
              {c.pendingCharges > 0 && <li>• {c.pendingCharges} open charge{c.pendingCharges === 1 ? "" : "s"} (flagged, not blocking)</li>}
              {c.ready && <li className="text-green-700">• Nothing outstanding.</li>}
            </ul>
            {canClose && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <ActionForm action={closeClearanceAction} hidden={{ exitId: e.id }} submit="Close clearance" fields={[{ name: "note", label: "Note" }]} />
                <ActionForm action={cancelExitAction} hidden={{ exitId: e.id }} tone="secondary" submit="Cancel exit" fields={[{ name: "reason", label: "Reason", required: true }]} />
              </div>
            )}
          </li>
        );
      })}
      {exits.length === 0 && <li className="card p-6 text-center text-sm text-zinc-500">No open exits.</li>}
    </ul>
  );
}

export default function ExitsPage() {
  return <main><PageHeader title="Exits & clearance" subtitle="Keys, assets, charges and the stay must be settled before a leaver is cleared and archived." crumbs={[["People", "/people"], ["Exits"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
