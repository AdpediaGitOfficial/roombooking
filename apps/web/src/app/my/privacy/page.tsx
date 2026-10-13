import { Suspense } from "react";
import Link from "next/link";
import { requireResident } from "@/modules/self-service/context";
import { CONSENT_VERSION, myDataRequests } from "@sam/core/modules/privacy/service";
import { ActionForm } from "@/components/forms/action-form";
import { dataRequestAction } from "@/modules/privacy/actions";

async function Content() {
  const { user } = await requireResident("/my/privacy");
  const reqs = await myDataRequests(user.id);
  return (
    <>
      <p className="mt-2 text-sm text-zinc-600">You agreed to the privacy notice (version {user.consentVersion ?? CONSENT_VERSION}) on {user.consentAcceptedAt ? user.consentAcceptedAt.toISOString().slice(0, 10) : "—"}.</p>
      <section className="card mt-4 p-4"><h2 className="font-medium">Your data</h2><p className="mt-1 text-sm text-zinc-600">Download everything we hold about you: profile, stays, requests, tickets, bookings, visitors, parcels and charges.</p><a className="btn mt-3 inline-block" href="/api/my/data">Download my data (JSON)</a></section>
      <div className="mt-4"><ActionForm action={dataRequestAction} title="Ask for a correction or erasure" intro="Erasure is decided by Compliance and carried out by a Super Admin. Records we must keep (safety, audit, finance) stay but no longer identify you." submit="Send request" fields={[{ name: "kind", label: "What do you need?", type: "select", options: [{ value: "CORRECTION", label: "Correct something" }, { value: "ERASURE", label: "Erase my data" }, { value: "ACCESS", label: "A copy reviewed by the office" }] }, { name: "detail", label: "Details", type: "textarea" }]} /></div>
      <h2 className="section-title mt-6">Your requests</h2>
      <ul className="mt-2 divide-y divide-zinc-200 card">{reqs.map((r) => <li key={r.id} className="p-3 text-sm"><div className="flex justify-between"><b>{r.kind.toLowerCase()}</b><span className="chip">{r.status.toLowerCase().replace(/_/g, " ")}</span></div><div className="text-xs text-zinc-500">{r.createdAt.toISOString().slice(0, 10)}{r.decisionNote ? ` · ${r.decisionNote}` : ""}</div></li>)}{reqs.length === 0 && <li className="p-3 text-sm text-zinc-500">No requests.</li>}</ul>
      <p className="mt-4 text-sm"><Link href="/my/profile" className="underline">Back to profile</Link></p>
    </>
  );
}

export default function MyPrivacyPage() {
  return <main><h1 className="page-title">Privacy</h1><Suspense fallback={<p className="mt-4 text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
