import { Suspense } from "react";
import { requireRole } from "@/lib/auth/authorize";
import { MAINTENANCE_COORDINATOR_ROLES } from "@/modules/maintenance/access";
import { CATEGORIES } from "@/modules/maintenance/service";
import { allRoomOptions, buildingOptions } from "@/modules/maintenance/context";
import { NewWorkOrderForm } from "@/modules/maintenance/components/forms";

async function Content() {
  await requireRole(MAINTENANCE_COORDINATOR_ROLES, "/maintenance/new");
  const [rooms, buildings] = await Promise.all([allRoomOptions(), buildingOptions()]);
  return <NewWorkOrderForm categories={CATEGORIES} rooms={rooms} buildings={buildings} returnTo="ops" />;
}

export default function NewTicketPage() {
  return (
    <main className="max-w-xl">
      <h1 className="text-2xl font-semibold">Raise a ticket</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-600 dark:text-zinc-400">For issues reported by phone, inspection or in common areas.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
