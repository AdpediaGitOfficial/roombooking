import { Suspense } from "react";
import Link from "next/link";
import { hasRole, requireRole } from "@/lib/auth/authorize";
import { LOST_FOUND_OPERATE_ROLES, LOST_FOUND_VIEW_ROLES } from "@/modules/lost-found/access";
import { CATEGORIES, ITEM_FILTERS, RETENTION_DAYS, listItems, lostFoundSummary, type ItemFilter } from "@/modules/lost-found/service";
import { registerOptions } from "@/modules/lost-found/context";
import { StatusBadge, when } from "@/modules/lost-found/components/views";
import { RegisterItemForm } from "@/modules/lost-found/components/forms";
import { PageHeader } from "@/components/shell/page-header";

type Search = Promise<{ filter?: string; q?: string }>;

async function Register({ searchParams }: { searchParams: Search }) {
  const user = await requireRole(LOST_FOUND_VIEW_ROLES, "/lost-found");
  const canOperate = hasRole(user, ...LOST_FOUND_OPERATE_ROLES);
  const { filter: raw, q } = await searchParams;
  const filter = (ITEM_FILTERS.some(([f]) => f === raw) ? raw : "open") as ItemFilter;
  const now = new Date();
  const [items, summary, options] = await Promise.all([listItems({ filter, q: q || null, now }), lostFoundSummary(null, now), canOperate ? registerOptions() : null]);
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[["Open items", summary.open], ["Claims to verify", summary.claims], ["Due for disposal", summary.due], ["Returned (30 d)", summary.returned30], ["Disposed (30 d)", summary.disposed30]].map(([label, value]) => (
          <div key={label} className="kpi"><dt className="kpi-label">{label}</dt><dd data-summary={label} className="kpi-value">{value}</dd></div>
        ))}
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <nav className="flex flex-wrap gap-2 text-sm">
          {ITEM_FILTERS.map(([f, label]) => <Link key={f} href={`/lost-found?filter=${f}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`pill ${f === filter ? "pill-on" : ""}`}>{label}</Link>)}
        </nav>
        <form method="get" action="/lost-found" className="ml-auto flex items-center gap-2 text-sm">
          <input type="hidden" name="filter" value={filter} />
          <input name="q" defaultValue={q ?? ""} placeholder="Search reference, description, place" className="rounded-md border border-zinc-300 px-2 py-1.5" aria-label="Search" />
          <button type="submit" className="rounded-md border border-zinc-300 px-3 py-1.5">Search</button>
        </form>
      </div>
      <div className="mt-4 overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Item</th><th className="px-3 py-2">Found</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Custodian</th><th className="px-3 py-2">Keep until</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {items.map((i) => {
              const due = (i.status === "REPORTED" || i.status === "STORED") && !!i.retainUntil && i.retainUntil <= now;
              return (
                <tr key={i.id} data-item={i.reference}>
                  <td className="px-3 py-3"><Link href={`/lost-found/${i.id}`} className="font-medium underline">{i.reference}</Link></td>
                  <td className="px-3 py-3">{i.description}{i.category && <div className="text-xs text-zinc-500">{i.category}</div>}</td>
                  <td className="px-3 py-3 text-xs">{when(i.foundAt)}{i.foundLocation ? ` · ${i.foundLocation}` : ""}<div className="text-zinc-500">{i.site.name}</div></td>
                  <td className="px-3 py-3"><StatusBadge status={i.status} />{i.claims.length > 0 && <span className="ml-1 text-xs text-zinc-500">{i.claims.length} open claim{i.claims.length === 1 ? "" : "s"}</span>}</td>
                  <td className="px-3 py-3 text-xs">{i.custodian.name}</td>
                  <td className={`px-3 py-3 text-xs ${due ? "text-red-700" : ""}`}>{i.retainUntil ? i.retainUntil.toISOString().slice(0, 10) : "—"}{due ? " · due" : ""}</td>
                </tr>
              );
            })}
            {items.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500">No items match.</td></tr>}
          </tbody>
        </table>
      </div>
      {options && <div className="mt-6"><RegisterItemForm sites={options.sites} categories={CATEGORIES} defaultFoundAt={now.toISOString().slice(0, 16)} retentionDays={RETENTION_DAYS} /></div>}
    </>
  );
}

export default function LostFoundPage({ searchParams }: PageProps<"/lost-found">) {
  return (
    <main>
      <PageHeader title="Lost & found" subtitle="Found items, storage, claims, handover and disposal." crumbs={[["Lost & found"]]} />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Register searchParams={searchParams as Search} />
      </Suspense>
    </main>
  );
}
