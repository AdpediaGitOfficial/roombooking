import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@sam/core/lib/db";
import { requireUser, userCan, userCanAccess } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { listInspectionSchedules, listInspections } from "@sam/core/modules/housekeeping/service";
import { ActionForm } from "@/components/forms/action-form";
import { scheduleInspectionAction, toggleInspectionScheduleAction } from "@/modules/housekeeping/actions";
import { PageHeader } from "@/components/shell/page-header";

async function Content({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser("/housekeeping/inspections");
  if (!userCanAccess(user, "house.inspect") && !userCanAccess(user, "house.schedule")) redirect("/forbidden");
  const { status } = await searchParams;
  const f = (["todo", "done", "issues", "all"].includes(status ?? "") ? status : "todo") as "todo" | "done" | "issues" | "all";
  const sites = await visibleSites(user, "house.inspect", "house.schedule");
  const schedule = userCan(user, "house.schedule");
  const [rows, schedules, siteList, buildings] = await Promise.all([
    listInspections({ siteIds: sites, status: f }),
    schedule ? listInspectionSchedules() : Promise.resolve([]),
    prisma.site.findMany({ where: { archivedAt: null, ...(sites ? { id: { in: sites } } : {}) }, select: { id: true, name: true } }),
    prisma.building.findMany({ where: { archivedAt: null, ...(sites ? { siteId: { in: sites } } : {}) }, select: { id: true, name: true } }),
  ]);
  return (
    <>
      <nav className="mb-4 flex flex-wrap gap-1.5">{(["todo", "done", "issues", "all"] as const).map((k) => <Link key={k} href={`/housekeeping/inspections?status=${k}`} className={`pill${k === f ? " pill-on" : ""}`}>{{ todo: "To inspect", done: "Done", issues: "Issues found", all: "All" }[k]}</Link>)}<Link href="/housekeeping" className="pill">Cleaning</Link></nav>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <section className="panel"><ul className="divide-y divide-zinc-200">
            {rows.map((i) => <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"><div><b>{i.roomLabel}</b> <span className="chip">{i.status.toLowerCase().replace("_", " ")}</span><div className="text-xs text-zinc-500">due {i.scheduledFor.toISOString().slice(0, 10)}{i.performedAt ? ` · done ${i.performedAt.toISOString().slice(0, 10)}` : ""}</div></div>{i.status === "SCHEDULED" && userCanAccess(user, "house.inspect") && <Link href={`/housekeeping/inspections/${i.id}`} className="btn btn-small">Inspect</Link>}</li>)}
            {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-500">Nothing here.</li>}
          </ul></section>
          {schedule && <section className="panel"><div className="toolbar"><h2 className="font-medium">Schedules</h2></div><ul className="divide-y divide-zinc-200">{schedules.map((s) => <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"><span><b>{s.title}</b> every {s.frequencyDays} days · next {s.nextDueAt.toISOString().slice(0, 10)} {s.active ? "" : "(paused)"}</span><ActionForm compact tone="secondary" action={toggleInspectionScheduleAction} hidden={{ scheduleId: s.id, active: s.active ? "0" : "1" }} submit={s.active ? "Pause" : "Resume"} /></li>)}{schedules.length === 0 && <li className="px-4 py-3 text-sm text-zinc-500">No schedules.</li>}</ul></section>}
        </div>
        {schedule && <ActionForm action={scheduleInspectionAction} title="Schedule periodic inspections" submit="Schedule" fields={[{ name: "title", label: "Title", required: true, placeholder: "Quarterly room inspection" }, { name: "siteId", label: "Site", type: "select", options: siteList.map((s) => ({ value: s.id, label: s.name })) }, { name: "buildingId", label: "Building", type: "select", options: [{ value: "", label: "Whole site" }, ...buildings.map((b) => ({ value: b.id, label: b.name }))] }, { name: "frequencyDays", label: "Every (days)", type: "number", min: 1, defaultValue: 90 }, { name: "firstDue", label: "First due", type: "date", required: true }]} />}
      </div>
    </>
  );
}

export default function InspectionsPage({ searchParams }: PageProps<"/housekeeping/inspections">) {
  return <main><PageHeader title="Room inspections" subtitle="From the inspection checklist; failed items become work orders." crumbs={[["Housekeeping", "/housekeeping"], ["Inspections"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content searchParams={searchParams as Promise<{ status?: string }>} /></Suspense></main>;
}
