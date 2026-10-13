import { Suspense } from "react";
import { requireCapability, userCan } from "@/lib/auth/authorize";
import { listArchived, listArchivedStructure } from "@sam/core/modules/archive/service";
import { ActionForm } from "@/components/forms/action-form";
import { hardDeleteAction, restoreArchivedAction, restoreStructureAction } from "@/modules/archive-actions";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireCapability("setup.restore", { returnTo: "/admin/archive", level: "access" });
  const [records, structure] = await Promise.all([listArchived(), listArchivedStructure()]);
  const canRestore = userCan(user, "setup.restore");
  const canDelete = userCan(user, "setup.hard_delete");
  return (
    <div className="space-y-4">
      <section className="panel">
        <div className="toolbar"><h2 className="font-medium">Sites, buildings, rooms and beds ({structure.length})</h2></div>
        <ul className="divide-y divide-zinc-200">
          {structure.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
              <div><b>{s.level.toLowerCase()}</b> · {s.label}<div className="text-xs text-zinc-500">Archived {s.archivedAt.toISOString().slice(0, 10)}{s.reason ? ` · ${s.reason}` : ""} · {s.daysLeft} day{s.daysLeft === 1 ? "" : "s"} left to restore</div></div>
              {canRestore && <ActionForm compact tone="secondary" action={restoreStructureAction} hidden={{ level: s.level, id: s.id }} submit="Restore" />}
            </li>
          ))}
          {structure.length === 0 && <li className="px-4 py-4 text-sm text-zinc-500">Nothing archived.</li>}
        </ul>
      </section>
      <section className="panel">
        <div className="toolbar"><h2 className="font-medium">People, vendors, facilities, stock, keys and masters ({records.length})</h2></div>
        <ul className="divide-y divide-zinc-200">
          {records.map((r) => (
            <li key={`${r.kind}-${r.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
              <div><b>{r.kind.toLowerCase().replace(/_/g, " ")}</b> · {r.label}<div className="text-xs text-zinc-500">Archived {r.archivedAt.toISOString().slice(0, 10)}{r.archivedBy ? ` by ${r.archivedBy}` : ""}{r.reason ? ` · ${r.reason}` : ""} · {r.purgeable ? "restore window passed" : `${r.daysLeft} days left to restore`}</div></div>
              <div className="flex gap-2">
                {canRestore && <ActionForm compact tone="secondary" action={restoreArchivedAction} hidden={{ kind: r.kind, id: r.id }} submit="Restore" />}
                {canDelete && r.purgeable && <ActionForm compact tone="danger" action={hardDeleteAction} hidden={{ kind: r.kind, id: r.id }} submit="Delete permanently" />}
              </div>
            </li>
          ))}
          {records.length === 0 && <li className="px-4 py-4 text-sm text-zinc-500">Nothing archived.</li>}
        </ul>
      </section>
    </div>
  );
}

export default function ArchivePage() {
  return <main><PageHeader title="Archive" subtitle="Deleted records are archived first and can be restored for 30 days. Only a Super Admin can delete permanently, after that window." crumbs={[["Admin"], ["Archive"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
