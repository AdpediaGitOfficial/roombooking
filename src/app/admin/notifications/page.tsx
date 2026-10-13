import { Suspense } from "react";
import Link from "next/link";
import type { NotificationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorize";
import { ADMIN_VIEW_ROLES } from "@/modules/admin/access";
import { outboxStats } from "@/modules/notifications/worker";
import { transportFromEnv } from "@/modules/notifications/transport";
import { RetryButton, RunWorkerButton, SendTestEmailButton } from "@/modules/notifications/components/forms";

const STATUSES: NotificationStatus[] = ["QUEUED", "SENT", "DELIVERED", "FAILED"];

async function Content({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireRole(ADMIN_VIEW_ROLES, "/admin/notifications");
  const { status: raw } = await searchParams;
  const status = STATUSES.includes(raw as NotificationStatus) ? (raw as NotificationStatus) : null;
  let transportInfo: { name: string; description: string };
  try { const t = transportFromEnv(); transportInfo = { name: t.name, description: t.description }; } catch (e) { transportInfo = { name: "error", description: e instanceof Error ? e.message : String(e) }; }
  const [{ stats, due, oldestQueuedAt }, recent] = await Promise.all([
    outboxStats(),
    prisma.notification.findMany({ where: { channel: "EMAIL", ...(status ? { status } : {}) }, include: { recipient: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const email = stats.EMAIL ?? {};
  return (
    <>
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Email transport</div>
          <div className="mt-1 font-medium" data-transport={transportInfo.name}>{transportInfo.name}</div>
          <div className="text-zinc-600 dark:text-zinc-400">{transportInfo.description}</div>
          <div className="mt-2 text-xs text-zinc-500">Deliveries run from the worker process (`npm run notifications:worker`) or a scheduler calling POST /api/jobs/notifications with the job secret.</div>
        </div>
        <div className="flex flex-col gap-2"><RunWorkerButton /><SendTestEmailButton /></div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[["Due now", due], ["Queued", email.QUEUED ?? 0], ["Sent", email.SENT ?? 0], ["Failed", email.FAILED ?? 0], ["In-app unread", await prisma.notification.count({ where: { channel: "IN_APP", readAt: null } })]].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"><dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt><dd data-stat={label} className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd></div>
        ))}
      </dl>
      {oldestQueuedAt && <p className="mt-2 text-xs text-zinc-500">Oldest queued email: {oldestQueuedAt.toISOString().replace("T", " ").slice(0, 16)} UTC.</p>}
      <nav className="mt-4 flex flex-wrap gap-2 text-sm">
        {[["", "All"], ...STATUSES.map((s) => [s, s.toLowerCase()])].map(([s, label]) => <Link key={s} href={`/admin/notifications${s ? `?status=${s}` : ""}`} className={`rounded-full px-3 py-1 ${(status ?? "") === s ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}>{label}</Link>)}
      </nav>
      <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
            <tr><th className="px-3 py-2">Queued</th><th className="px-3 py-2">To</th><th className="px-3 py-2">Event / subject</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Attempts</th><th className="px-3 py-2">Detail</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {recent.map((n) => (
              <tr key={n.id} data-notification={n.event} data-status={n.status}>
                <td className="px-3 py-2 text-xs tabular-nums">{n.createdAt.toISOString().replace("T", " ").slice(0, 16)}</td>
                <td className="px-3 py-2 text-xs">{n.recipient.name}<div className="text-zinc-500">{n.deliveredTo ?? n.recipient.email}</div></td>
                <td className="px-3 py-2"><div className="text-xs text-zinc-500">{n.event}</div>{n.subject && <div>{n.subject}</div>}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${n.status === "SENT" || n.status === "DELIVERED" ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200" : n.status === "FAILED" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"}`}>{n.status.toLowerCase()}</span></td>
                <td className="px-3 py-2 tabular-nums">{n.attempts}{n.nextAttemptAt && n.status === "QUEUED" && <div className="text-xs text-zinc-500">next {n.nextAttemptAt.toISOString().replace("T", " ").slice(0, 16)}</div>}</td>
                <td className="px-3 py-2 text-xs">{n.lastError ? <span className="text-red-700 dark:text-red-300">{n.lastError}</span> : n.providerMessageId ? <span className="text-zinc-500">id {n.providerMessageId.slice(0, 40)}</span> : null}{n.status === "FAILED" && <div className="mt-1"><RetryButton id={n.id} /></div>}</td>
              </tr>
            ))}
            {recent.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500">Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function NotificationsAdminPage({ searchParams }: PageProps<"/admin/notifications">) {
  return (
    <main>
      <h1 className="text-2xl font-semibold">Notifications</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-600 dark:text-zinc-400">Email delivery queue, failures and transport health.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content searchParams={searchParams as Promise<{ status?: string }>} />
      </Suspense>
    </main>
  );
}
