import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/authorize";
import { myClaims, publicItems } from "@/modules/lost-found/service";
import { OutcomeBadge, StatusBadge, when } from "@/modules/lost-found/components/views";

type Search = Promise<{ q?: string }>;

async function Content({ searchParams }: { searchParams: Search }) {
  const user = await requireUser("/my/lost-found");
  const { q } = await searchParams;
  const [items, claims] = await Promise.all([publicItems({ q: q || null }), myClaims(user.id)]);
  const claimedIds = new Set(claims.filter((c) => c.outcome === "PENDING").map((c) => c.item.id));
  return (
    <>
      {claims.length > 0 && (
        <section className="mt-6" data-my-claims>
          <h2 className="text-lg font-semibold">My claims</h2>
          <ul className="mt-2 space-y-2">
            {claims.map((c) => (
              <li key={c.id} data-claim-outcome={c.outcome} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/my/lost-found/${c.item.id}`} className="font-medium underline">{c.item.reference} · {c.item.description}</Link><OutcomeBadge outcome={c.outcome} /></div>
                <div className="mt-1 text-xs text-zinc-500">{c.outcome === "VERIFIED" && c.item.status !== "RETURNED" ? "Verified: collect it from the accommodation office with your ID." : c.item.status === "RETURNED" ? `Handed over ${c.item.handedOverAt ? when(c.item.handedOverAt) : ""}` : c.decisionNote ? c.decisionNote : `Submitted ${when(c.createdAt)}`}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="mt-6">
        <h2 className="text-lg font-semibold">Found items</h2>
        <p className="mt-1 text-xs text-zinc-500">Lost something? Look for it here and submit a claim. The office checks every claim before handing anything over.</p>
        <form method="get" action="/my/lost-found" className="mt-2 flex gap-2 text-sm">
          <input name="q" defaultValue={q ?? ""} placeholder="Search e.g. wallet, keys, Block A" className="flex-1 rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" aria-label="Search" />
          <button type="submit" className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700">Search</button>
        </form>
        <ul className="mt-3 space-y-2">
          {items.map((i) => (
            <li key={i.id} data-found={i.reference} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/my/lost-found/${i.id}`} className="font-medium underline">{i.description}</Link>{claimedIds.has(i.id) ? <span className="text-xs text-zinc-500">claim pending</span> : <StatusBadge status={i.status} />}</div>
              <div className="mt-1 text-xs text-zinc-500">{i.category ? `${i.category} · ` : ""}found {when(i.foundAt)}{i.foundLocation ? ` at ${i.foundLocation}` : ""} · {i.site.name}</div>
            </li>
          ))}
          {items.length === 0 && <li className="text-sm text-zinc-500">No found items{q ? " match" : " at the moment"}.</li>}
        </ul>
      </section>
    </>
  );
}

export default function MyLostFoundPage({ searchParams }: PageProps<"/my/lost-found">) {
  return (
    <main>
      <h1 className="text-2xl font-semibold">Lost &amp; found</h1>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Loading…</p>}>
        <Content searchParams={searchParams as Search} />
      </Suspense>
    </main>
  );
}
