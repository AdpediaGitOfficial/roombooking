import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@sam/core/lib/db";
import { actorOf, requireUser, userCan, userCanAccess } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { housekeepingStaff, listCleaningTasks } from "@sam/core/modules/housekeeping/service";
import { ActionForm } from "@/components/forms/action-form";
import { adhocTaskAction, taskAction } from "@/modules/housekeeping/actions";
import { PageHeader } from "@/components/shell/page-header";

async function Content({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser("/housekeeping");
  if (!userCanAccess(user, "house.tasks")) redirect("/forbidden");
  const { status } = await searchParams;
  const sites = await visibleSites(user, "house.tasks");
  const manage = userCan(user, "house.tasks");
  const [tasks, staff, rooms] = await Promise.all([
    listCleaningTasks(actorOf(user), { siteIds: sites, status: status === "done" ? "done" : "open" }),
    manage ? housekeepingStaff() : Promise.resolve([]),
    manage ? prisma.room.findMany({ where: { archivedAt: null, ...(sites ? { building: { siteId: { in: sites } } } : {}) }, include: { building: true }, orderBy: [{ building: { name: "asc" } }, { code: "asc" }], take: 500 }) : Promise.resolve([]),
  ]);
  const now = Date.now();
  return (
    <>
      <nav className="mb-4 flex gap-1.5"><Link href="/housekeeping" className={`pill${status !== "done" ? " pill-on" : ""}`}>To do</Link><Link href="/housekeeping?status=done" className={`pill${status === "done" ? " pill-on" : ""}`}>Done</Link><Link href="/housekeeping/inspections" className="pill">Inspections</Link></nav>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <section className="panel"><ul className="divide-y divide-zinc-200">
          {tasks.map((t) => (
            <li key={t.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2"><div><b>{t.roomLabel}</b>{t.bedCode ? ` · bed ${t.bedCode}` : ""} <span className="chip">{t.reason.toLowerCase()}</span>{t.dueAt && t.dueAt.getTime() < now && t.status !== "DONE" && <span className="chip chip-danger ml-1">overdue</span>}<div className="text-xs text-zinc-500">{t.status.toLowerCase().replace("_", " ")}{t.assignee ? ` · ${t.assignee}` : " · unassigned"}{t.dueAt ? ` · due ${t.dueAt.toISOString().slice(5, 16).replace("T", " ")}` : ""}{t.notes ? ` · ${t.notes}` : ""}</div></div></div>
              {t.status !== "DONE" && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {t.status === "OPEN" && <ActionForm compact tone="secondary" action={taskAction} hidden={{ taskId: t.id, op: "start" }} submit="Start" />}
                  <ActionForm compact action={taskAction} hidden={{ taskId: t.id, op: "done" }} submit="Mark clean & ready" fields={[]} />
                  {manage && <ActionForm compact tone="secondary" action={taskAction} hidden={{ taskId: t.id, op: "assign" }} submit="Assign" fields={[{ name: "assigneeId", label: "To", type: "select", defaultValue: t.assignedToId ?? "", options: [{ value: "", label: "Unassigned" }, ...staff.map((s) => ({ value: s.id, label: s.name }))] }]} />}
                </div>
              )}
            </li>
          ))}
          {tasks.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-500">Nothing to clean.</li>}
        </ul></section>
        {manage && rooms.length > 0 && <ActionForm action={adhocTaskAction} title="Add a cleaning task" submit="Create task" fields={[{ name: "roomId", label: "Room", type: "select", options: rooms.map((r) => ({ value: r.id, label: `${r.building.name} · ${r.code}` })) }, { name: "notes", label: "Notes" }]} />}
      </div>
    </>
  );
}

export default function HousekeepingPage({ searchParams }: PageProps<"/housekeeping">) {
  return <main><PageHeader title="Housekeeping" subtitle="Beds that need cleaning come here when a resident checks out." crumbs={[["Housekeeping"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content searchParams={searchParams as Promise<{ status?: string }>} /></Suspense></main>;
}
