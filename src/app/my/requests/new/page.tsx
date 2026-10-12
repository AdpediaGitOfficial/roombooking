import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/authorize";
import { listRequestTypes } from "@/modules/requests/service";

async function TypeList() {
  const user = await requireUser("/my/requests/new");
  const types = await listRequestTypes(user.organizationId);
  return (
    <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {types.map((t) => (
        <li key={t.id}>
          <Link href={`/my/requests/new/${t.code}`} className="block p-4" data-type={t.code}>
            <div className="font-medium">{t.name}</div>
            {t.description && <div className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{t.description}</div>}
            <div className="mt-1 text-xs text-zinc-500">{t.current.steps.length === 0 ? "No approval needed" : `${t.current.steps.length}-step approval`}</div>
          </Link>
        </li>
      ))}
      {types.length === 0 && <li className="p-4 text-sm text-zinc-500">No request types are configured.</li>}
    </ul>
  );
}

export default function NewRequestPage() {
  return (
    <main>
      <p className="text-sm"><Link href="/my/requests" className="underline">Requests</Link></p>
      <h1 className="mt-1 text-2xl font-semibold">What do you need?</h1>
      <div className="mt-4">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <TypeList />
        </Suspense>
      </div>
    </main>
  );
}
