import { Suspense } from "react";
import Link from "next/link";
import { requireCapability } from "@/lib/auth/authorize";
import { findDuplicates } from "@sam/core/modules/people/service";
import { ActionForm } from "@/components/forms/action-form";
import { mergeAction } from "@/modules/people/actions";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireCapability("people.merge", { returnTo: "/people/duplicates", level: "access" });
  const groups = await findDuplicates(user.organizationId);
  return (
    <ul className="space-y-3">
      {groups.map((g) => (
        <li key={g.people.map((p) => p.id).join()} className="card p-4">
          <div className="text-sm font-medium">{g.reason}</div>
          <ul className="mt-2 divide-y divide-zinc-100 text-sm">
            {g.people.map((p) => <li key={p.id} className="flex flex-wrap justify-between gap-2 py-1.5"><Link href={`/people/${p.id}`} className="underline">{p.name} ({p.employeeId})</Link><span className="text-zinc-500">{p.phone ?? "no phone"} · {p.verification.toLowerCase()} · {p.source.toLowerCase()}</span></li>)}
          </ul>
          {g.people.length === 2 && (
            <div className="mt-3 flex flex-wrap gap-3">
              <ActionForm compact tone="secondary" action={mergeAction} hidden={{ keepId: g.people[0].id, mergeId: g.people[1].id }} fields={[]} submit={`Keep ${g.people[0].employeeId}, merge ${g.people[1].employeeId}`} />
              <ActionForm compact tone="secondary" action={mergeAction} hidden={{ keepId: g.people[1].id, mergeId: g.people[0].id }} fields={[]} submit={`Keep ${g.people[1].employeeId}, merge ${g.people[0].employeeId}`} />
            </div>
          )}
        </li>
      ))}
      {groups.length === 0 && <li className="card p-6 text-center text-sm text-zinc-500">No likely duplicates.</li>}
    </ul>
  );
}

export default function DuplicatesPage() {
  return <main><PageHeader title="Duplicate profiles" subtitle="Matched by ID number, phone, or name and department. Merging moves stays, keys, assets and requests onto the kept profile." crumbs={[["People", "/people"], ["Duplicates"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
