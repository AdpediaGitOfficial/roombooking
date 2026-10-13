import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/authorize";
import { openAnnouncement } from "@/modules/broadcasts/service";

type Params = Promise<{ broadcastId: string }>;

async function Content({ params }: { params: Params }) {
  const { broadcastId } = await params;
  const user = await requireUser(`/my/announcements/${broadcastId}`);
  const a = await openAnnouncement(user.id, broadcastId);
  if (!a) notFound();
  return (
    <>
      <h1 className="page-title">{a.title}</h1>
      <p className="mt-1 text-xs text-zinc-500">{a.sentAt ? a.sentAt.toISOString().slice(0, 16).replace("T", " ") : ""}{a.sentBy ? ` · ${a.sentBy.name}` : ""}</p>
      <div data-announcement-body className="mt-4 whitespace-pre-line text-base">{a.body}</div>
      <p className="mt-6 text-sm"><Link href="/my/announcements" className="underline">← All announcements</Link></p>
    </>
  );
}

export default function AnnouncementPage({ params }: PageProps<"/my/announcements/[broadcastId]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content params={params as Params} />
      </Suspense>
    </main>
  );
}
