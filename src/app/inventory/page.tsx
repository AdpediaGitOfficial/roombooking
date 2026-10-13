import { Suspense } from "react";
import Link from "next/link";
import { hasRole, requireRole } from "@/lib/auth/authorize";
import { INVENTORY_MANAGE_ROLES, INVENTORY_VIEW_ROLES } from "@/modules/inventory/access";
import { ITEM_FILTERS, categories, describeLocation, inventorySummary, listItems, type ItemFilter } from "@/modules/inventory/service";
import { targetOptions } from "@/modules/inventory/context";
import { ConditionBadge, ItemStateBadge } from "@/modules/inventory/components/views";
import { CreateItemForm } from "@/modules/inventory/components/forms";

type Search = Promise<{ filter?: string; q?: string; category?: string }>;

async function Register({ searchParams }: { searchParams: Search }) {
  const user = await requireRole(INVENTORY_VIEW_ROLES, "/inventory");
  const canManage = hasRole(user, ...INVENTORY_MANAGE_ROLES);
  const { filter: raw, q, category } = await searchParams;
  const filter = (ITEM_FILTERS.some(([f]) => f === raw) ? raw : "all") as ItemFilter;
  const [items, summary, cats, options] = await Promise.all([listItems({ filter, q: q || null, category: category || null }), inventorySummary(), categories(), canManage ? targetOptions() : null]);
  const query = (f: ItemFilter) => `/inventory?filter=${f}${q ? `&q=${encodeURIComponent(q)}` : ""}${category ? `&category=${encodeURIComponent(category)}` : ""}`;
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[["Stock lines", summary.stockLines], ["Assets", summary.assets], ["Assets issued", summary.issued], ["Low stock", summary.lowStock], ["Damaged", summary.damaged]].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"><dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt><dd data-summary={label} className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd></div>
        ))}
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <nav className="flex flex-wrap gap-2 text-sm">
          {ITEM_FILTERS.map(([f, label]) => <Link key={f} href={query(f)} className={`rounded-full px-3 py-1 ${f === filter ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}>{label}</Link>)}
        </nav>
        <form method="get" action="/inventory" className="ml-auto flex items-center gap-2 text-sm">
          <input type="hidden" name="filter" value={filter} />
          <select name="category" defaultValue={category ?? ""} className="rounded-md border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900" aria-label="Category"><option value="">All categories</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <input name="q" defaultValue={q ?? ""} placeholder="Search name, SKU, serial" className="rounded-md border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900" aria-label="Search" />
          <button type="submit" className="rounded-md border border-zinc-300 px-3 py-1.5 dark:border-zinc-700">Search</button>
        </form>
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
            <tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Site</th><th className="px-3 py-2 text-right">On hand</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Location</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {items.map((item) => (
              <tr key={item.id} data-item={item.serialNumber ?? item.sku}>
                <td className="px-3 py-3"><Link href={`/inventory/${item.id}`} className="font-medium underline">{item.name}</Link><div className="text-xs text-zinc-500">{item.sku}{item.serialNumber ? ` · #${item.serialNumber}` : ""}</div></td>
                <td className="px-3 py-3">{item.category}</td>
                <td className="px-3 py-3">{item.site.name}</td>
                <td className="px-3 py-3 text-right tabular-nums">{item.trackingType === "STOCK" ? `${item.quantity} ${item.unit}${item.reorderThreshold != null ? ` / min ${item.reorderThreshold}` : ""}` : item.quantity === 1 ? "1" : "—"}</td>
                <td className="px-3 py-3"><ItemStateBadge item={item} />{item.trackingType === "SERIALIZED" && <span className="ml-1"><ConditionBadge condition={item.condition} /></span>}</td>
                <td className="px-3 py-3 text-xs">{describeLocation(item)}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500">No items match.</td></tr>}
          </tbody>
        </table>
      </div>
      {options && <div className="mt-6"><CreateItemForm sites={options.sites} categories={cats} /></div>}
    </>
  );
}

export default function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  return (
    <main>
      <h1 className="text-2xl font-semibold">Inventory</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-600 dark:text-zinc-400">Stock lines and serialised assets: receipts, issues, returns, transfers, adjustments, damage and retirement.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Register searchParams={searchParams as Search} />
      </Suspense>
    </main>
  );
}
