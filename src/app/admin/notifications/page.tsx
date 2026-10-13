import { Suspense } from "react";
import Link from "next/link";
import type { NotificationChannel, NotificationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorize";
import { ADMIN_VIEW_ROLES } from "@/modules/admin/access";
import { outboxStats } from "@/modules/notifications/worker";
import { transportFromEnv } from "@/modules/notifications/transport";
import { whatsappTransportFromEnv } from "@/modules/notifications/whatsapp";
import { requiredTemplates } from "@/modules/notifications/whatsapp-templates";
import { RetryButton, RunWorkerButton, SendTestEmailButton, SendTestWhatsAppButton } from "@/modules/notifications/components/forms";

const STATUSES: NotificationStatus[] = ["QUEUED", "SENT", "DELIVERED", "FAILED"];

async function Content({ searchParams }: { searchParams: Promise<{ status?: string; channel?: string }> }) {
  await requireRole(ADMIN_VIEW_ROLES, "/admin/notifications");
  const { status: raw, channel: rawChannel } = await searchParams;
  const status = STATUSES.includes(raw as NotificationStatus) ? (raw as NotificationStatus) : null;
  const channel: NotificationChannel = rawChannel === "WHATSAPP" ? "WHATSAPP" : "EMAIL";
  const describe = (f: () => { name: string; description: string }) => { try { const t = f(); return { name: t.name, description: t.description }; } catch (e) { return { name: "error", description: e instanceof Error ? e.message : String(e) }; } };
  const transportInfo = describe(() => transportFromEnv());
  const waInfo = describe(() => whatsappTransportFromEnv());
  const [{ stats, due, dueWhatsApp, oldestQueuedAt, oldestWhatsAppQueuedAt }, recent, unread, consented] = await Promise.all([
    outboxStats(),
    prisma.notification.findMany({ where: { channel, ...(status ? { status } : {}) }, include: { recipient: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.notification.count({ where: { channel: "IN_APP", readAt: null } }),
    prisma.user.count({ where: { whatsappNotifications: true, whatsappConsentAt: { not: null }, whatsappNumber: { not: null } } }),
  ]);
  const email = stats.EMAIL ?? {};
  const wa = stats.WHATSAPP ?? {};
  const query = (c: NotificationChannel, s: string) => `/admin/notifications?channel=${c}${s ? `&status=${s}` : ""}`;
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4 text-sm">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Email transport</div>
          <div className="mt-1 font-medium" data-transport={transportInfo.name}>{transportInfo.name}</div>
          <div className="text-zinc-600">{transportInfo.description}</div>
          <div className="mt-2 flex flex-wrap gap-2"><RunWorkerButton /><SendTestEmailButton /></div>
        </div>
        <div className="card p-4 text-sm">
          <div className="text-xs uppercase tracking-wide text-zinc-500">WhatsApp transport</div>
          <div className="mt-1 font-medium" data-whatsapp-transport={waInfo.name}>{waInfo.name}</div>
          <div className="text-zinc-600">{waInfo.description}</div>
          <div className="mt-1 text-xs text-zinc-500">{consented} {consented === 1 ? "person has" : "people have"} opted in. Delivery receipts arrive at POST /api/webhooks/whatsapp (verify token and app secret in the environment).</div>
          <div className="mt-2"><SendTestWhatsAppButton /></div>
        </div>
      </div>
      <p className="mt-2 text-xs text-zinc-500">Deliveries run from the worker process (`npm run notifications:worker`) or a scheduler calling POST /api/jobs/notifications with the job secret.</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(channel === "EMAIL"
          ? [["Due now", due], ["Queued", email.QUEUED ?? 0], ["Sent", email.SENT ?? 0], ["Failed", email.FAILED ?? 0], ["In-app unread", unread]]
          : [["Due now", dueWhatsApp], ["Queued", wa.QUEUED ?? 0], ["Sent", wa.SENT ?? 0], ["Delivered", wa.DELIVERED ?? 0], ["Failed", wa.FAILED ?? 0]]).map(([label, value]) => (
          <div key={String(label)} className="card p-3"><dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt><dd data-stat={label} className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd></div>
        ))}
      </dl>
      {channel === "EMAIL" && oldestQueuedAt && <p className="mt-2 text-xs text-zinc-500">Oldest queued email: {oldestQueuedAt.toISOString().replace("T", " ").slice(0, 16)} UTC.</p>}
      {channel === "WHATSAPP" && oldestWhatsAppQueuedAt && <p className="mt-2 text-xs text-zinc-500">Oldest queued WhatsApp message: {oldestWhatsAppQueuedAt.toISOString().replace("T", " ").slice(0, 16)} UTC.</p>}
      <nav className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        {(["EMAIL", "WHATSAPP"] as NotificationChannel[]).map((c) => <Link key={c} href={query(c, "")} data-channel-tab={c} className={`rounded-md px-3 py-1 font-medium ${c === channel ? "bg-deep text-white" : "border border-zinc-300"}`}>{c === "EMAIL" ? "Email" : "WhatsApp"}</Link>)}
        <span className="mx-1 text-zinc-400">|</span>
        {[["", "All"], ...STATUSES.map((s) => [s, s.toLowerCase()])].map(([s, label]) => <Link key={s} href={query(channel, s)} className={`rounded-full px-3 py-1 ${(status ?? "") === s ? "bg-deep text-white" : "border border-zinc-300"}`}>{label}</Link>)}
      </nav>
      <div className="mt-4 overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr><th className="px-3 py-2">Queued</th><th className="px-3 py-2">To</th><th className="px-3 py-2">Event / subject</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Attempts</th><th className="px-3 py-2">Detail</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {recent.map((n) => (
              <tr key={n.id} data-notification={n.event} data-status={n.status}>
                <td className="px-3 py-2 text-xs tabular-nums">{n.createdAt.toISOString().replace("T", " ").slice(0, 16)}</td>
                <td className="px-3 py-2 text-xs">{n.recipient.name}<div className="text-zinc-500">{n.deliveredTo ?? n.recipient.email}</div></td>
                <td className="px-3 py-2"><div className="text-xs text-zinc-500">{n.event}</div>{n.subject && <div>{n.subject}</div>}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${n.status === "SENT" || n.status === "DELIVERED" ? "bg-green-100 text-green-800" : n.status === "FAILED" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{n.status.toLowerCase()}</span></td>
                <td className="px-3 py-2 tabular-nums">{n.attempts}{n.nextAttemptAt && n.status === "QUEUED" && <div className="text-xs text-zinc-500">next {n.nextAttemptAt.toISOString().replace("T", " ").slice(0, 16)}</div>}</td>
                <td className="px-3 py-2 text-xs">{n.lastError ? <span className="text-red-700">{n.lastError}</span> : n.providerMessageId ? <span className="text-zinc-500">id {n.providerMessageId.slice(0, 40)}</span> : null}{n.status === "FAILED" && <div className="mt-1"><RetryButton id={n.id} /></div>}</td>
              </tr>
            ))}
            {recent.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500">Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
      {channel === "WHATSAPP" && (
        <section className="mt-6">
          <h2 className="section-title">Templates to approve with the provider</h2>
          <p className="mt-1 text-xs text-zinc-500">Business-initiated WhatsApp messages must use pre-approved templates. Create these in WhatsApp Manager (language {process.env.WHATSAPP_LANGUAGE ?? "en"}); override names with WHATSAPP_TEMPLATE_MAP.</p>
          <div className="mt-2 overflow-x-auto card">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500"><tr><th className="px-3 py-2">Template</th><th className="px-3 py-2">Body</th><th className="px-3 py-2">Events</th></tr></thead>
              <tbody className="divide-y divide-zinc-200">
                {requiredTemplates().map((t) => <tr key={t.name} data-template={t.name}><td className="px-3 py-2 font-mono text-xs">{t.name}</td><td className="px-3 py-2 text-xs">{t.body}</td><td className="px-3 py-2 text-xs text-zinc-500">{t.events.join(", ")}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

export default function NotificationsAdminPage({ searchParams }: PageProps<"/admin/notifications">) {
  return (
    <main>
      <h1 className="page-title">Notifications</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-600">Email and WhatsApp delivery queues, failures and transport health.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content searchParams={searchParams as Promise<{ status?: string; channel?: string }>} />
      </Suspense>
    </main>
  );
}
