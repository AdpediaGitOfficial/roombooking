import { Suspense } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/auth/authorize";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/shell/page-header";
import { WorkOrderStatusBadge } from "@/modules/maintenance/components/views";

async function Results({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser("/search");
  const q = ((await searchParams).q ?? "").trim();
  if (q.length < 2) return <p className="text-sm text-zinc-500">Type at least two characters: a name, employee ID, bed or room code, or ticket number.</p>;
  const { staff, beds, tickets } = await api.search.all({ q });
  const total = staff.length + beds.length + tickets.length;
  if (total === 0) return <p className="text-sm text-zinc-500">Nothing matches “{q}”.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {staff.length > 0 && (
        <section className="panel"><div className="panel-head"><h2>People</h2></div>
          <ul className="divide-y divide-zinc-200">{staff.map((s) => (
            <li key={s.id} className="px-4 py-3"><Link href={`/accommodation/allocations?filter=all&staffId=${s.id}`} className="who"><span className="av">{(s.firstName[0] ?? "") + (s.lastName[0] ?? "")}</span><span><b>{s.firstName} {s.lastName}</b><small>{s.employeeId}{s.allocations[0] ? ` · bed ${s.allocations[0].bed.code}` : " · no bed"}</small></span></Link></li>
          ))}</ul></section>
      )}
      {beds.length > 0 && (
        <section className="panel"><div className="panel-head"><h2>Beds and rooms</h2></div>
          <ul className="divide-y divide-zinc-200">{beds.map((b) => (
            <li key={b.id} className="px-4 py-3"><Link href={`/accommodation/rooms/${b.roomId}`} className="block"><b className="font-semibold">Bed {b.code}</b><span className="sub">{b.room.building.name} · Room {b.room.code} · {b.status.toLowerCase()}</span></Link></li>
          ))}</ul></section>
      )}
      {tickets.length > 0 && (
        <section className="panel"><div className="panel-head"><h2>Maintenance tickets</h2></div>
          <ul className="divide-y divide-zinc-200">{tickets.map((t) => (
            <li key={t.id} className="px-4 py-3"><Link href={`/maintenance/${t.id}`} className="block"><span className="flex items-center justify-between gap-2"><b className="font-semibold">{t.ticketNumber}</b><WorkOrderStatusBadge status={t.status} /></span><span className="sub">{t.category} · {t.description.slice(0, 80)}</span></Link></li>
          ))}</ul></section>
      )}
    </div>
  );
}

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <AppShell returnTo="/search">
      <PageHeader crumbs={[["Search"]]} title="Search" subtitle="People, beds and rooms, and maintenance tickets you can see." />
      <Suspense fallback={<p className="text-sm text-zinc-500">Searching…</p>}>
        <Results searchParams={searchParams as Promise<{ q?: string }>} />
      </Suspense>
    </AppShell>
  );
}
