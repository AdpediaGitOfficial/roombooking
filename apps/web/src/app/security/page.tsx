import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { actorOf, requireUser, userCan, userCanAccess } from "@/lib/auth/authorize";
import { visibleSites } from "@/lib/auth/scope";
import { listSos, listVisitors, peopleInside, verifyResident } from "@sam/core/modules/security/service";
import { prisma } from "@sam/core/lib/db";
import { ActionForm } from "@/components/forms/action-form";
import { checkInAction, checkOutAction, contractorAction, walkInAction } from "@/modules/security/actions";
import { hostOptions, siteOptions } from "@/modules/security/context";
import { SecurityTabs } from "@/modules/security/tabs";
import { PageHeader } from "@/components/shell/page-header";

async function Gate({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser("/security");
  if (!userCanAccess(user, "sec.verify_resident") && !userCanAccess(user, "sec.checkin_visitors") && !userCanAccess(user, "sec.sos_respond")) redirect("/forbidden");
  const { q } = await searchParams;
  const sites = await visibleSites(user, "sec.checkin_visitors", "sec.verify_resident", "sec.sos_respond");
  const canCheck = userCan(user, "sec.checkin_visitors");
  const [found, expected, inside, sos, siteList, hosts, visits] = await Promise.all([
    q ? verifyResident(actorOf(user), q) : Promise.resolve([]),
    listVisitors({ filter: "expected", siteIds: sites }),
    peopleInside(sites),
    listSos({ siteIds: sites, open: true }),
    siteOptions(sites),
    canCheck ? hostOptions(sites) : Promise.resolve([]),
    prisma.contractorVisit.findMany({ where: { ...(sites ? { siteId: { in: sites } } : {}), status: { in: ["SCHEDULED", "PASS_ISSUED"] }, scheduledEnd: { gte: new Date() }, scheduledStart: { lte: new Date(Date.now() + 24 * 3600000) } }, orderBy: { scheduledStart: "asc" }, take: 30 }),
  ]);
  const vendors = new Map((await prisma.vendor.findMany({ where: { id: { in: visits.map((v) => v.vendorId) } }, select: { id: true, name: true } })).map((v) => [v.id, v.name]));
  return (
    <>
      <SecurityTabs user={user} active="gate" />
      {sos.length > 0 && <Link href="/security/sos" className="alert alert-danger mb-4 block"><span>!</span><div><b>{sos.length} active SOS alert{sos.length === 1 ? "" : "s"}</b>: {sos.map((s) => `${s.raisedBy}${s.location ? ` (${s.location})` : ""}`).join("; ")}</div></Link>}
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <section className="card p-4">
            <h2 className="section-title">Verify a resident</h2>
            <form action="/security" className="mt-2 flex gap-2"><input name="q" defaultValue={q} placeholder="Employee ID, name or phone" className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm" autoFocus /><button className="btn btn-primary" type="submit">Verify</button></form>
            {q && (
              <ul className="mt-3 divide-y divide-zinc-100">
                {found.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                    {p.hasPhoto && p.photoAttachmentId ? <img src={`/api/attachments/${p.photoAttachmentId}`} alt="" className="h-14 w-14 rounded-md object-cover" /> : <span className="av h-14 w-14">{p.name.split(" ").map((x) => x[0]).join("").slice(0, 2)}</span>}
                    <div className="flex-1"><b>{p.name}</b> <span className="text-xs text-zinc-500">{p.employeeId}{p.idType ? ` · ${p.idType}` : ""}</span><div className="text-xs text-zinc-600">{p.site ?? ""}{p.room ? ` · ${p.room}` : ""}</div></div>
                    <span className={`chip ${p.inside ? "chip-success" : "chip-warning"}`}>{p.stayLabel}</span>
                  </li>
                ))}
                {found.length === 0 && <li className="py-3 text-sm text-zinc-500">No resident found.</li>}
              </ul>
            )}
          </section>
          <section className="panel">
            <div className="toolbar"><h2 className="font-medium">Expected visitors ({expected.length})</h2><Link href="/security/visitors" className="ml-auto text-xs underline">All visitors</Link></div>
            <ul className="divide-y divide-zinc-200">
              {expected.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <div><Link href={`/security/visitors/${v.id}`} className="font-medium underline">{v.name}</Link> <span className="chip">{v.kind.toLowerCase().replace("_", " ")}</span><div className="text-xs text-zinc-500">for {v.hostName} · {v.expectedAt ? v.expectedAt.toISOString().slice(11, 16) : ""}{v.passCode ? ` · pass ${v.passCode}` : ""}</div></div>
                  {canCheck && <ActionForm compact action={checkInAction} hidden={{ visitorId: v.id }} submit="Check in" fields={[]} />}
                </li>
              ))}
              {expected.length === 0 && <li className="px-4 py-4 text-sm text-zinc-500">None expected.</li>}
            </ul>
          </section>
          <section className="panel">
            <div className="toolbar"><h2 className="font-medium">Contractor visits (next 24 hours)</h2></div>
            <ul className="divide-y divide-zinc-200">
              {visits.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <div><b>{vendors.get(v.vendorId) ?? "Vendor"}</b> <span className="chip">{v.status.toLowerCase().replace(/_/g, " ")}</span><div className="text-xs text-zinc-500">{v.scheduledStart.toISOString().slice(11, 16)}–{v.scheduledEnd.toISOString().slice(11, 16)} · {v.workerIds.length} worker(s){v.escortRequired ? " · escort required" : ""}{v.passCode ? ` · pass ${v.passCode}` : ""}</div></div>
                  {canCheck && <ActionForm compact action={contractorAction} hidden={{ visitId: v.id, op: "in" }} submit="Verify & check in" fields={[]} />}
                </li>
              ))}
              {visits.length === 0 && <li className="px-4 py-4 text-sm text-zinc-500">No contractor visits scheduled.</li>}
            </ul>
          </section>
          <section className="panel">
            <div className="toolbar"><h2 className="font-medium">People inside ({inside.visitors.length + inside.contractors.length})</h2></div>
            <ul className="divide-y divide-zinc-200">
              {inside.visitors.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"><div><b>{v.name}</b> <span className="chip">{v.kind.toLowerCase().replace("_", " ")}</span>{v.overstay && <span className="chip chip-danger ml-1">overstay</span>}<div className="text-xs text-zinc-500">in {v.since ? v.since.toISOString().slice(11, 16) : ""}{v.due ? ` · due out ${v.due.toISOString().slice(11, 16)}` : ""}</div></div>{canCheck && <ActionForm compact tone="secondary" action={checkOutAction} hidden={{ visitorId: v.id }} submit="Check out" fields={[]} />}</li>
              ))}
              {inside.contractors.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"><div><b>{c.vendor}</b> <span className="chip">contractor · {c.workers}</span>{c.overstay && <span className="chip chip-danger ml-1">overstay</span>}<div className="text-xs text-zinc-500">until {c.until.toISOString().slice(11, 16)}</div></div>{canCheck && <ActionForm compact tone="secondary" action={contractorAction} hidden={{ visitId: c.id, op: "out" }} submit="Check out" fields={[]} />}</li>
              ))}
              {inside.visitors.length + inside.contractors.length === 0 && <li className="px-4 py-4 text-sm text-zinc-500">Nobody inside.</li>}
            </ul>
          </section>
        </div>
        {canCheck && (
          <ActionForm action={walkInAction} title="Walk-in visitor" intro="The resident is asked to confirm before the visitor is let in." submit="Log walk-in" fields={[
            { name: "siteId", label: "Site", type: "select", options: siteList.map((s) => ({ value: s.id, label: s.name })) },
            { name: "hostStaffId", label: "Visiting", type: "select", options: hosts.map((h) => ({ value: h.id, label: h.label })) },
            { name: "name", label: "Visitor name", required: true }, { name: "idType", label: "ID type" }, { name: "idNumber", label: "ID number" }, { name: "phone", label: "Phone", type: "tel" }, { name: "vehicle", label: "Vehicle" }, { name: "purpose", label: "Purpose" },
          ]} />
        )}
      </div>
    </>
  );
}

export default function SecurityHome({ searchParams }: PageProps<"/security">) {
  return <main><PageHeader title="Gate" subtitle="Verify residents, admit visitors and contractors, see who is inside." crumbs={[["Security"]]} /><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Gate searchParams={searchParams as Promise<{ q?: string }>} /></Suspense></main>;
}
