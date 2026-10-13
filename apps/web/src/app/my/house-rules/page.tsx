import { Suspense } from "react";
import { requireResident } from "@/modules/self-service/context";
import { prisma } from "@sam/core/lib/db";
import { pendingHouseRules } from "@sam/core/modules/masters/service";
import { ActionForm } from "@/components/forms/action-form";
import { acknowledgeAction } from "@/modules/masters/actions";

async function Content() {
  const { user } = await requireResident("/my/house-rules");
  const [pending, acked] = await Promise.all([pendingHouseRules(user.id, user.organizationId), prisma.houseRuleAcknowledgement.findMany({ where: { userId: user.id, houseRule: { isCurrent: true } }, include: { houseRule: true } })]);
  return (
    <>
      <ul className="mt-4 space-y-3">{pending.map((r) => <li key={r.id} className="card p-4"><b>{r.title}</b> <span className="text-xs text-zinc-500">version {r.version}</span><p className="mt-2 whitespace-pre-line text-sm">{r.body}</p><div className="mt-3"><ActionForm compact action={acknowledgeAction} hidden={{ id: r.id }} submit="I have read and agree" /></div></li>)}{pending.length === 0 && <li className="card p-4 text-sm text-zinc-600">You are up to date with the house rules.</li>}</ul>
      {acked.length > 0 && <><h2 className="section-title mt-6">Acknowledged</h2><ul className="mt-2 divide-y divide-zinc-200 card">{acked.map((a) => <li key={a.id} className="p-3 text-sm"><b>{a.houseRule.title}</b> <span className="text-xs text-zinc-500">v{a.houseRule.version} · {a.acknowledgedAt.toISOString().slice(0, 10)}</span></li>)}</ul></>}
    </>
  );
}

export default function MyHouseRulesPage() {
  return <main><h1 className="page-title">House rules</h1><Suspense fallback={<p className="mt-4 text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
