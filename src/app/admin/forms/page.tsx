import { Suspense } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/authorize";
import { FORM_BUILDER_ROLES, currentOf, draftOf, listTypes } from "@/modules/requests/builder";
import { CreateTypeForm } from "@/modules/requests/components/form-builder";

async function Content() {
  const user = await requireRole(FORM_BUILDER_ROLES, "/admin/forms");
  const types = await listTypes(user.organizationId);
  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
            <tr><th className="px-3 py-2">Request type</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Published</th><th className="px-3 py-2">Draft</th><th className="px-3 py-2 text-right">Requests</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {types.map((t) => {
              const current = currentOf(t);
              const draft = draftOf(t);
              return (
                <tr key={t.id} data-type={t.code}>
                  <td className="px-3 py-3"><Link href={`/admin/forms/${t.id}`} className="font-medium underline">{t.name}</Link><div className="text-xs text-zinc-500">{t.code}{t.description ? ` · ${t.description}` : ""}</div></td>
                  <td className="px-3 py-3 text-xs">{t.status === "ACTIVE" ? "Active" : "Inactive"}</td>
                  <td className="px-3 py-3 text-xs">{current ? `v${current.version} · ${(current.formSchema as { fields?: unknown[] }).fields?.length ?? 0} fields · ${current.steps.length} steps` : "not yet"}</td>
                  <td className="px-3 py-3 text-xs">{draft ? `v${draft.version} in progress` : "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{t._count.requests}</td>
                </tr>
              );
            })}
            {types.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">No request types yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-6"><CreateTypeForm /></div>
    </>
  );
}

export default function FormsPage() {
  return (
    <main>
      <h1 className="text-2xl font-semibold">Forms &amp; approval routes</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-600 dark:text-zinc-400">Design request forms (fields, required flags, help text, conditional visibility) and their approval routes. Changes are drafted, then published as a new version; requests already submitted keep the version they used.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense>
    </main>
  );
}
