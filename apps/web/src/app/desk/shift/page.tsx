import { Suspense } from "react";
import { prisma } from "@sam/core/lib/db";
import { requireUser } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { currentShift, recentShifts, shiftActivity } from "@sam/core/modules/desk/service";
import { ShiftControls } from "@/modules/desk/shift-forms";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireUser("/desk/shift");
  const visible = await visibleSites(user, "accom.checkin", "accom.view", "sec.verify_resident");
  const [open, sites, shifts] = await Promise.all([
    currentShift(user.id),
    prisma.site.findMany({ where: { status: "ACTIVE", ...(visible ? { id: { in: visible } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    recentShifts({ siteIds: visible, take: 20 }),
  ]);
  const live = open ? await shiftActivity(user.id, open.startedAt) : [];
  const names = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(shifts.map((s) => s.userId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <div className="space-y-4">
        <ShiftControls open={open ? { startedAt: open.startedAt.toISOString() } : null} sites={sites} />
        {open && live.length > 0 && <ul className="card divide-y divide-zinc-200 text-sm">{live.map((g) => <li key={g.label} className="flex justify-between px-4 py-2"><span>{g.label}</span><b>{g.count}</b></li>)}</ul>}
      </div>
      <section className="panel">
        <div className="toolbar"><h2 className="font-medium">Recent shifts</h2></div>
        <ul className="divide-y divide-zinc-200">
          {shifts.map((s) => {
            const activity = ((s.summary as { activity?: Array<{ label: string; count: number }> } | null)?.activity ?? []);
            return (
              <li key={s.id} className="px-4 py-3 text-sm">
                <div className="flex justify-between gap-3"><b>{names.get(s.userId) ?? "—"}</b><span className="text-xs text-zinc-500">{s.startedAt.toISOString().slice(0, 16).replace("T", " ")} → {s.endedAt ? s.endedAt.toISOString().slice(11, 16) : "open"}</span></div>
                {activity.length > 0 && <div className="mt-1 text-xs text-zinc-600">{activity.map((a) => `${a.count} ${a.label.toLowerCase()}`).join(" · ")}</div>}
                {s.notes && <div className="mt-1 whitespace-pre-line text-xs text-zinc-500">{s.notes}</div>}
              </li>
            );
          })}
          {shifts.length === 0 && <li className="px-4 py-6 text-sm text-zinc-500">No shifts logged yet.</li>}
        </ul>
      </section>
    </div>
  );
}

export default function ShiftPage() {
  return (
    <main>
      <PageHeader title="Shift log" subtitle="Start and end your shift; what you did is summarised for the handover." crumbs={[["Front desk", "/desk"], ["Shift log"]]} />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense>
    </main>
  );
}
