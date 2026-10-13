import { Suspense } from "react";
import Link from "next/link";
import { requireCapability } from "@/lib/auth/authorize";
import { verificationQueue } from "@sam/core/modules/people/service";
import { ActionForm } from "@/components/forms/action-form";
import { verifyStaffAction } from "@/modules/people/actions";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireCapability("people.verify", { returnTo: "/people/verification" });
  const queue = await verificationQueue();
  return (
    <section className="panel">
      <table className="table">
        <thead><tr><th>Person</th><th>Type</th><th>Source</th><th>Added</th><th></th></tr></thead>
        <tbody>
          {queue.map((p) => (
            <tr key={p.id}>
              <td><Link href={`/people/${p.id}`} className="font-medium underline">{p.firstName} {p.lastName}</Link><span className="sub">{p.employeeId}</span></td>
              <td>{p.profileType.replace("_", " ").toLowerCase()}</td>
              <td>{p.source.toLowerCase()}</td>
              <td className="tabular-nums">{p.createdAt.toISOString().slice(0, 10)}</td>
              <td className="num">{p.verifiedById === user.id ? null : <ActionForm compact action={verifyStaffAction} hidden={{ staffId: p.id }} fields={[]} submit="Verify" />}</td>
            </tr>
          ))}
          {queue.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-sm text-zinc-500">Nothing waiting for verification.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

export default function VerificationPage() {
  return <main><PageHeader title="Verification queue" subtitle="Profiles added by the front desk, HR sync or import wait here until an Accommodation Admin verifies them." crumbs={[["People", "/people"], ["Verification"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content /></Suspense></main>;
}
