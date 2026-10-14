import { Suspense } from "react";
import { requireRole } from "@/lib/auth/authorize";
import { MAINTENANCE_COORDINATOR_ROLES } from "@sam/core/modules/maintenance/access";
import { CATEGORIES } from "@sam/core/modules/maintenance/rules";
import { api } from "@/lib/api";
import { NewWorkOrderForm } from "@/modules/maintenance/components/forms";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  await requireRole(MAINTENANCE_COORDINATOR_ROLES, "/maintenance/new");
  const { rooms, buildings } = await api.maintenance.locationOptions();
  return <NewWorkOrderForm categories={CATEGORIES} rooms={rooms} buildings={buildings} returnTo="ops" />;
}

export default function NewTicketPage() {
  return (
    <main className="max-w-xl">
      <PageHeader title="Raise a ticket" subtitle="For issues reported by phone, inspection or in common areas." />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
