import { Suspense } from "react";
import { requireCapability, userCan } from "@/lib/auth/authorize";
import { listChanges } from "@sam/core/modules/admin/change-requests";
import { activeSuperAdmins } from "@sam/core/modules/admin/change-requests";
import { CancelChangeForm, DecideChangeForm } from "@/modules/admin/components/forms";
import { PageHeader } from "@/components/shell/page-header";

const STATUS_STYLE: Record<string, string> = { PENDING: "bg-amber-100 text-amber-800", APPROVED: "bg-green-100 text-green-800", REJECTED: "bg-red-100 text-red-800", CANCELLED: "bg-zinc-200 text-zinc-700" };

async function Content() {
  const user = await requireCapability("setup.roles", { returnTo: "/admin/changes", level: "access" });
  const canDecide = userCan(user, "setup.roles");
  const [changes, admins] = await Promise.all([listChanges(user.organizationId), activeSuperAdmins(user.organizationId)]);
  const pending = changes.filter((c) => c.status === "PENDING");
  return (
    <>
      <p className="text-sm text-zinc-600">Role and permission changes, workflow publishing and bulk changes are checked by a second Super Admin. {admins.length < 2 ? <b>Only one Super Admin is active, so changes apply immediately and the audit log records that the check was waived. Keep at least two Super Admins plus a break-glass account.</b> : `${admins.length} Super Admins are active.`}</p>
      <section className="mt-6">
        <h2 className="section-title">Waiting for approval ({pending.length})</h2>
        <ul className="mt-3 space-y-3">
          {pending.map((c) => (
            <li key={c.id} className="card p-4" data-change={c.id}>
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{c.summary}</span><span className="text-xs text-zinc-500">{c.kind.toLowerCase().replace(/_/g, " ")} · raised by {c.requestedBy.name} · {c.createdAt.toISOString().replace("T", " ").slice(0, 16)}</span></div>
              <pre className="mt-2 overflow-x-auto rounded bg-zinc-50 p-2 text-xs">{JSON.stringify(c.payload, null, 1)}</pre>
              {canDecide && c.requestedById !== user.id && <DecideChangeForm changeRequestId={c.id} />}
              {c.requestedById === user.id && <><p className="mt-2 text-xs text-zinc-500">You raised this change, so a different Super Admin must decide it.</p><CancelChangeForm changeRequestId={c.id} /></>}
            </li>
          ))}
          {pending.length === 0 && <li className="card p-4 text-sm text-zinc-500">Nothing is waiting.</li>}
        </ul>
      </section>
      <section className="mt-8">
        <h2 className="section-title">History</h2>
        <ol className="card mt-3 divide-y divide-zinc-200 text-sm">
          {changes.filter((c) => c.status !== "PENDING").map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span><span className={`chip ${STATUS_STYLE[c.status]}`}>{c.status.toLowerCase()}</span> <span className="ml-2">{c.summary}</span>{c.decisionNote ? <span className="ml-2 text-xs text-zinc-500">“{c.decisionNote}”</span> : null}</span>
              <span className="text-xs text-zinc-500">{c.requestedBy.name}{c.decidedBy ? ` → ${c.decidedBy.name}` : ""} · {(c.decidedAt ?? c.createdAt).toISOString().slice(0, 10)}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

export default function ChangesPage() {
  return (
    <main className="max-w-4xl">
      <PageHeader title="Pending changes" subtitle="Maker-checker: a second Super Admin approves high-risk changes." crumbs={[["Administration"], ["Pending changes"]]} />
      <div className="mt-6"><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></div>
    </main>
  );
}
