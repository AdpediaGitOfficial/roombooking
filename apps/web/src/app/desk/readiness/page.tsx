import { Suspense } from "react";
import { requireCapability, userCan } from "@/lib/auth/authorize";
import { sitesFor } from "@/lib/auth/scope";
import { prisma } from "@sam/core/lib/db";
import { siteWhere } from "@sam/core/lib/permissions/scope";
import { ReadinessForm } from "@/modules/allocations/components/extras-forms";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireCapability("accom.readiness", { returnTo: "/desk/readiness", level: "access" });
  const sites = await sitesFor(user, "accom.readiness");
  const [beds, tasks] = await Promise.all([
    prisma.bed.findMany({ where: { readiness: { not: "READY" }, status: "ACTIVE", room: { building: siteWhere(sites) } }, include: { room: { include: { building: true } } }, orderBy: [{ room: { building: { code: "asc" } } }, { code: "asc" }] }),
    prisma.cleaningTask.findMany({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, ...siteWhere(sites) }, orderBy: { dueAt: "asc" }, take: 100 }),
  ]);
  const canSet = userCan(user, "accom.readiness");
  const taskByBed = new Map(tasks.filter((t) => t.bedId).map((t) => [t.bedId!, t]));
  return (
    <section className="panel">
      <div className="toolbar"><h2 className="font-medium">Beds not ready ({beds.length})</h2></div>
      <ul className="divide-y divide-zinc-200">
        {beds.map((b) => {
          const t = taskByBed.get(b.id);
          return (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm" data-bed={b.code}>
              <div><div className="font-medium">{b.room.building.name} · room {b.room.code} · bed {b.code}</div><div className="text-xs text-zinc-500">{b.readiness.toLowerCase().replace(/_/g, " ")}{t?.dueAt ? ` · cleaning due ${t.dueAt.toISOString().slice(0, 16).replace("T", " ")}` : ""}</div></div>
              {canSet && <ReadinessForm bedId={b.id} ready={false} />}
            </li>
          );
        })}
        {beds.length === 0 && <li className="px-4 py-6 text-sm text-zinc-500">Every bed in service is ready.</li>}
      </ul>
    </section>
  );
}

export default function ReadinessPage() {
  return (
    <main>
      <PageHeader title="Room readiness" subtitle="Beds waiting for cleaning or inspection before the next arrival." crumbs={[["Front desk", "/desk"], ["Readiness"]]} />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense>
    </main>
  );
}
