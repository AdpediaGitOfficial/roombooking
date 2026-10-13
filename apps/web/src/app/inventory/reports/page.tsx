import { Suspense } from "react";
import Link from "next/link";
import type { InventoryTransactionType } from "@prisma/client";
import { requireRole } from "@/lib/auth/authorize";
import { prisma } from "@sam/core/lib/db";
import { INVENTORY_VIEW_ROLES } from "@sam/core/modules/inventory/access";
import { allocatedReport, conditionReport, describeCondition, describeTransaction, movementReport, stockBalanceReport } from "@sam/core/modules/inventory/service";
import { TransactionTable } from "@/modules/inventory/components/views";
import { PageHeader } from "@/components/shell/page-header";

type Search = Promise<{ siteId?: string; from?: string; to?: string; type?: string }>;
const TYPES: InventoryTransactionType[] = ["RECEIPT", "ISSUE", "RETURN", "TRANSFER", "ADJUSTMENT", "DAMAGE", "RETIREMENT"];
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function Reports({ searchParams }: { searchParams: Search }) {
  await requireRole(INVENTORY_VIEW_ROLES, "/inventory/reports");
  const sp = await searchParams;
  const siteId = sp.siteId || null;
  const type = TYPES.includes(sp.type as InventoryTransactionType) ? (sp.type as InventoryTransactionType) : null;
  const now = new Date();
  const to = isDate(sp.to) ? sp.to! : now.toISOString().slice(0, 10);
  const from = isDate(sp.from) ? sp.from! : new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const [sites, balance, movements, allocated, conditions] = await Promise.all([
    prisma.site.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
    stockBalanceReport(siteId),
    movementReport({ siteId, from, to, type }, 200),
    allocatedReport(siteId),
    conditionReport(siteId),
  ]);
  const qs = new URLSearchParams({ ...(siteId ? { siteId } : {}), from, to, ...(type ? { type } : {}) }).toString();
  const sel = "rounded-md border border-zinc-300 px-2 py-1.5 text-sm";
  return (
    <>
      <form method="get" action="/inventory/reports" className="flex flex-wrap items-end gap-2 text-sm">
        <label className="block">Site<select name="siteId" defaultValue={siteId ?? ""} className={`${sel} mt-1 block`}><option value="">All sites</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="block">From<input type="date" name="from" defaultValue={from} className={`${sel} mt-1 block`} /></label>
        <label className="block">To<input type="date" name="to" defaultValue={to} className={`${sel} mt-1 block`} /></label>
        <label className="block">Movement<select name="type" defaultValue={type ?? ""} className={`${sel} mt-1 block`}><option value="">All</option>{TYPES.map((t) => <option key={t} value={t}>{describeTransaction(t)}</option>)}</select></label>
        <button type="submit" className="rounded-md border border-zinc-300 px-3 py-1.5">Apply</button>
        <a href={`/api/reports/inventory-movements.csv?${qs}`} className="rounded-md bg-primary px-3 py-1.5 text-primary-ink">Download movements CSV</a>
      </form>

      <section className="mt-6">
        <h2 className="section-title">Stock balance by category</h2>
        <div className="mt-2 overflow-x-auto card">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500"><tr><th className="px-3 py-2">Category</th><th className="px-3 py-2 text-right">Stock lines</th><th className="px-3 py-2 text-right">Units on hand</th><th className="px-3 py-2 text-right">Low stock</th><th className="px-3 py-2 text-right">Assets</th><th className="px-3 py-2 text-right">Assets issued</th></tr></thead>
            <tbody className="divide-y divide-zinc-200">
              {balance.map((r) => <tr key={r.category} data-balance={r.category}><td className="px-3 py-2">{r.category}</td><td className="px-3 py-2 text-right tabular-nums">{r.lines}</td><td className="px-3 py-2 text-right tabular-nums">{r.units}</td><td className={`px-3 py-2 text-right tabular-nums ${r.low ? "text-amber-700" : ""}`}>{r.low}</td><td className="px-3 py-2 text-right tabular-nums">{r.assets}</td><td className="px-3 py-2 text-right tabular-nums">{r.assetsIssued}</td></tr>)}
              {balance.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500">No items.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="section-title">Asset condition</h2>
        <div className="mt-2 overflow-x-auto card">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500"><tr><th className="px-3 py-2">Condition</th><th className="px-3 py-2 text-right">Assets</th><th className="px-3 py-2 text-right">Of which issued</th></tr></thead>
            <tbody className="divide-y divide-zinc-200">
              {conditions.map((r) => <tr key={r.condition} data-condition-row={r.condition}><td className="px-3 py-2">{describeCondition(r.condition)}</td><td className="px-3 py-2 text-right tabular-nums">{r.count}</td><td className="px-3 py-2 text-right tabular-nums">{r.issued}</td></tr>)}
              {conditions.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-zinc-500">No serialised assets.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="section-title">Allocated items by location</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {allocated.map((g) => (
            <div key={`${g.kind}:${g.label}`} data-allocated={g.label} className="card p-3 text-sm">
              <div className="font-medium">{g.label} <span className="text-xs font-normal text-zinc-500">· {g.kind}</span></div>
              <ul className="mt-1 space-y-0.5">{g.items.map((i) => <li key={`${i.itemId}`} className="flex justify-between"><Link href={`/inventory/${i.itemId}`} className="underline">{i.name}{i.serialNumber ? ` #${i.serialNumber}` : ""}</Link><span className="tabular-nums text-zinc-600">{i.quantity} {i.unit}{i.since ? ` · since ${i.since.toISOString().slice(0, 10)}` : ""}</span></li>)}</ul>
            </div>
          ))}
          {allocated.length === 0 && <p className="text-sm text-zinc-500">Nothing is issued at the moment.</p>}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="section-title">Movements {from} to {to}{type ? ` · ${describeTransaction(type)}` : ""}</h2>
        <p className="mt-1 text-xs text-zinc-500">Latest 200 shown; the CSV holds everything in the range.</p>
        <div className="mt-2"><TransactionTable rows={movements} showItem /></div>
      </section>
    </>
  );
}

export default function InventoryReportsPage({ searchParams }: PageProps<"/inventory/reports">) {
  return (
    <main>
      <PageHeader title="Inventory reports" subtitle="Stock balance, movements, allocated items and asset condition." crumbs={[["Inventory", "/inventory"], ["Reports"]]} />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Reports searchParams={searchParams as Search} />
      </Suspense>
    </main>
  );
}
