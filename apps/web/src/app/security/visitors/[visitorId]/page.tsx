import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireUser, userCan } from "@/lib/auth/authorize";
import { SecurityError } from "@sam/core/modules/security/errors";
import { getVisitor } from "@sam/core/modules/security/service";
import { ActionForm } from "@/components/forms/action-form";
import { cancelVisitorAction, checkInAction, checkOutAction, decideVisitorAction } from "@/modules/security/actions";
import { SecurityTabs } from "@/modules/security/tabs";
import { PageHeader } from "@/components/shell/page-header";

async function Content({ params }: { params: Promise<{ visitorId: string }> }) {
  const { visitorId } = await params;
  const user = await requireUser(`/security/visitors/${visitorId}`);
  const { visitor: v, host } = await getVisitor(visitorId).catch((e) => { if (e instanceof SecurityError) notFound(); throw e; });
  const ctx = { siteId: v.siteId };
  const canCheck = userCan(user, "sec.checkin_visitors", ctx), canApprove = userCan(user, "sec.approve_overnight", ctx) && v.registeredById !== user.id;
  const t = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 16) : "—");
  return (
    <>
      <SecurityTabs user={user} active="visitors" />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <section className="card p-4">
          <dl className="kv"><dt>Status</dt><dd><span className="chip">{v.status.toLowerCase().replace(/_/g, " ")}</span></dd><dt>Kind</dt><dd>{v.kind.toLowerCase().replace("_", " ")}{v.nights ? ` · ${v.nights} night(s)` : ""}</dd><dt>Host</dt><dd>{host ? `${host.firstName} ${host.lastName} (${host.employeeId})` : "—"}</dd><dt>Expected</dt><dd>{t(v.expectedAt)} → {t(v.expectedOutAt)}</dd><dt>Phone</dt><dd>{v.phone ?? "—"}</dd><dt>ID</dt><dd>{v.idType ?? ""} {v.idNumber ?? "—"}</dd><dt>Company / purpose</dt><dd>{v.company ?? ""} {v.purpose ?? ""}</dd><dt>Vehicle</dt><dd>{v.vehicle ?? "—"}</dd>{v.restrictedArea && <><dt>Restricted area</dt><dd>{v.restrictedArea}</dd></>}{v.passCode && <><dt>Pass code</dt><dd><b className="text-lg tracking-widest">{v.passCode}</b></dd></>}<dt>Checked in</dt><dd>{t(v.checkedInAt)}</dd><dt>Checked out</dt><dd>{t(v.checkedOutAt)}</dd>{v.deniedReason && <><dt>Reason</dt><dd>{v.deniedReason}</dd></>}</dl>
        </section>
        <div className="space-y-3">
          {canCheck && v.status === "APPROVED" && <ActionForm action={checkInAction} hidden={{ visitorId: v.id }} title="Check in" submit="Check in" fields={[{ name: "passCode", label: "Pass code (ask the visitor)" }]} />}
          {canCheck && v.status === "CHECKED_IN" && <ActionForm action={checkOutAction} hidden={{ visitorId: v.id }} title="Check out" submit="Check out" />}
          {canApprove && v.status === "PENDING_APPROVAL" && <><ActionForm action={decideVisitorAction} hidden={{ visitorId: v.id, decision: "approve" }} title="Approve" submit="Approve visitor" fields={[{ name: "note", label: "Note" }]} /><ActionForm tone="danger" action={decideVisitorAction} hidden={{ visitorId: v.id, decision: "reject" }} title="Refuse" submit="Refuse" fields={[{ name: "note", label: "Reason", required: true }]} /></>}
          {["PRE_REGISTERED", "PENDING_APPROVAL", "APPROVED", "WALK_IN_PENDING"].includes(v.status) && (v.hostUserId === user.id || v.registeredById === user.id || canCheck || canApprove) && <ActionForm tone="secondary" action={cancelVisitorAction} hidden={{ visitorId: v.id }} title="Cancel this visit" submit="Cancel visit" fields={[{ name: "reason", label: "Reason" }]} />}
        </div>
      </div>
    </>
  );
}

export default function VisitorPage({ params }: PageProps<"/security/visitors/[visitorId]">) {
  return <main><PageHeader title="Visitor" crumbs={[["Security", "/security"], ["Visitors", "/security/visitors"], ["Visitor"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content params={params} /></Suspense></main>;
}
