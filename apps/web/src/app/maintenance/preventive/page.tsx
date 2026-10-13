import { Suspense } from "react";
import { prisma } from "@sam/core/lib/db";
import { requireCapability } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { listSchedules } from "@sam/core/modules/maintenance/extras";
import { CATEGORIES, PRIORITIES, listAssignees } from "@sam/core/modules/maintenance/service";
import { ActionForm } from "@/components/forms/action-form";
import { scheduleAction, scheduleToggleAction } from "@/modules/maintenance/extras-actions";
import { MaintenanceTabs } from "@/modules/maintenance/components/tabs";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireCapability("maint.preventive", { returnTo: "/maintenance/preventive" });
  const visible = await visibleSites(user, "maint.preventive");
  const [schedules, sites, buildings, assignees] = await Promise.all([
    listSchedules(),
    prisma.site.findMany({ where: { archivedAt: null, ...(visible ? { id: { in: visible } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.building.findMany({ where: { archivedAt: null, ...(visible ? { siteId: { in: visible } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    listAssignees(),
  ]);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  return (
    <>
      <MaintenanceTabs user={user} active="preventive" />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="panel">
          <div className="toolbar"><h2 className="font-medium">Schedules ({schedules.length})</h2></div>
          <ul className="divide-y divide-zinc-200">
            {schedules.filter((s) => visible === null || visible.includes(s.siteId)).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div><b>{s.title}</b> <span className="chip">{s.active ? "active" : "paused"}</span><div className="text-xs text-zinc-500">{s.category} · every {s.frequencyDays} days · {siteName.get(s.siteId) ?? ""} · next due {s.nextDueAt.toISOString().slice(0, 10)}{s.lastGeneratedAt ? ` · last raised ${s.lastGeneratedAt.toISOString().slice(0, 10)}` : ""}</div></div>
                <ActionForm compact tone="secondary" action={scheduleToggleAction} hidden={{ scheduleId: s.id, active: s.active ? "0" : "1" }} submit={s.active ? "Pause" : "Resume"} />
              </li>
            ))}
            {schedules.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-500">No preventive schedules yet.</li>}
          </ul>
        </section>
        <ActionForm action={scheduleAction} title="New schedule" submit="Create schedule" fields={[
          { name: "title", label: "Task", required: true, placeholder: "Quarterly AC filter clean" },
          { name: "siteId", label: "Site", type: "select", options: sites.map((s) => ({ value: s.id, label: s.name })) },
          { name: "buildingId", label: "Building (optional)", type: "select", options: [{ value: "", label: "Whole site" }, ...buildings.map((b) => ({ value: b.id, label: b.name }))] },
          { name: "category", label: "Category", type: "select", options: CATEGORIES.map((c) => ({ value: c, label: c })) },
          { name: "priority", label: "Priority", type: "select", defaultValue: "MEDIUM", options: PRIORITIES.map((p) => ({ value: p, label: p.toLowerCase() })) },
          { name: "frequencyDays", label: "Repeat every (days)", type: "number", min: 1, required: true },
          { name: "firstDue", label: "First due", type: "date", required: true },
          { name: "assigneeId", label: "Engineer", type: "select", options: [{ value: "", label: "Unassigned" }, ...assignees.engineers.map((e) => ({ value: e.id, label: e.name }))] },
          { name: "vendorId", label: "Vendor", type: "select", options: [{ value: "", label: "None" }, ...assignees.vendors.map((v) => ({ value: v.id, label: v.name }))] },
          { name: "description", label: "Details", type: "textarea" },
        ]} />
      </div>
    </>
  );
}

export default function PreventivePage() {
  return <main><PageHeader title="Preventive maintenance" subtitle="Recurring jobs. A work order is raised automatically a week before each is due." crumbs={[["Maintenance", "/maintenance"], ["Preventive"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
