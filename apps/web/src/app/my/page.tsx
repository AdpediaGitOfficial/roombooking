import { Suspense } from "react";
import { requireUser } from "@/lib/auth/authorize";
import { api } from "@/lib/api";
import { describeNotification } from "@sam/core/modules/self-service/rules";
import Link from "next/link";
import { markReadAction } from "@/modules/self-service/actions";
import { isoDate } from "@sam/core/modules/accommodation/occupancy";

async function HomeContent() {
  const user = await requireUser("/my");
  const { staff, stay, notifications, returnedRequests: returned, ticketsNeedingMe } = await api.me.home();
  const firstName = staff?.firstName ?? user.name.split(" ")[0];
  const unread = notifications.filter((n) => !n.readAt);

  const current = stay?.current ?? null;
  const todos: Array<{ key: string; sev: "danger" | "warning" | "info"; title: React.ReactNode; hint: string; attr: string }> = [
    ...ticketsNeedingMe.map((t) => ({ key: t.id, sev: t.status === "RESOLVED" ? ("danger" as const) : ("warning" as const), attr: "TICKET", title: <Link href={`/my/maintenance/${t.id}`}>{t.status === "RESOLVED" ? `Confirm the ${t.category.toLowerCase()} fix` : `${t.category} needs a reply from you`}</Link>, hint: `${t.ticketNumber} · ${t.status === "RESOLVED" ? "marked resolved" : "waiting for you"}` })),
    ...returned.map((r) => ({ key: r.id, sev: "warning" as const, attr: "REQUEST", title: <Link href={`/my/requests/${r.id}`}>{r.requestType.name} needs changes</Link>, hint: "Returned by the approver · edit and resubmit" })),
    ...(stay?.pendingActions ?? []).map((a) => ({ key: `${a.kind}-${a.date}`, sev: "info" as const, attr: a.kind, title: a.text, hint: `${a.kind.toLowerCase()} · ${a.date}` })),
  ];

  return (
    <>
      <header className="portal-head">
        <div className="meta"><span>{stay ? `Today is ${stay.today}` : "Welcome"}{current ? ` · ${current.bed.room.building.site.name}` : ""}</span><Link href="#notifications" aria-label={`${unread.length} unread notifications`}>🔔 <b>{unread.length}</b></Link></div>
        <h1>Hello, {firstName}</h1>
        {staff ? (
          current ? (
            <div className="bedcard" data-stay={current.bed.code}>
              <span className="e">{current.status === "CONFIRMED" ? "Allocated · check in at reception" : "Your bed"}</span>
              <b>{current.bed.code} · {current.bed.room.building.name}</b>
              <small>Room {current.bed.room.code}{current.bed.room.floor ? ` · Floor ${current.bed.room.floor}` : ""} · {isoDate(current.startDate)} → {current.endDate ? isoDate(current.endDate) : "open-ended"}</small>
              <div className="mt-2.5"><Link href="/my/stay" className="chip chip-lite">Stay details →</Link></div>
            </div>
          ) : (
            <div className="bedcard"><span className="e">Accommodation</span><b>No bed allocated</b><small>Contact the accommodation office if you expect one.</small></div>
          )
        ) : (
          <div className="bedcard"><span className="e">Account</span><b>Not linked to a staff record</b><small>Contact the accommodation office.</small></div>
        )}
      </header>

      {todos.length > 0 && (
        <section className="mt-5">
          <div className="flex items-baseline justify-between"><h2 className="section-title">To do <span className="chip chip-danger ml-1">{todos.length}</span></h2></div>
          <ul className="todo mt-2">
            {todos.map((t) => (
              <li key={t.key} data-action={t.attr} className={`todo-item sev-${t.sev}`}><b>{t.title}</b><small>{t.hint}</small></li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-5" data-shortcuts>
        <h2 className="section-title">Services</h2>
        <div className="tiles mt-2">
          <Link href="/my/maintenance/new" className="tile"><span className="ic" aria-hidden="true">⚒</span><b>Report an issue</b><small>Maintenance ticket</small></Link>
          <Link href="/my/requests/new" className="tile"><span className="ic" aria-hidden="true">✎</span><b>Make a request</b><small>Room change, visitor, family…</small></Link>
          <Link href="/my/facilities" className="tile"><span className="ic" aria-hidden="true">◷</span><b>Book a facility</b><small>Gym, hall and more</small></Link>
          <Link href="/my/lost-found" className="tile"><span className="ic" aria-hidden="true">◎</span><b>Lost &amp; found</b><small>Found items and your claims</small></Link>
          <Link href="/my/announcements" className="tile"><span className="ic" aria-hidden="true">▣</span><b>Announcements</b><small>Messages from the office</small></Link>
          <Link href="/my/profile" className="tile"><span className="ic" aria-hidden="true">☺</span><b>Profile</b><small>Contacts and password</small></Link>
        </div>
      </section>

      <section className="mt-5" id="notifications">
        <h2 className="section-title">Notifications{unread.length > 0 && <span className="chip chip-success ml-2">{unread.length} new</span>}</h2>
        {notifications.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">Nothing yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-200 card">
            {notifications.map((n) => {
              const { title, body } = describeNotification(n.event, n.payload);
              return (
                <li key={n.id} data-notification={n.id} data-read={n.readAt ? "true" : "false"} className={`p-3 text-sm ${n.readAt ? "text-zinc-500" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{n.event === "broadcast" ? <Link href={`/my/announcements/${(n.payload as { broadcastId?: string }).broadcastId ?? ""}`} className="underline">{title}</Link> : title}</div>
                      {body && <div className="mt-0.5">{body}</div>}
                      <div className="mt-1 text-xs text-zinc-500">{n.createdAt.toISOString().slice(0, 10)}</div>
                    </div>
                    {!n.readAt && (
                      <form action={markReadAction}>
                        <input type="hidden" name="notificationId" value={n.id} />
                        <button type="submit" className="btn btn-small">Mark read</button>
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
