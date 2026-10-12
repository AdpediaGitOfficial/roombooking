import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasRole, requireRole } from "@/lib/auth/authorize";
import { ALLOCATION_ADMIN_ROLES, ALLOCATION_OPERATE_ROLES, ALLOCATION_VIEW_ROLES } from "@/modules/allocations/access";
import { clearanceBlockers, getAllocation } from "@/modules/allocations/service";
import { AllocationStatusBadge } from "@/modules/allocations/components/status-badge";
import { CancelForm, CheckInForm, CheckOutForm } from "@/modules/allocations/components/forms";
import { isoDate } from "@/modules/accommodation/occupancy";
import { KEY_OPERATE_ROLES } from "@/modules/keys/access";
import { RoomKeysPanel } from "@/modules/keys/components/room-keys-panel";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

async function AllocationView({ params }: { params: Promise<{ allocationId: string }> }) {
  const { allocationId } = await params;
  const user = await requireRole(ALLOCATION_VIEW_ROLES, `/accommodation/allocations/${allocationId}`);
  const allocation = await getAllocation(allocationId);
  if (!allocation) notFound();
  const canOperate = hasRole(user, ...ALLOCATION_OPERATE_ROLES);
  const canAdmin = hasRole(user, ...ALLOCATION_ADMIN_ROLES);
  const blockers = allocation.status === "CHECKED_IN" ? await clearanceBlockers(allocation.staffId) : [];
  const { staff, bed } = allocation;

  return (
    <>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        <Link href="/accommodation/allocations" className="underline">Allocations</Link>
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{staff.firstName} {staff.lastName}</h1>
        <AllocationStatusBadge status={allocation.status} />
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{staff.employeeId}{staff.department ? ` · ${staff.department}` : ""}{staff.user ? ` · ${staff.user.email}` : ""}</p>

      <dl className="mt-6 grid gap-4 rounded-lg border border-zinc-200 p-4 sm:grid-cols-3 dark:border-zinc-800">
        <Field label="Bed">
          <Link href={`/accommodation/rooms/${bed.room.id}`} className="underline">{bed.code}</Link>
          <div className="text-xs text-zinc-500">{bed.room.building.site.name} · {bed.room.building.name} · Room {bed.room.code}</div>
        </Field>
        <Field label="From / to"><span className="tabular-nums">{isoDate(allocation.startDate)} → {allocation.endDate ? isoDate(allocation.endDate) : "open-ended"}</span></Field>
        <Field label="Reason">{allocation.reason ?? <span className="text-zinc-400">—</span>}</Field>
        <Field label="Checked in">{allocation.checkedInAt ? allocation.checkedInAt.toISOString().replace("T", " ").slice(0, 16) + " UTC" : <span className="text-zinc-400">—</span>}</Field>
        <Field label="Checked out">{allocation.checkedOutAt ? allocation.checkedOutAt.toISOString().replace("T", " ").slice(0, 16) + " UTC" : <span className="text-zinc-400">—</span>}</Field>
        <Field label="Created by">{allocation.createdBy?.name ?? <span className="text-zinc-400">—</span>}</Field>
        {allocation.notes && <Field label="Notes"><span className="whitespace-pre-line">{allocation.notes}</span></Field>}
        {allocation.previous && (
          <Field label="Transferred from">
            <Link href={`/accommodation/allocations/${allocation.previous.id}`} className="underline">Bed {allocation.previous.bed.code}</Link>
            <div className="text-xs text-zinc-500">{allocation.previous.status.toLowerCase().replace("_", " ")}</div>
          </Field>
        )}
        {allocation.next.length > 0 && (
          <Field label="Transferred to">
            {allocation.next.map((n) => (
              <div key={n.id}>
                <Link href={`/accommodation/allocations/${n.id}`} className="underline">Bed {n.bed.code}</Link>
                <span className="ml-1 text-xs text-zinc-500">from {isoDate(n.startDate)} · {n.status.toLowerCase().replace("_", " ")}</span>
              </div>
            ))}
          </Field>
        )}
      </dl>

      {canOperate && (allocation.status === "CONFIRMED" || allocation.status === "CHECKED_IN") && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">Actions</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <RoomKeysPanel roomId={bed.room.id} staffId={allocation.staffId} canOperate={hasRole(user, ...KEY_OPERATE_ROLES)} returnPath={`/accommodation/allocations/${allocation.id}`} />
            {allocation.status === "CONFIRMED" && <CheckInForm allocationId={allocation.id} />}
            {allocation.status === "CHECKED_IN" && <CheckOutForm allocationId={allocation.id} blockers={blockers} canOverride={canAdmin} />}
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="font-medium">Transfer</h3>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Move to another bed now or on a future date. The current bed stays held until the effective date.</p>
              <Link href={`/accommodation/allocations/${allocation.id}/transfer`} className="mt-3 inline-block rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium dark:border-zinc-700">
                Choose a new bed
              </Link>
            </div>
            {allocation.status === "CONFIRMED" && canAdmin && <CancelForm allocationId={allocation.id} />}
          </div>
        </section>
      )}
    </>
  );
}

export default function AllocationPage({ params }: PageProps<"/accommodation/allocations/[allocationId]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <AllocationView params={params} />
      </Suspense>
    </main>
  );
}
