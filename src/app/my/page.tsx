import { Suspense } from "react";
import { requireResident } from "@/modules/self-service/context";
import { describeNotification, getMyStay, listMyNotifications } from "@/modules/self-service/service";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { markReadAction } from "@/modules/self-service/actions";
import { StayCard } from "@/modules/self-service/components/stay-card";

async function HomeContent() {
  const { user, staff } = await requireResident("/my");
  const [stay, notifications, returned] = await Promise.all([
    staff ? getMyStay(staff.id) : null,
    listMyNotifications(user.id),
    prisma.request.findMany({ where: { requesterId: user.id, status: "CHANGES_REQUESTED" }, include: { requestType: true } }),
  ]);
  const ticketsNeedingMe = await prisma.workOrder.findMany({ where: { requesterId: user.id, status: { in: ["RESOLVED", "WAITING_STAFF"] } }, orderBy: { updatedAt: "desc" } });
  const firstName = staff?.firstName ?? user.name.split(" ")[0];
  const unread = notifications.filter((n) => !n.readAt);

  return (
    <>
      <h1 className="text-2xl font-semibold">Hello, {firstName}</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{stay ? `Today is ${stay.today}` : "Welcome"}</p>

      <section className="mt-6">
        {staff ? <StayCard allocation={stay?.current ?? null} compact /> : (
          <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            Your account is not linked to a staff record yet. Contact the accommodation office.
          </div>
        )}
      </section>

      {((stay && stay.pendingActions.length > 0) || returned.length > 0 || ticketsNeedingMe.length > 0) && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">To do</h2>
          <ul className="mt-2 space-y-2">
            {ticketsNeedingMe.map((t) => (
              <li key={t.id} data-action="TICKET" className="rounded-lg bg-orange-50 p-3 text-sm text-orange-900 dark:bg-orange-950 dark:text-orange-200">
                <div className="text-xs uppercase tracking-wide">maintenance · {t.ticketNumber}</div>
                <div className="mt-0.5"><Link href={`/my/maintenance/${t.id}`} className="underline">{t.category}</Link> {t.status === "RESOLVED" ? "was marked resolved. Please confirm or reopen." : "needs a reply from you."}</div>
              </li>
            ))}
            {returned.map((r) => (
              <li key={r.id} data-action="REQUEST" className="rounded-lg bg-orange-50 p-3 text-sm text-orange-900 dark:bg-orange-950 dark:text-orange-200">
                <div className="text-xs uppercase tracking-wide">request returned</div>
                <div className="mt-0.5"><Link href={`/my/requests/${r.id}`} className="underline">{r.requestType.name}</Link> needs changes before it can be approved.</div>
              </li>
            ))}
            {(stay?.pendingActions ?? []).map((a) => (
              <li key={`${a.kind}-${a.date}`} data-action={a.kind} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <div className="text-xs uppercase tracking-wide">{a.kind.toLowerCase()} · {a.date}</div>
                <div className="mt-0.5">{a.text}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6" data-shortcuts>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Link href="/my/facilities" className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"><div className="font-medium">Facilities</div><div className="text-xs text-zinc-500">Book the gym or hall</div></Link>
          <Link href="/my/lost-found" className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"><div className="font-medium">Lost &amp; found</div><div className="text-xs text-zinc-500">Found items and your claims</div></Link>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Notifications{unread.length > 0 && <span className="ml-2 rounded-full bg-zinc-900 px-2 py-0.5 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900">{unread.length} new</span>}</h2>
        {notifications.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">Nothing yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {notifications.map((n) => {
              const { title, body } = describeNotification(n.event, n.payload);
              return (
                <li key={n.id} data-notification={n.id} data-read={n.readAt ? "true" : "false"} className={`p-3 text-sm ${n.readAt ? "text-zinc-500" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{title}</div>
                      {body && <div className="mt-0.5">{body}</div>}
                      <div className="mt-1 text-xs text-zinc-500">{n.createdAt.toISOString().slice(0, 10)}</div>
                    </div>
                    {!n.readAt && (
                      <form action={markReadAction}>
                        <input type="hidden" name="notificationId" value={n.id} />
                        <button type="submit" className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">Mark read</button>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

export default function MyHomePage() {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <HomeContent />
      </Suspense>
    </main>
  );
}
