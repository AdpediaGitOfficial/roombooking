import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canSeeSite } from "@/lib/auth/scope";
import { hasRole, requireRole } from "@/lib/auth/authorize";
import { KEY_MANAGE_ROLES, KEY_OPERATE_ROLES, KEY_VIEW_ROLES } from "@sam/core/modules/keys/access";
import { getKey, holderLabel, isOverdue, keyLocation, openIssue } from "@sam/core/modules/keys/service";
import { staffOptions } from "@/modules/keys/context";
import { KeyStatusBadge, TransactionHistory } from "@/modules/keys/components/views";
import { IssueKeyForm, KeyExceptionForm, ReplaceKeyForm, ReturnKeyForm } from "@/modules/keys/components/forms";

async function Content({ params }: { params: Promise<{ keyId: string }> }) {
  const { keyId } = await params;
  const user = await requireRole(KEY_VIEW_ROLES, `/keys/${keyId}`);
  const key = await getKey(keyId);
  if (!key) notFound();
  if (!(await canSeeSite(user, ["keys.standard", "keys.register"], key.siteId))) notFound();
  const canOperate = hasRole(user, ...KEY_OPERATE_ROLES);
  const canManage = hasRole(user, ...KEY_MANAGE_ROLES);
  const issue = openIssue(key);
  const now = new Date();
  const staff = canOperate && key.status === "AVAILABLE" ? await staffOptions() : [];

  const exceptionKinds: Array<{ kind: string; label: string; danger?: boolean }> = [];
  if (canManage) {
    if (key.status === "AVAILABLE") { exceptionKinds.push({ kind: "DAMAGED", label: "Mark damaged" }, { kind: "LOST", label: "Report lost", danger: true }, { kind: "RETIRE", label: "Retire", danger: true }); }
    if (key.status === "ISSUED") exceptionKinds.push({ kind: "LOST", label: "Report lost", danger: true });
    if (key.status === "LOST") exceptionKinds.push({ kind: "FOUND", label: "Found" });
    if (key.status === "DAMAGED") exceptionKinds.push({ kind: "SEND_REPAIR", label: "Send for repair" }, { kind: "RETIRE", label: "Retire", danger: true });
    if (key.status === "UNDER_REPAIR") exceptionKinds.push({ kind: "BACK_REPAIR", label: "Back from repair" }, { kind: "RETIRE", label: "Retire", danger: true });
  }

  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="page-title">Key {key.code}</h1>
        <KeyStatusBadge status={key.status} />
      </div>
      <p className="mt-1 text-sm text-zinc-600">{key.label ? `${key.label} · ` : ""}{keyLocation(key)}{key.allowCopies ? " · copies exist" : ""}</p>
      {key.replaces && <p className="mt-1 text-xs text-zinc-500">Replaces <Link href={`/keys/${key.replaces.id}`} className="underline">{key.replaces.code}</Link></p>}
      {key.replacedBy.length > 0 && <p className="mt-1 text-xs text-zinc-500">Replaced by {key.replacedBy.map((k) => <Link key={k.id} href={`/keys/${k.id}`} className="underline">{k.code}</Link>)}</p>}
      {key.notes && <p className="mt-2 text-sm">{key.notes}</p>}

      {issue && (
        <div data-holder className={`mt-4 rounded-lg p-3 text-sm ${isOverdue(issue, now) ? "bg-red-50 text-red-900" : "bg-blue-50 text-blue-900"}`}>
          <div className="font-medium">Held by {holderLabel(issue)}</div>
          <div className="mt-0.5 text-xs">Issued {issue.createdAt.toISOString().replace("T", " ").slice(0, 16)} by {issue.custodian.name}{issue.expectedReturnAt ? ` · expected back ${issue.expectedReturnAt.toISOString().slice(0, 10)}` : ""}{isOverdue(issue, now) ? " · overdue" : ""}{key.status === "LOST" ? " · reported lost while issued" : ""}</div>
        </div>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="section-title">History</h2>
          <p className="mb-2 text-xs text-zinc-500">Every issue, return and exception is kept permanently.</p>
          <TransactionHistory transactions={key.transactions} />
        </section>
        <section className="space-y-4">
          <h2 className="section-title">Actions</h2>
          {canOperate && key.status === "AVAILABLE" && <IssueKeyForm keyId={key.id} staff={staff} />}
          {canOperate && issue && key.status === "ISSUED" && <ReturnKeyForm keyId={key.id} />}
          <KeyExceptionForm keyId={key.id} kinds={exceptionKinds} withIncident={key.status === "ISSUED" || key.status === "AVAILABLE"} />
          {canManage && ["LOST", "DAMAGED", "UNDER_REPAIR"].includes(key.status) && <ReplaceKeyForm keyId={key.id} suggestedCode={`${key.code}-R${key.replacedBy.length + 1}`} />}
          {!canOperate && <p className="text-sm text-zinc-500">Read-only access.</p>}
        </section>
      </div>
    </>
  );
}

export default function KeyPage({ params }: PageProps<"/keys/[keyId]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content params={params} />
      </Suspense>
    </main>
  );
}
