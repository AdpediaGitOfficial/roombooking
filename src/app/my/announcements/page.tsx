import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/authorize";
import { myAnnouncements } from "@/modules/broadcasts/service";

async function Content() {
  const user = await requireUser("/my/announcements");
  const rows = await myAnnouncements(user.id);
  return (
    <ul className="mt-4 space-y-2">
      {rows.map((n) => {
        const p = n.payload as { broadcastId: string; title: string; body: string };
        return (
          <li key={n.id} data-announcement={p.broadcastId} data-read={n.readAt ? "true" : "false"} className={`rounded-lg border p-3 text-sm ${n.readAt ? "border-zinc-200" : "border-zinc-900"}`}>
            <Link href={`/my/announcements/${p.broadcastId}`} className="font-medium underline">{p.title}</Link>{!n.readAt && <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-ink">new</span>}
            <div className="mt-1 line-clamp-2 text-zinc-600">{p.body}</div>
            <div className="mt-1 text-xs text-zinc-500">{n.createdAt.toISOString().slice(0, 10)}</div>
          </li>
        );
      })}
      {rows.length === 0 && <li className="text-sm text-zinc-500">No announcements yet.</li>}
    </ul>
  );
}

export default function AnnouncementsPage() {
  return (
    <main>
      <h1 className="page-title">Announcements</h1>
      <p className="mt-1 text-sm text-zinc-600">Messages from the accommodation office.</p>
      <Suspense fallback={<p className="mt-4 text-sm text-zinc-500">Loading…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
