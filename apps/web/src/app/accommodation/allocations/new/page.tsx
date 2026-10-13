import { Suspense } from "react";
import Link from "next/link";
import { prisma } from "@sam/core/lib/db";
import { requireRole } from "@/lib/auth/authorize";
import { ALLOCATION_OPERATE_ROLES } from "@sam/core/modules/allocations/access";
import { findAvailableBeds, isIsoDate } from "@sam/core/modules/allocations/service";
import { AllocationError } from "@sam/core/modules/allocations/errors";
import { AllocateForm } from "@/modules/allocations/components/forms";
import { PageHeader } from "@/components/shell/page-header";
import { OCCUPYING_STATUSES, todayInTimezone } from "@sam/core/modules/accommodation/occupancy";

type Params = { staffId?: string; buildingId?: string; bedId?: string; startDate?: string; endDate?: string; reason?: string };

const input = "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";

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

  const selectedBed = params.bedId ? beds.find((b) => b.id === params.bedId) ?? null : null;
  const step = selectedBed ? 4 : searched && selectedStaff ? 3 : selectedStaff ? 2 : 1;
  const nights = endDate && isIsoDate(endDate) && isIsoDate(startDate) ? Math.max(0, Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000)) : null;
  const query = (overrides: Partial<Params>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, startDate, endDate, ...overrides })) if (v) q.set(k, v);
    return `/accommodation/allocations/new?${q.toString()}`;
  };

  return (
    <>
      <div className="panel mb-4"><div className="panel-body">
        <ol className="steps">
          <li className={step > 1 ? "done" : "now"}>Person</li>
          <li className={step > 2 ? "done" : step === 2 ? "now" : ""}>Dates</li>
          <li className={step > 3 ? "done" : step === 3 ? "now" : ""}>Choose a bed</li>
          <li className={step === 4 ? "now" : ""}>Confirm</li>
        </ol>
      </div></div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4 content-start">
          <form method="get" className="panel" id="criteria">
            <div className="panel-head"><div><h2>Who and when</h2><p>Change any field and search again; the bed list follows the stay</p></div></div>
            <div className="panel-body grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium sm:col-span-2">
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
              <label className="block text-sm font-medium">
                Start date
                <input type="date" name="startDate" defaultValue={startDate} required className={input} />
              </label>
              <label className="block text-sm font-medium">
                End date <span className="font-normal text-zinc-500">(optional)</span>
                <input type="date" name="endDate" defaultValue={endDate} className={input} />
              </label>
              <label className="block text-sm font-medium">
                Building
                <select name="buildingId" defaultValue={params.buildingId ?? ""} className={input}>
                  <option value="">Any building</option>
                  {buildings.map((b) => <option key={b.id} value={b.id}>{b.site.name} · {b.name}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Reason / reference
                <input name="reason" defaultValue={params.reason ?? ""} className={input} placeholder="e.g. new joiner, approval ref" />
              </label>
              {selectedStaff && (
                <p className="alert alert-info sm:col-span-2">ⓘ {selectedStaff.firstName}&apos;s profile says {selectedStaff.gender.toLowerCase()}. Beds whose room rules do not match are hidden.{selectedStaff.allocations[0] ? ` They already hold bed ${selectedStaff.allocations[0].bed.code}; if the dates overlap, use a transfer from that allocation instead.` : ""}</p>
              )}
            </div>
            <div className="panel-foot">
              <button type="submit" className="btn btn-primary">{searched ? "Search again" : "Find available beds"}</button>
              {params.bedId && <Link href={query({ bedId: undefined })} className="btn btn-ghost">Show all beds</Link>}
            </div>
          </form>

          {searchError && <p role="alert" className="alert alert-danger">{searchError}</p>}

          {searched && selectedStaff && !searchError && (
            <section className="panel">
              <div className="panel-head"><div><h2>Available beds</h2><p>Free for the whole stay from {startDate}{endDate ? ` to ${endDate}` : ""} · {beds.length} bed{beds.length === 1 ? "" : "s"}</p></div><div className="text-xs text-zinc-500"><span className="chip chip-success">Free</span> pick one</div></div>
              <div className="panel-body">
                {beds.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">No beds are available for those criteria. Try another building or dates.</p>
                ) : (
                  <div className="bedgrid">
                    {beds.map((bed) => (
                      <Link key={bed.id} href={query({ bedId: bed.id })} data-bed={bed.code} className={`bed ${selectedBed?.id === bed.id ? "bed-pick" : "bed-free"}`} aria-current={selectedBed?.id === bed.id ? "true" : undefined}>
                        <b>Bed {bed.code}</b>
                        <span className="st">{bed.room.building.name} · Room {bed.room.code}</span>
                        <span className="st">{bed.room.type ? `${bed.room.type.toLowerCase()} · ` : ""}{bed.room.genderPolicy.toLowerCase()}</span>
                        {selectedBed?.id === bed.id && <span className="chip chip-success mt-1.5">Selected</span>}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="grid gap-4 content-start">
          <section className="panel">
            <div className="panel-head"><div><h2>Summary</h2></div><span className={`chip ${selectedBed ? "chip-success" : "chip-warning"}`}>{selectedBed ? "Ready" : "Draft"}</span></div>
            <div className="panel-body">
              <dl className="kv">
                <dt>Person</dt><dd>{selectedStaff ? `${selectedStaff.firstName} ${selectedStaff.lastName}` : <span className="text-zinc-400">—</span>}</dd>
                <dt>Bed</dt><dd>{selectedBed ? `${selectedBed.code} · ${selectedBed.room.building.name}` : <span className="text-zinc-400">choose below</span>}</dd>
                <dt>Stay</dt><dd className="tabular-nums">{startDate} → {endDate || "open-ended"}</dd>
                {nights !== null && <><dt>Nights</dt><dd>{nights}</dd></>}
                {params.reason && <><dt>Reason</dt><dd>{params.reason}</dd></>}
              </dl>
              {selectedBed && selectedStaff ? (
                <>
                  <p className="alert alert-success mt-3">✓ No conflicts. Bed {selectedBed.code} is free for the whole stay.</p>
                  <div className="mt-3"><AllocateForm bedId={selectedBed.id} staffId={selectedStaff.id} startDate={startDate} endDate={endDate} reason={params.reason ?? ""} label={`Allocate and notify ${selectedStaff.firstName}`} /></div>
                </>
              ) : (
                <p className="mt-3 text-xs text-zinc-500">{searched ? "Pick a bed from the list to continue." : "Choose the person and dates, then find available beds."}</p>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><div><h2>What happens next</h2></div></div>
            <div className="panel-body text-sm text-zinc-600">The resident gets an in-app and email confirmation with the bed, the check-in instructions and the site contact. Reception sees them on the arrivals list from the start date.</div>
          </section>
        </div>
      </div>
    </>
  );
}

export default function NewAllocationPage({ searchParams }: PageProps<"/accommodation/allocations/new">) {
  return (
    <main>
      <PageHeader crumbs={[["Accommodation", "/accommodation"], ["Allocations", "/accommodation/allocations"], ["New allocation"]]} title="New allocation" subtitle="Pick the person and the dates, then a bed that is free for the whole stay." actions={<Link href="/accommodation/allocations" className="btn btn-ghost">Cancel</Link>} />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <NewAllocation searchParams={searchParams as Promise<Params>} />
      </Suspense>
    </main>
  );
}
