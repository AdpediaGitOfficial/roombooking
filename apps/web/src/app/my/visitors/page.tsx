import { Suspense } from "react";
import { prisma } from "@sam/core/lib/db";
import { actorOf, userCanAccess } from "@/lib/auth/authorize";
import { requireResident } from "@/modules/self-service/context";
import { listVisitors, visitorPolicy } from "@sam/core/modules/security/service";
import { OCCUPYING_STATUSES } from "@sam/core/modules/accommodation/occupancy";
import { ActionForm } from "@/components/forms/action-form";
import { cancelVisitorAction, confirmWalkInAction, preRegisterAction } from "@/modules/security/actions";

async function Content() {
  const { user, staff } = await requireResident("/my/visitors");
  void actorOf;
  const stay = staff ? await prisma.allocation.findFirst({ where: { staffId: staff.id, status: { in: OCCUPYING_STATUSES } }, include: { bed: { include: { room: { include: { building: true } } } } } }) : null;
  const siteId = stay?.bed.room.building.siteId ?? null;
  const [rows, policy] = await Promise.all([listVisitors({ filter: "mine", userId: user.id }), siteId ? visitorPolicy(siteId) : null]);
  const walkIns = rows.filter((v) => v.status === "WALK_IN_PENDING");
  const may = userCanAccess(user, "sec.preregister") && !!staff && !!siteId;
  return (
    <>
      {walkIns.map((v) => (
        <div key={v.id} className="alert alert-warning mt-4"><span>!</span><div><b>{v.name} is at the gate.</b> Is this visitor for you?
          <div className="mt-2 flex gap-2"><ActionForm compact action={confirmWalkInAction} hidden={{ visitorId: v.id, decision: "confirm" }} submit="Yes, let them in" /><ActionForm compact tone="secondary" action={confirmWalkInAction} hidden={{ visitorId: v.id, decision: "refuse" }} submit="No" /></div></div></div>
      ))}
      {may && siteId && staff ? (
        <div className="mt-4"><ActionForm action={preRegisterAction} hidden={{ siteId, hostStaffId: staff.id }} title="Register a visitor" intro={policy ? `Day visits up to ${policy.maxDayHours} hours are approved at once. Overnight (up to ${policy.maxNights} nights) and restricted-area visits need approval.` : undefined} submit="Register" fields={[
          { name: "kind", label: "Kind", type: "select", options: [{ value: "DAY", label: "Day visitor" }, ...(policy?.overnightAllowed ? [{ value: "OVERNIGHT", label: "Overnight" }] : [])] },
          { name: "name", label: "Visitor's name", required: true }, { name: "phone", label: "Phone", type: "tel" }, { name: "idNumber", label: "ID number" },
          { name: "expectedAt", label: "Arriving", type: "datetime-local", required: true }, { name: "nights", label: "Nights (overnight)", type: "number", min: 1 }, { name: "purpose", label: "Purpose" },
        ]} /></div>
      ) : <p className="mt-4 text-sm text-zinc-500">Visitor registration is not switched on for your account. Ask the front desk to register a visitor for you.</p>}
      <h2 className="section-title mt-6">Your visitors</h2>
      <ul className="mt-2 divide-y divide-zinc-200 card">
        {rows.map((v) => <li key={v.id} className="p-3 text-sm"><div className="flex justify-between gap-2"><b>{v.name}</b><span className="chip">{v.status.toLowerCase().replace(/_/g, " ")}</span></div><div className="text-xs text-zinc-500">{v.kind.toLowerCase().replace("_", " ")} · {v.expectedAt ? v.expectedAt.toISOString().slice(0, 16).replace("T", " ") : ""}{v.passCode && v.status === "APPROVED" ? ` · give them code ${v.passCode}` : ""}</div>{["PENDING_APPROVAL", "APPROVED"].includes(v.status) && <div className="mt-1"><ActionForm compact tone="secondary" action={cancelVisitorAction} hidden={{ visitorId: v.id }} submit="Cancel" /></div>}</li>)}
        {rows.length === 0 && <li className="p-4 text-sm text-zinc-500">No visitors yet.</li>}
      </ul>
    </>
  );
}

export default function MyVisitorsPage() {
  return <main><h1 className="page-title">Visitors</h1><Suspense fallback={<p className="mt-4 text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
