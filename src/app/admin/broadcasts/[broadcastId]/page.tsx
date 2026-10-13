import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/authorize";
import { BROADCAST_ROLES } from "@/modules/broadcasts/access";
import { broadcastDelivery, describeAudience, describeStatus, getBroadcast, parseAudience, resolveAudience } from "@/modules/broadcasts/service";
import { audienceOptions } from "@/modules/broadcasts/context";
import { CancelButton, ComposeForm, SendButton } from "@/modules/broadcasts/components/forms";

type Params = Promise<{ broadcastId: string }>;

async function Content({ params }: { params: Params }) {
  const { broadcastId } = await params;
  const user = await requireRole(BROADCAST_ROLES, `/admin/broadcasts/${broadcastId}`);
  const b = await getBroadcast(broadcastId);
  if (!b || b.organizationId !== user.organizationId) notFound();
  const audience = parseAudience(b.audience);
  const [who, delivery, recipients, options] = await Promise.all([describeAudience(audience), broadcastDelivery(b.id), b.status === "DRAFT" ? resolveAudience(user.organizationId, audience) : [], b.status === "DRAFT" ? audienceOptions(user.organizationId) : null]);
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, c) => a + c, 0);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title">{b.title}</h1>
        <span data-status={b.status} className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs">{describeStatus(b.status)}</span>
      </div>
      <p className="mt-1 text-sm text-zinc-600">To {who}{b.emailCopy ? " · email copy" : ""}{b.whatsappCopy ? " · WhatsApp copy" : ""} · created {b.createdAt.toISOString().slice(0, 16).replace("T", " ")} by {b.createdBy.name}{b.sentAt ? ` · sent ${b.sentAt.toISOString().slice(0, 16).replace("T", " ")} by ${b.sentBy?.name}` : ""}</p>
      <div className="mt-4 whitespace-pre-line card p-4 text-sm" data-body>{b.body}</div>

      {b.status === "SENT" && (
        <section className="mt-6">
          <h2 className="section-title">Delivery</h2>
          <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Recipients", b.recipientCount], ["Read in app", `${delivery.read} of ${delivery.inApp}`], ["Email", b.emailCopy ? `${delivery.email.SENT ?? 0} sent · ${delivery.email.QUEUED ?? 0} queued · ${delivery.email.FAILED ?? 0} failed` : "off"], ["WhatsApp", b.whatsappCopy ? `${(delivery.whatsapp.SENT ?? 0) + (delivery.whatsapp.DELIVERED ?? 0)} sent · ${delivery.whatsapp.QUEUED ?? 0} queued · ${delivery.whatsapp.FAILED ?? 0} failed` : "off"]].map(([label, value]) => (
              <div key={String(label)} className="kpi"><dt className="kpi-label">{label}</dt><dd data-delivery={label} className="mt-1 text-sm font-medium">{value}</dd></div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-zinc-500">{sum(delivery.email) + sum(delivery.whatsapp) > 0 ? "Copies go out from the notification worker; failures and retries are on the Notifications page." : "No copies were queued (recipients have email or WhatsApp off, or copies were not requested)."}</p>
        </section>
      )}

      {b.status === "DRAFT" && options && (
        <>
          <section className="mt-6">
            <h2 className="section-title">Recipients right now</h2>
            <p data-recipient-count className="mt-1 text-sm">{recipients.length} {recipients.length === 1 ? "person" : "people"}{recipients.length ? `: ${recipients.slice(0, 20).map((r) => r.name).join(", ")}${recipients.length > 20 ? ", …" : ""}` : ". Widen the audience before sending."}</p>
            <div className="mt-3 flex flex-wrap gap-2"><SendButton broadcastId={b.id} /><CancelButton broadcastId={b.id} /></div>
          </section>
          <section className="mt-6">
            <ComposeForm options={options} defaults={{ broadcastId: b.id, title: b.title, body: b.body, roles: audience.roles, siteIds: audience.siteIds, buildingIds: audience.buildingIds, emailCopy: b.emailCopy, whatsappCopy: b.whatsappCopy }} />
          </section>
        </>
      )}
      <p className="mt-6 text-sm"><Link href="/admin/broadcasts" className="underline">← All broadcasts</Link></p>
    </>
  );
}

export default function BroadcastPage({ params }: PageProps<"/admin/broadcasts/[broadcastId]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content params={params as Params} />
      </Suspense>
    </main>
  );
}
