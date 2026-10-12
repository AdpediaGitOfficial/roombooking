import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/authorize";
import { listMyRequests } from "@/modules/requests/service";
import { RequestStatusBadge } from "@/modules/requests/components/request-view";

async function RequestList() {
  const user = await requireUser("/my/requests");
  const requests = await listMyRequests(user.id);
  if (requests.length === 0) {
    return <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">You have not made any requests yet.</p>;
  }
  return (
    <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {requests.map((r) => (
        <li key={r.id} data-request={r.id}>
          <Link href={`/my/requests/${r.id}`} className="block p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{r.requestType.name}</div>
                <div className="mt-0.5 text-xs text-zinc-500">{r.createdAt.toISOString().slice(0, 10)}</div>
              </div>
              <RequestStatusBadge request={r} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function MyRequestsPage() {
  return (
    <main>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Requests</h1>
        <Link href="/my/requests/new" className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">New request</Link>
      </div>
      <div className="mt-4">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <RequestList />
        </Suspense>
      </div>
    </main>
  );
}
