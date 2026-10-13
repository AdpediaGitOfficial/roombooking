import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser, userCan, userCanAccess } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { listRestricted } from "@sam/core/modules/security/service";
import { ActionForm } from "@/components/forms/action-form";
import { restrictedAddAction, restrictedRemoveAction } from "@/modules/security/actions";
import { siteOptions } from "@/modules/security/context";
import { SecurityTabs } from "@/modules/security/tabs";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireUser("/security/restricted");
  if (!userCanAccess(user, "sec.restricted_view")) redirect("/forbidden");
  const sites = await visibleSites(user, "sec.restricted_view");
  const [rows, siteList] = await Promise.all([listRestricted(sites), siteOptions(sites)]);
  const edit = userCan(user, "sec.restricted_edit");
  return (
    <>
      <SecurityTabs user={user} active="restricted" />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <section className="panel"><ul className="divide-y divide-zinc-200">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><div><b>{r.name}</b>{r.idNumber ? <span className="text-xs text-zinc-500"> · {r.idNumber}</span> : null}<div className="text-xs text-zinc-600">{r.reason}</div></div>{r.removalRequestedAt && <span className="chip chip-warning">removal requested</span>}</div>
              {edit && r.removalRequestedById !== user.id && <details className="mt-1"><summary className="cursor-pointer text-xs underline">{r.removalRequestedAt ? "Approve removal" : "Request removal"}</summary><div className="mt-2"><ActionForm compact tone="secondary" action={restrictedRemoveAction} hidden={{ entryId: r.id }} submit={r.removalRequestedAt ? "Approve removal" : "Request removal"} fields={[{ name: "note", label: "Reason", required: true, defaultValue: r.removalNote ?? "" }]} /></div></details>}
            </li>
          ))}
          {rows.length === 0 && <li className="px-4 py-6 text-center text-zinc-500">Nobody is on the list.</li>}
        </ul></section>
        {edit && <ActionForm action={restrictedAddAction} title="Add to the list" submit="Add" fields={[{ name: "siteId", label: "Applies to", type: "select", options: [{ value: "", label: "All sites" }, ...siteList.map((s) => ({ value: s.id, label: s.name }))] }, { name: "name", label: "Name", required: true }, { name: "idNumber", label: "ID number" }, { name: "reason", label: "Reason", type: "textarea", required: true }]} />}
      </div>
    </>
  );
}

export default function RestrictedPage() {
  return <main><PageHeader title="Restricted entry list" subtitle="People who must not be admitted. Removing someone needs two Admins." crumbs={[["Security", "/security"], ["Restricted list"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
