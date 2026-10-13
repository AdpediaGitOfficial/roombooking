import { Suspense } from "react";
import { requireCapability } from "@/lib/auth/authorize";
import { CATEGORIES } from "@sam/core/modules/maintenance/service";
import { allRoomOptions, buildingOptions } from "@/modules/maintenance/context";
import { NewWorkOrderForm } from "@/modules/maintenance/components/forms";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  await requireCapability("maint.create", { returnTo: "/maintenance/new" });
  const [rooms, buildings] = await Promise.all([allRoomOptions(), buildingOptions()]);
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
