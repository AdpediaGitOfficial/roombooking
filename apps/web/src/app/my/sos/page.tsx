import { Suspense } from "react";
import { prisma } from "@sam/core/lib/db";
import { userCanAccess } from "@/lib/auth/authorize";
import { requireResident } from "@/modules/self-service/context";
import { listSos } from "@sam/core/modules/security/service";
import { OCCUPYING_STATUSES } from "@sam/core/modules/accommodation/occupancy";
import { ActionForm } from "@/components/forms/action-form";
import { sosAction } from "@/modules/security/actions";

async function Content() {
  const { user, staff } = await requireResident("/my/sos");
  if (!userCanAccess(user, "sec.sos_raise")) return <p className="mt-4 text-sm text-zinc-500">SOS is not available for your account.</p>;
  const stay = staff ? await prisma.allocation.findFirst({ where: { staffId: staff.id, status: { in: OCCUPYING_STATUSES } }, include: { bed: { include: { room: { include: { building: true } } } } } }) : null;
  const site = stay?.bed.room.building.siteId ?? (await prisma.site.findFirst({ where: { status: "ACTIVE" }, select: { id: true } }))?.id ?? "";
  const mine = await listSos({ userId: user.id });
  return (
    <>
      <p className="mt-2 text-sm text-zinc-600">For an emergency only. Security and the accommodation office are alerted immediately.</p>
      <div className="mt-4"><ActionForm action={sosAction} hidden={{ siteId: site }} tone="danger" title="Send an SOS" submit="SEND SOS" fields={[{ name: "location", label: "Where are you?", defaultValue: stay ? `${stay.bed.room.building.name}, room ${stay.bed.room.code}` : "" }, { name: "note", label: "What is happening?" }]} /></div>
      {mine.length > 0 && <ul className="mt-6 divide-y divide-zinc-200 card">{mine.slice(0, 5).map((s) => <li key={s.id} className="flex justify-between p-3 text-sm"><span>{s.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span><span className="chip">{s.status.toLowerCase().replace("_", " ")}</span></li>)}</ul>}
    </>
  );
}

export default function MySosPage() {
  return <main><h1 className="page-title">Help / SOS</h1><Suspense fallback={<p className="mt-4 text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
