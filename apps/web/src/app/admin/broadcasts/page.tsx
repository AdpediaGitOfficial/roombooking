import { Suspense } from "react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/authorize";
import { BROADCAST_ROLES } from "@sam/core/modules/broadcasts/access";
import { describeAudience, describeStatus, listBroadcasts, parseAudience } from "@sam/core/modules/broadcasts/service";
import { audienceOptions } from "@/modules/broadcasts/context";
import { ComposeForm } from "@/modules/broadcasts/components/forms";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  const user = await requireRole(BROADCAST_ROLES, "/admin/broadcasts");
  const [rows, options] = await Promise.all([listBroadcasts(user.organizationId), audienceOptions(user.organizationId)]);
  const described = await Promise.all(rows.map((b) => describeAudience(parseAudience(b.audience))));
  return (
    <>
      <ComposeForm options={options} defaults={{ title: "", body: "", roles: [], siteIds: [], buildingIds: [], emailCopy: true, whatsappCopy: false }} />
      <h2 className="mt-8 text-lg font-semibold">Broadcasts</h2>
      <div className="mt-2 overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr><th className="px-3 py-2">Title</th><th className="px-3 py-2">Audience</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Recipients</th><th className="px-3 py-2">By</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {rows.map((b, i) => (
              <tr key={b.id} data-broadcast={b.id} data-status={b.status}>
                <td className="px-3 py-3"><Link href={`/admin/broadcasts/${b.id}`} className="font-medium underline">{b.title}</Link><div className="text-xs text-zinc-500">{(b.sentAt ?? b.createdAt).toISOString().slice(0, 16).replace("T", " ")}</div></td>
                <td className="px-3 py-3 text-xs">{described[i]}{b.emailCopy ? " · email" : ""}{b.whatsappCopy ? " · WhatsApp" : ""}</td>
                <td className="px-3 py-3"><span className={`chip ${b.status === "SENT" ? "bg-green-100 text-green-800" : b.status === "DRAFT" ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-700"}`}>{describeStatus(b.status)}</span></td>
                <td className="px-3 py-3 text-right tabular-nums">{b.status === "SENT" ? b.recipientCount : "—"}</td>
                <td className="px-3 py-3 text-xs">{b.sentBy?.name ?? b.createdBy.name}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">No broadcasts yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function BroadcastsPage() {
  return (
    <main>
      <PageHeader title="Broadcasts" subtitle="Announcements to residents and staff by site, building or role, delivered in the app with optional email and WhatsApp copies." crumbs={[["Administration"], ["Broadcasts"]]} />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
