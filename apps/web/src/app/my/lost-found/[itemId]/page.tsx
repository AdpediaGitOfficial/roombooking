import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/authorize";
import { api, orNotFound } from "@/lib/api";
import { OutcomeBadge, PhotoStrip, StatusBadge, when } from "@/modules/lost-found/components/views";
import { ItemForm, MyClaimForm } from "@/modules/lost-found/components/forms";

type Params = Promise<{ itemId: string }>;

async function Content({ params }: { params: Params }) {
  const { itemId } = await params;
  await requireUser(`/my/lost-found/${itemId}`);
  // Residents see the public description only; never other people's claims or where it is kept.
  const { item, photos } = await orNotFound(api.lostFound.getMine({ id: itemId }));
  const mine = item.claims[0] ?? null;
  const open = ["REPORTED", "STORED", "CLAIM_PENDING"].includes(item.status);
  const canClaim = open && (!mine || (mine.outcome !== "PENDING" && mine.outcome !== "VERIFIED"));
  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-2"><h1 className="page-title">{item.description}</h1><StatusBadge status={item.status} /></div>
      <p className="mt-1 text-xs text-zinc-500">{item.reference}{item.category ? ` · ${item.category}` : ""} · found {when(item.foundAt)}{item.foundLocation ? ` at ${item.foundLocation}` : ""} · {item.site.name}</p>
      <div className="mt-3"><PhotoStrip photos={photos} /></div>
      {mine && (
        <section className="mt-5 card p-3 text-sm" data-my-claim-status>
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">Your claim</span><OutcomeBadge outcome={mine.outcome} /></div>
          <p className="mt-1">{mine.evidence}</p>
          <p className="mt-1 text-xs text-zinc-500">{mine.outcome === "PENDING" ? "The office will check this and let you know." : mine.outcome === "VERIFIED" ? (item.status === "RETURNED" ? `Handed over ${item.handedOverAt ? when(item.handedOverAt) : ""}.` : "Verified. Collect it from the accommodation office with your ID.") : mine.decisionNote ?? ""}</p>
          {mine.outcome === "PENDING" && <div className="mt-2"><ItemForm kind="WITHDRAW" itemId={item.id} claimId={mine.id} compact /></div>}
        </section>
      )}
      {canClaim && <div className="mt-5"><MyClaimForm itemId={item.id} /></div>}
      {!open && !mine && <p className="mt-5 text-sm text-zinc-500">This item is no longer available.</p>}
      <p className="mt-6 text-sm"><Link href="/my/lost-found" className="underline">← All found items</Link></p>
    </>
  );
}

export default function MyLostFoundItemPage({ params }: PageProps<"/my/lost-found/[itemId]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content params={params as Params} />
      </Suspense>
    </main>
  );
}
