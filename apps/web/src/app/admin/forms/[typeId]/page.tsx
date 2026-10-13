import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/authorize";
import { APPROVER_ROLES, FORM_BUILDER_ROLES, currentOf, draftOf, getType } from "@sam/core/modules/requests/builder";
import { parseSchema } from "@sam/core/modules/requests/forms";
import { CreateDraftButton, FormBuilder, TypeSettingsForm } from "@/modules/requests/components/form-builder";
import { FieldList } from "@/modules/requests/components/dynamic-form";

type Params = Promise<{ typeId: string }>;
const when = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "");

async function Content({ params }: { params: Params }) {
  const { typeId } = await params;
  const user = await requireRole(FORM_BUILDER_ROLES, `/admin/forms/${typeId}`);
  const type = await getType(typeId);
  if (!type || type.organizationId !== user.organizationId) notFound();
  const current = currentOf(type);
  const draft = draftOf(type);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title">{type.name}</h1>
        <span data-type-status={type.status} className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs">{type.status === "ACTIVE" ? "Active" : "Inactive"}</span>
      </div>
      <p className="mt-1 text-sm text-zinc-600">{type.code}{type.description ? ` · ${type.description}` : ""} · {type._count.requests} request{type._count.requests === 1 ? "" : "s"} so far</p>

      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">{draft ? `Draft (version ${draft.version})` : "Draft"}</h2>
          {!draft && <CreateDraftButton typeId={type.id} label={current ? "Start a new version" : "Start editing"} />}
        </div>
        {draft ? (
          <div className="mt-3"><FormBuilder key={draft.id} typeId={type.id} draft={{ id: draft.id, version: draft.version, changeNote: draft.changeNote }} initialFields={parseSchema(draft.formSchema).fields} initialSteps={draft.steps.map((s) => ({ name: s.name, approverRole: s.approverRole, requireComment: s.requireComment }))} roles={APPROVER_ROLES} /></div>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">{current ? "Start a new version to change the form or route. The current version stays live until you publish." : "This type has no published version yet, so residents cannot see it."}</p>
        )}
      </section>

      {current && (
        <section className="mt-8" data-current-version>
          <h2 className="section-title">Published version {current.version}</h2>
          <p className="mt-1 text-xs text-zinc-500">Published {when(current.publishedAt)}{current.publishedBy ? ` by ${current.publishedBy.name}` : ""}{current.changeNote ? ` · ${current.changeNote}` : ""}. Residents submit against this version.</p>
          <div className="mt-3 grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="card p-4"><FieldList fields={parseSchema(current.formSchema).fields} values={{}} errors={{}} preview /></div>
            <div className="card p-4 text-sm">
              <h3 className="font-medium">Approval route</h3>
              {current.steps.length === 0 ? <p className="mt-1 text-zinc-500">Approved on submission.</p> : (
                <ol className="mt-1 list-decimal space-y-1 pl-5">{current.steps.map((s) => <li key={s.id}>{s.name} <span className="text-xs text-zinc-500">· {s.approverRole.toLowerCase().replaceAll("_", " ")}{s.requireComment ? " · comment required" : ""}</span></li>)}</ol>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="section-title">Versions</h2>
        <div className="mt-2 overflow-x-auto card">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500"><tr><th className="px-3 py-2">Version</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Fields / steps</th><th className="px-3 py-2">Published</th><th className="px-3 py-2">Note</th><th className="px-3 py-2 text-right">Requests</th></tr></thead>
            <tbody className="divide-y divide-zinc-200">
              {type.versions.map((v) => (
                <tr key={v.id} data-version={v.version} data-version-state={v.isCurrent ? "current" : v.publishedAt ? "superseded" : "draft"}>
                  <td className="px-3 py-2">v{v.version}</td>
                  <td className="px-3 py-2">{v.isCurrent ? "Current" : v.publishedAt ? "Superseded" : "Draft"}</td>
                  <td className="px-3 py-2 tabular-nums">{parseSchema(v.formSchema).fields.length} / {v.steps.length}</td>
                  <td className="px-3 py-2 text-xs">{v.publishedAt ? `${when(v.publishedAt)}${v.publishedBy ? ` · ${v.publishedBy.name}` : ""}` : v.createdBy ? `drafted by ${v.createdBy.name}` : ""}</td>
                  <td className="px-3 py-2 text-xs">{v.changeNote ?? ""}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{v._count.requests}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8"><TypeSettingsForm type={{ id: type.id, name: type.name, description: type.description, status: type.status, reminderAfterDays: type.reminderAfterDays, escalateAfterDays: type.escalateAfterDays, escalateToRole: type.escalateToRole, expireAfterDays: type.expireAfterDays }} roles={APPROVER_ROLES} /></section>
      <p className="mt-6 text-sm"><Link href="/admin/forms" className="underline">← All request types</Link></p>
    </>
  );
}

export default function FormTypePage({ params }: PageProps<"/admin/forms/[typeId]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content params={params as Params} /></Suspense>
    </main>
  );
}
