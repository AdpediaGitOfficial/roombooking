import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorize";
import { ALLOCATION_OPERATE_ROLES } from "@/modules/allocations/access";
import { findAvailableBeds, getAllocation, isIsoDate } from "@/modules/allocations/service";
import { AllocationError } from "@/modules/allocations/errors";
import { TransferForm } from "@/modules/allocations/components/forms";
import { BedResultList } from "@/modules/allocations/components/bed-results";
import { isoDate, todayInTimezone } from "@/modules/accommodation/occupancy";

type Params = { effectiveDate?: string; buildingId?: string; reason?: string; requestId?: string };
const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";

async function TransferView({ params, searchParams }: { params: Promise<{ allocationId: string }>; searchParams: Promise<Params> }) {
  const { allocationId } = await params;
  await requireRole(ALLOCATION_OPERATE_ROLES, `/accommodation/allocations/${allocationId}/transfer`);
  const [allocation, query] = await Promise.all([getAllocation(allocationId), searchParams]);
  if (!allocation) notFound();
  const transferable = allocation.status === "CONFIRMED" || allocation.status === "CHECKED_IN";

  const today = todayInTimezone(allocation.bed.room.building.site.timezone);
  const effectiveDate = query.effectiveDate || today;
  const reason = query.reason ?? "";
  const buildings = await prisma.building.findMany({ where: { status: "ACTIVE" }, include: { site: true }, orderBy: [{ site: { name: "asc" } }, { code: "asc" }] });

  let beds: Awaited<ReturnType<typeof findAvailableBeds>> = [];
  let searchError: string | null = null;
  const searched = transferable && isIsoDate(effectiveDate) && reason.trim().length > 0;
  if (searched) {
    try {
      beds = await findAvailableBeds({
        startDate: effectiveDate,
        endDate: allocation.endDate ? isoDate(allocation.endDate) : null,
        buildingId: query.buildingId || null,
        gender: allocation.staff.gender,
        excludeBedId: allocation.bedId,
      });
    } catch (error) {
      if (error instanceof AllocationError) searchError = error.message;
      else throw error;
    }
  }

  return (
    <>
      <p className="text-sm text-zinc-600">
        <Link href={`/accommodation/allocations/${allocation.id}`} className="underline">{allocation.staff.firstName} {allocation.staff.lastName}</Link> · currently bed {allocation.bed.code}
      </p>
      <h1 className="mt-1 text-2xl font-semibold">Transfer</h1>
      {query.requestId && (
        <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
          Completing approved room change request {query.requestId.slice(-8).toUpperCase()}. The request closes when the transfer is saved.
        </p>
      )}
      {!transferable ? (
        <p className="mt-4 text-sm text-red-700">This allocation is {allocation.status.toLowerCase().replace("_", " ")} and cannot be transferred.</p>
      ) : (
        <>
          <form method="get" className="mt-6 grid gap-4 card p-4 sm:grid-cols-3">
            <label className="block text-sm">
              Effective date
              <input type="date" name="effectiveDate" defaultValue={effectiveDate} min={today} required className={input} />
            </label>
            <label className="block text-sm">
              Building
              <select name="buildingId" defaultValue={query.buildingId ?? ""} className={input}>
                <option value="">Any building</option>
                {buildings.map((b) => <option key={b.id} value={b.id}>{b.site.name} · {b.name}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              Reason
              <input name="reason" defaultValue={reason} required className={input} placeholder="e.g. room change request #…" />
            </label>
            {query.requestId && <input type="hidden" name="requestId" value={query.requestId} />}
            <div className="sm:col-span-3">
              <button type="submit" className="btn btn-primary">Find available beds</button>
              <span className="ml-3 text-xs text-zinc-500">
                {effectiveDate === today ? "Same-day: the resident moves immediately." : `Future-dated: current bed is held until ${effectiveDate}.`}
              </span>
            </div>
          </form>
          {searchError && <p role="alert" className="mt-4 text-sm text-red-700">{searchError}</p>}
          {searched && !searchError && (
            <div className="mt-6">
              <BedResultList beds={beds} render={(bed) => <TransferForm allocationId={allocation.id} toBedId={bed.id} effectiveDate={effectiveDate} reason={reason} requestId={query.requestId} />} />
            </div>
          )}
        </>
      )}
    </>
  );
}

export default function TransferPage({ params, searchParams }: PageProps<"/accommodation/allocations/[allocationId]/transfer">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <TransferView params={params} searchParams={searchParams as Promise<Params>} />
      </Suspense>
    </main>
  );
}
