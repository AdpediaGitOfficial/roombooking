import { Suspense } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/authorize";
import { IMPORT_ROLES, KINDS, listBatches, type Summary } from "@sam/core/modules/imports/service";
import { UploadForm } from "@/modules/imports/components/forms";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireRole(IMPORT_ROLES, "/admin/import");
  const batches = await listBatches(user.organizationId);
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {KINDS.map((k) => (
          <div key={k.kind} className="card p-4 text-sm" data-kind={k.kind}>
            <div className="font-medium">{k.label}</div>
            <p className="mt-1 text-zinc-600">{k.blurb}</p>
            <p className="mt-2 font-mono text-xs text-zinc-500">{k.columns.join(", ")}</p>
            <div className="mt-3 flex flex-wrap gap-3 text-xs">
              <a href={`/api/imports/${k.kind}.csv?template=1`} className="underline">Download template</a>
              <a href={`/api/imports/${k.kind}.csv`} className="underline">Export current data</a>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6"><UploadForm kinds={KINDS.map((k) => ({ kind: k.kind, label: k.label }))} /></div>
      <h2 className="mt-8 text-lg font-semibold">Recent imports</h2>
      <div className="mt-2 overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500"><tr><th className="px-3 py-2">File</th><th className="px-3 py-2">Kind</th><th className="px-3 py-2">Rows</th><th className="px-3 py-2">State</th><th className="px-3 py-2">By</th></tr></thead>
          <tbody className="divide-y divide-zinc-200">
            {batches.map((b) => { const s = b.summary as Summary; return (
              <tr key={b.id} data-batch={b.id} data-state={b.status}>
                <td className="px-3 py-3"><Link href={`/admin/import/${b.id}`} className="font-medium underline">{b.fileName}</Link><div className="text-xs text-zinc-500">{b.createdAt.toISOString().slice(0, 16).replace("T", " ")}</div></td>
                <td className="px-3 py-3">{KINDS.find((k) => k.kind === b.kind)?.label ?? b.kind}</td>
                <td className="px-3 py-3 text-xs tabular-nums">{s.total} · {s.create} new · {s.update} updated · {s.error} errors</td>
                <td className="px-3 py-3 text-xs">{b.status === "IMPORTED" ? `Imported ${b.importedAt?.toISOString().slice(0, 16).replace("T", " ")}` : b.status === "PREVIEW" ? "Preview, not imported" : "Discarded"}</td>
                <td className="px-3 py-3 text-xs">{b.createdBy.name}</td>
              </tr>
            ); })}
            {batches.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">No imports yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function ImportPage() {
  return (
    <main>
      <PageHeader title="Bulk import & export" subtitle="Load staff profiles or buildings, rooms and beds from CSV. Every file is previewed row by row before anything is written." crumbs={[["Administration"], ["Import & export"]]} />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense>
    </main>
  );
}
