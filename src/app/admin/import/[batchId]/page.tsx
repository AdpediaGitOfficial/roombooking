import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/authorize";
import { IMPORT_ROLES, KINDS, getBatch, type RowResult, type Summary } from "@/modules/imports/service";
import { CommitForm, DiscardButton } from "@/modules/imports/components/forms";

type Params = Promise<{ batchId: string }>;
const TONE: Record<RowResult["action"], string> = { create: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200", update: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200", unchanged: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300", error: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" };

async function Content({ params }: { params: Params }) {
  const { batchId } = await params;
  const user = await requireRole(IMPORT_ROLES, `/admin/import/${batchId}`);
  const batch = await getBatch(batchId);
  if (!batch || batch.organizationId !== user.organizationId) notFound();
  const spec = KINDS.find((k) => k.kind === batch.kind)!;
  const rows = batch.rows as unknown as RowResult[];
  const s = batch.summary as Summary;
  const columns = spec.columns.map((c) => c.toLowerCase());
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{batch.fileName}</h1>
        <span data-batch-state={batch.status} className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700">{batch.status === "IMPORTED" ? "Imported" : batch.status === "PREVIEW" ? "Preview" : "Discarded"}</span>
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{spec.label} · uploaded {batch.createdAt.toISOString().slice(0, 16).replace("T", " ")} by {batch.createdBy.name}{batch.importedAt ? ` · imported ${batch.importedAt.toISOString().slice(0, 16).replace("T", " ")}` : ""}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[["Rows", s.total], ["To create", s.create], ["To update", s.update], ["Unchanged", s.unchanged], ["Errors", s.error]].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"><dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt><dd data-stat={label} className={`mt-1 text-2xl font-semibold tabular-nums ${label === "Errors" && Number(value) > 0 ? "text-red-700 dark:text-red-300" : ""}`}>{value}</dd></div>
        ))}
      </dl>
      {batch.status === "PREVIEW" && (
        <div className="mt-4 flex flex-wrap items-start gap-3">
          <div className="flex-1"><CommitForm batchId={batch.id} errors={s.error} /></div>
          <DiscardButton batchId={batch.id} />
        </div>
      )}
      <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
            <tr><th className="px-3 py-2">Line</th><th className="px-3 py-2">Result</th>{spec.columns.map((c) => <th key={c} className="px-3 py-2">{c}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map((r) => (
              <tr key={r.line} data-row={r.line} data-action={r.action}>
                <td className="px-3 py-2 tabular-nums">{r.line}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[r.action]}`}>{r.action}</span>{r.note && <div className="text-xs text-zinc-500">{r.note}</div>}{r.errors.length > 0 && <ul className="mt-1 list-disc pl-4 text-xs text-red-700 dark:text-red-300">{r.errors.map((e) => <li key={e}>{e}</li>)}</ul>}</td>
                {columns.map((c) => <td key={c} className="px-3 py-2 text-xs">{r.values[c] ?? ""}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-6 text-sm"><Link href="/admin/import" className="underline">← Imports</Link></p>
    </>
  );
}

export default function ImportBatchPage({ params }: PageProps<"/admin/import/[batchId]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content params={params as Params} /></Suspense>
    </main>
  );
}
