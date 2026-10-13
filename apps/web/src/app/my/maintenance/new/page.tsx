import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/authorize";
import { CATEGORIES } from "@sam/core/modules/maintenance/service";
import { residentRoomOptions } from "@/modules/maintenance/context";
import { NewWorkOrderForm } from "@/modules/maintenance/components/forms";

async function Content() {
  const user = await requireUser("/my/maintenance/new");
  const rooms = await residentRoomOptions(user.id);
  return <NewWorkOrderForm categories={CATEGORIES} rooms={rooms} defaultRoomId={rooms[0]?.id ?? null} buildings={[]} returnTo="my" />;
}

export default function NewMaintenancePage() {
  return (
    <main>
      <p className="text-sm"><Link href="/my/maintenance" className="underline">Maintenance</Link></p>
      <h1 className="mt-1 text-2xl font-semibold">Report an issue</h1>
      <div className="mt-4">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <Content />
        </Suspense>
      </div>
    </main>
  );
}
