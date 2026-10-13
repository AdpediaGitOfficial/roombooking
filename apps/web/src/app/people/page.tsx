import { Suspense } from "react";
import Link from "next/link";
import type { StaffProfileType } from "@prisma/client";
import { actorOf, requireCapability, userCan } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { PROFILE_TYPES, STAY_LABEL, listPeople } from "@sam/core/modules/people/service";
import { rowStay, STAY_TONE } from "@/modules/people/stay";
import { PageHeader } from "@/components/shell/page-header";

async function Directory({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; v?: string; verification?: string; archived?: string }> }) {
  const user = await requireCapability("people.view", { returnTo: "/people", level: "access" });
  const sp = await searchParams;
  const rows = await listPeople(actorOf(user), {
    q: sp.q, profileType: PROFILE_TYPES.includes(sp.type as StaffProfileType) ? (sp.type as StaffProfileType) : null,
    verification: (sp.v ?? sp.verification) === "UNVERIFIED" ? "UNVERIFIED" : null, archived: sp.archived === "1", siteScope: await visibleSites(user, "people.view"),
  });
  const canExport = userCan(user, "people.export");
  return (
    <section className="panel">
      <form className="toolbar" action="/people">
        <input name="q" defaultValue={sp.q} placeholder="Search name, ID, department, phone" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm" />
        <select name="type" defaultValue={sp.type ?? ""} className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"><option value="">All types</option>{PROFILE_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ").toLowerCase()}</option>)}</select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="v" value="UNVERIFIED" defaultChecked={(sp.v ?? sp.verification) === "UNVERIFIED"} /> Unverified only</label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="archived" value="1" defaultChecked={sp.archived === "1"} /> Archived</label>
        <button className="btn btn-small" type="submit">Filter</button>
        <span className="ml-auto text-xs text-zinc-500">{rows.length} shown{rows.length >= 200 ? " (first 200)" : ""}{canExport ? <> · <Link href={`/people/export?q=${encodeURIComponent(sp.q ?? "")}`} className="underline">Export CSV</Link></> : null}</span>
      </form>
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>Person</th><th>Type</th><th>Department</th><th>Stay</th><th>Bed</th></tr></thead>
          <tbody>
            {rows.map(({ row, view }) => {
              if (!view) return null;
              const stay = rowStay(row);
              const bed = row.allocations.find((a) => a.status === "CHECKED_IN" || a.status === "CONFIRMED");
              return (
                <tr key={row.id}>
                  <td><div className="who"><span className="av">{row.firstName[0]}{row.lastName[0]}</span><div><Link href={`/people/${row.id}`} className="font-medium underline">{view.name}</Link><small>{row.employeeId}{view.phone ? ` · ${view.phone}` : ""}</small></div></div></td>
                  <td>{row.profileType.replace("_", " ").toLowerCase()}</td>
                  <td>{view.department ?? "—"}</td>
                  <td><span className={`chip ${STAY_TONE[stay]}`}>{STAY_LABEL[stay]}</span></td>
                  <td>{bed ? <>{bed.bed.code}<span className="sub">{bed.bed.room.building.site.name}</span></> : "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-sm text-zinc-500">No one matches.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function PeoplePage({ searchParams }: PageProps<"/people">) {
  return (
    <main>
      <PageHeader title="People" subtitle="Staff, contractors, guests and trainees with their stay status." crumbs={[["People"]]}
        actions={<><Link href="/people/joiners" className="btn btn-small btn-ghost">Joiners</Link><Link href="/people/exits" className="btn btn-small btn-ghost">Exits</Link><Link href="/people/verification" className="btn btn-small btn-ghost">Verification</Link><Link href="/people/duplicates" className="btn btn-small btn-ghost">Duplicates</Link><Link href="/people/new" className="btn btn-small">Add person</Link></>} />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Directory searchParams={searchParams as Promise<{ q?: string }>} /></Suspense>
    </main>
  );
}
