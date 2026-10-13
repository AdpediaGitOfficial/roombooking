import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasRole, requireRole } from "@/lib/auth/authorize";
import { LOST_FOUND_MANAGE_ROLES, LOST_FOUND_OPERATE_ROLES, LOST_FOUND_VIEW_ROLES } from "@sam/core/modules/lost-found/access";
import { CATEGORIES, DISPOSAL_METHODS, claimantLabel, getItem, isDueForDisposal, similarItems } from "@sam/core/modules/lost-found/service";
import { registerOptions } from "@/modules/lost-found/context";
import { OutcomeBadge, PhotoStrip, StatusBadge, when } from "@/modules/lost-found/components/views";
import { EditItemForm, ItemForm } from "@/modules/lost-found/components/forms";

type Params = Promise<{ itemId: string }>;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt><dd className="mt-0.5 text-sm">{children}</dd></div>;
}

async function Content({ params }: { params: Params }) {
  const { itemId } = await params;
  const user = await requireRole(LOST_FOUND_VIEW_ROLES, `/lost-found/${itemId}`);
  const canOperate = hasRole(user, ...LOST_FOUND_OPERATE_ROLES);
  const canManage = hasRole(user, ...LOST_FOUND_MANAGE_ROLES);
  const detail = await getItem(itemId);
  if (!detail) notFound();
  const { item, photos } = detail;
  const now = new Date();
  const open = ["REPORTED", "STORED", "CLAIM_PENDING"].includes(item.status);
  const pending = item.claims.filter((c) => c.outcome === "PENDING");
  const verified = item.claims.find((c) => c.id === item.resolvedClaimId);
  const [similar, options] = await Promise.all([open ? similarItems({ description: item.description, category: item.category, foundAt: item.foundAt, siteId: item.siteId, excludeId: item.id }) : [], canOperate ? registerOptions() : null]);
  const due = isDueForDisposal(item, now);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title">{item.reference}</h1>
        <StatusBadge status={item.status} />
        {due && <span data-due className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-900">Retention expired</span>}
      </div>
      <p className="mt-1 text-lg">{item.description}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 card p-4 sm:grid-cols-4">
        <Field label="Category">{item.category ?? "—"}</Field>
        <Field label="Found">{when(item.foundAt)}{item.foundLocation ? ` · ${item.foundLocation}` : ""}{item.foundByName ? ` · by ${item.foundByName}` : ""}</Field>
        <Field label="Site">{item.site.name}</Field>
        <Field label="Custodian">{item.custodian.name}</Field>
        <Field label="Stored at">{item.storageLocation ?? "not yet stored"}</Field>
        <Field label="Keep until">{item.retainUntil ? item.retainUntil.toISOString().slice(0, 10) : "—"}</Field>
        <Field label="Registered">{when(item.createdAt)} by {item.registeredBy.name}</Field>
        {item.notes && <Field label="Notes">{item.notes}</Field>}
        {item.status === "RETURNED" && <Field label="Handed over">{item.handedOverAt ? when(item.handedOverAt) : ""} to {item.handedOverToName} by {item.handedOverBy?.name}{item.handoverNote ? ` · ${item.handoverNote}` : ""}</Field>}
        {item.status === "DISPOSED" && <Field label="Disposed">{item.disposedAt ? when(item.disposedAt) : ""} · {item.disposalMethod} · authorised by {item.disposalAuthorisedBy?.name}{item.disposalNote ? ` · ${item.disposalNote}` : ""}</Field>}
      </dl>
      <div className="mt-3"><PhotoStrip photos={photos} /></div>

      {similar.length > 0 && (
        <section className="mt-6" data-similar>
          <h2 className="section-title">Possibly the same item</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {similar.map((s) => <li key={s.item.id}><Link href={`/lost-found/${s.item.id}`} className="underline">{s.item.reference}</Link> · {s.item.description} · found {when(s.item.foundAt)} <span className="text-xs text-zinc-500">{s.sameCategory ? "same category" : ""}{s.shared.length ? ` shares: ${s.shared.join(", ")}` : ""}</span></li>)}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="section-title">Claims</h2>
        <p className="mt-1 text-xs text-zinc-500">Claimant details are visible only to lost and found staff.</p>
        {item.claims.length === 0 ? <p className="mt-2 text-sm text-zinc-500">No claims yet.</p> : (
          <ul className="mt-2 space-y-3">
            {item.claims.map((c) => (
              <li key={c.id} data-claim={c.id} className="card p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">{claimantLabel(c)}{c.claimantContact ? <span className="ml-2 text-xs font-normal text-zinc-500">{c.claimantContact}</span> : null}</div>
                  <OutcomeBadge outcome={c.outcome} />
                </div>
                <p className="mt-1">{c.evidence}</p>
                <div className="mt-1 text-xs text-zinc-500">Submitted {when(c.createdAt)}{c.decidedAt ? ` · decided ${when(c.decidedAt)} by ${c.decidedBy?.name ?? ""}` : ""}{c.decisionNote ? ` · ${c.decisionNote}` : ""}</div>
                {canOperate && c.outcome === "PENDING" && item.status === "CLAIM_PENDING" && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <ItemForm kind="VERIFY" itemId={item.id} claimId={c.id} compact />
                    <ItemForm kind="REJECT" itemId={item.id} claimId={c.id} compact />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canOperate && open && options && (
        <section className="mt-6">
          <h2 className="section-title">Actions</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {verified && <ItemForm kind="HANDOVER" itemId={item.id} />}
            {!verified && <ItemForm kind="CLAIM" itemId={item.id} staff={options.staff} />}
            <ItemForm kind="STORE" itemId={item.id} defaultStorage={item.storageLocation} />
            <ItemForm kind="PHOTO" itemId={item.id} />
            {canManage && pending.length === 0 && !verified && <ItemForm kind="DISPOSE" itemId={item.id} methods={DISPOSAL_METHODS} />}
          </div>
          <div className="mt-4"><EditItemForm item={{ id: item.id, description: item.description, category: item.category, foundLocation: item.foundLocation, foundByName: item.foundByName, notes: item.notes, retainUntil: item.retainUntil ? item.retainUntil.toISOString().slice(0, 10) : null }} categories={CATEGORIES} /></div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="section-title">History</h2>
        <ol data-timeline className="mt-2 divide-y divide-zinc-200 card text-sm">
          {item.events.map((e) => (
            <li key={e.id} data-event={e.type} className="flex flex-wrap justify-between gap-2 p-3">
              <div><span className="font-medium">{e.type.toLowerCase().replaceAll("_", " ")}</span>{e.notes && <span className="ml-2 text-zinc-600">{e.notes}</span>}{e.toStatus && e.fromStatus !== e.toStatus && <span className="ml-2 text-xs text-zinc-500">→ {e.toStatus.toLowerCase().replace("_", " ")}</span>}</div>
              <div className="text-xs text-zinc-500">{when(e.createdAt)} · {e.actor.name}</div>
            </li>
          ))}
        </ol>
      </section>
      <p className="mt-6 text-sm"><Link href="/lost-found" className="underline">← Register</Link></p>
    </>
  );
}

export default function LostFoundItemPage({ params }: PageProps<"/lost-found/[itemId]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content params={params as Params} />
      </Suspense>
    </main>
  );
}
