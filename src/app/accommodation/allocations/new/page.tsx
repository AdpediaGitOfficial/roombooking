import { Suspense } from "react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorize";
import { ALLOCATION_OPERATE_ROLES } from "@/modules/allocations/access";
import { findAvailableBeds, isIsoDate } from "@/modules/allocations/service";
import { AllocationError } from "@/modules/allocations/errors";
import { AllocateForm } from "@/modules/allocations/components/forms";
import { BedResultList } from "@/modules/allocations/components/bed-results";
import { OCCUPYING_STATUSES, todayInTimezone } from "@/modules/accommodation/occupancy";

type Params = { staffId?: string; buildingId?: string; bedId?: string; startDate?: string; endDate?: string; reason?: string };

const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

async function NewAllocation({ searchParams }: { searchParams: Promise<Params> }) {
  await requireRole(ALLOCATION_OPERATE_ROLES, "/accommodation/allocations/new");
  const params = await searchParams;

  const [staff, buildings] = await Promise.all([
    prisma.staffProfile.findMany({
      where: { employmentStatus: "ACTIVE" },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      include: { allocations: { where: { status: { in: OCCUPYING_STATUSES } }, include: { bed: true }, take: 1 } },
    }),
    prisma.building.findMany({ where: { status: "ACTIVE" }, include: { site: true }, orderBy: [{ site: { name: "asc" } }, { code: "asc" }] }),
  ]);

  const selectedStaff = staff.find((s) => s.id === params.staffId) ?? null;
  const defaultStart = todayInTimezone(buildings[0]?.site.timezone ?? "UTC");
  const startDate = params.startDate || defaultStart;
  const endDate = params.endDate || "";
  const searched = Boolean(params.staffId && isIsoDate(startDate));

  let beds: Awaited<ReturnType<typeof findAvailableBeds>> = [];
  let searchError: string | null = null;
  if (searched && selectedStaff) {
    try {
      beds = await findAvailableBeds({ startDate, endDate: endDate || null, buildingId: params.buildingId || null, gender: selectedStaff.gender });
      if (params.bedId) beds = beds.filter((b) => b.id === params.bedId);
    } catch (error) {
      if (error instanceof AllocationError) searchError = error.message;
      else throw error;
    }
  }

  return (
    <>
      <form method="get" className="grid gap-4 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2 dark:border-zinc-800">
        <label className="block text-sm sm:col-span-2">
          Staff member
          <select name="staffId" defaultValue={params.staffId ?? ""} required className={input}>
            <option value="" disabled>Select…</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.lastName}, {s.firstName} ({s.employeeId}){s.allocations[0] ? ` – currently ${s.allocations[0].bed.code}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Building
          <select name="buildingId" defaultValue={params.buildingId ?? ""} className={input}>
            <option value="">Any building</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.site.name} · {b.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          Reason / reference
          <input name="reason" defaultValue={params.reason ?? ""} className={input} placeholder="e.g. new joiner, approval ref" />
        </label>
        <label className="block text-sm">
          Start date
          <input type="date" name="startDate" defaultValue={startDate} required className={input} />
        </label>
        <label className="block text-sm">
          End date <span className="text-zinc-500">(optional)</span>
          <input type="date" name="endDate" defaultValue={endDate} className={input} />
        </label>
        {params.bedId && <input type="hidden" name="bedId" value={params.bedId} />}
        <div className="sm:col-span-2">
          <button type="submit" className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Find available beds</button>
          {params.bedId && <Link href={`/accommodation/allocations/new?staffId=${params.staffId ?? ""}&startDate=${startDate}`} className="ml-3 text-sm underline">Show all beds</Link>}
        </div>
      </form>

      {searchError && <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">{searchError}</p>}

      {searched && selectedStaff && !searchError && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">
            Available for {selectedStaff.firstName} {selectedStaff.lastName} from {startDate}{endDate ? ` to ${endDate}` : ""}
          </h2>
          {selectedStaff.allocations[0] && (
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
              This person already holds bed {selectedStaff.allocations[0].bed.code}. If the dates overlap, use a transfer from their current allocation instead.
            </p>
          )}
          <div className="mt-3">
            <BedResultList
              beds={beds}
              render={(bed) => (
                <AllocateForm bedId={bed.id} staffId={selectedStaff.id} startDate={startDate} endDate={endDate} reason={params.reason ?? ""} />
              )}
            />
          </div>
        </section>
      )}
    </>
  );
}

export default function NewAllocationPage({ searchParams }: PageProps<"/accommodation/allocations/new">) {
  return (
    <main>
      <h1 className="text-2xl font-semibold">New allocation</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-600 dark:text-zinc-400">Search available bed spaces, then allocate.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <NewAllocation searchParams={searchParams as Promise<Params>} />
      </Suspense>
    </main>
  );
}
