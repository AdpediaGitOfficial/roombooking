import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { actorOf, requireCapability, userCan } from "@/lib/auth/authorize";
import { STAY_LABEL, getPerson } from "@sam/core/modules/people/service";
import { PeopleError } from "@sam/core/modules/people/errors";
import { isoDate } from "@sam/core/modules/accommodation/occupancy";
import { rowStay, STAY_TONE } from "@/modules/people/stay";
import { ActionForm } from "@/components/forms/action-form";
import { addDependentAction, archiveStaffAction, decideDependentAction, entitlementAction, exitAction, joinerAction, rehireAction, updateStaffAction, verifyStaffAction } from "@/modules/people/actions";
import { staffFields } from "@/modules/people/fields";
import { PageHeader } from "@/components/shell/page-header";

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCapability("people.view", { returnTo: "/people", level: "access" });
  const { id } = await params;
  const person = await getPerson(actorOf(user), id).catch((e) => { if (e instanceof PeopleError && e.code === "NOT_FOUND") notFound(); throw e; });
  const { row, view } = person;
  const stay = rowStay(row);
  const full = person.level === "FULL";
  const can = (k: string) => userCan(user, k);
  const ent = (row.entitlement ?? {}) as { roomTypes?: string[]; maxDays?: number; maxSharing?: number };
  return (
    <>
      <PageHeader title={view.name} status={<span className={`chip ${STAY_TONE[stay]}`}>{STAY_LABEL[stay]}</span>}
        subtitle={`${row.employeeId} · ${row.profileType.replace("_", " ").toLowerCase()} · ${row.verificationStatus.toLowerCase()}${view.masked ? " · some details are masked for your role" : ""}`}
        crumbs={[["People", "/people"], [view.name]]} />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <section className="card p-4">
            <h3 className="font-medium">Profile</h3>
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {([["Phone", view.phone], ["Email", view.email], ["Department", view.department], ["Company", view.company], ["Grade", view.grade], ["Designation", view.designation], ["ID", view.idNumber ? `${view.idType ?? "ID"} ${view.idNumber}` : view.idType], ["Nationality", view.nationality], ["Emergency contact", view.emergencyContactName ? `${view.emergencyContactName} ${view.emergencyContactPhone ?? ""}` : null], ["Profile ends", row.profileEndDate ? isoDate(row.profileEndDate) : null]] as Array<[string, string | null]>).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-zinc-100 py-1"><dt className="text-zinc-500">{k}</dt><dd>{v ?? "—"}</dd></div>
              ))}
            </dl>
          </section>
          <section className="card p-4">
            <h3 className="font-medium">Stays</h3>
            <ul className="mt-2 divide-y divide-zinc-100 text-sm">
              {row.allocations.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span><Link href={`/accommodation/allocations/${a.id}`} className="underline">{a.bed.code}</Link> · {a.bed.room.building.name} · {a.bed.room.building.site.name}</span>
                  <span className="text-zinc-600">{isoDate(a.startDate)} → {a.endDate ? isoDate(a.endDate) : "open"} · {a.status.toLowerCase().replace("_", " ")}{a.provisional ? " · provisional" : ""}</span>
                </li>
              ))}
              {row.allocations.length === 0 && <li className="py-2 text-zinc-500">No stays yet.</li>}
            </ul>
            {can("charges.raise") && <Link href={`/charges/new?staffId=${row.id}`} className="btn btn-small btn-ghost mt-3 ml-2 inline-block">Record a charge</Link>}
            {can("accom.allocate") && !row.archivedAt && <Link href={`/accommodation/allocations/new?staffId=${row.id}`} className="btn btn-small mt-3 inline-block">Allocate a bed</Link>}
          </section>
          {full && (
            <section className="card p-4">
              <h3 className="font-medium">Dependents</h3>
              <ul className="mt-2 divide-y divide-zinc-100 text-sm">
                {person.row.dependents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{d.name} · {d.relationship}</span>
                    <span className="flex items-center gap-2"><span className={`chip ${d.status === "VERIFIED" ? "chip-ok" : d.status === "PENDING" ? "chip-warn" : "chip-bad"}`}>{d.status.toLowerCase()}</span>
                      {d.status === "PENDING" && can("people.verify") && <><ActionForm compact action={decideDependentAction} hidden={{ dependentId: d.id, decision: "approve" }} fields={[]} submit="Verify" /><ActionForm compact tone="secondary" action={decideDependentAction} hidden={{ dependentId: d.id, decision: "reject" }} fields={[]} submit="Reject" /></>}
                    </span>
                  </li>
                ))}
                {person.row.dependents.length === 0 && <li className="py-2 text-zinc-500">None recorded.</li>}
              </ul>
              {can("people.dependents") && <div className="mt-3"><ActionForm action={addDependentAction} hidden={{ staffId: row.id }} title="Add dependent" submit="Add dependent" fields={[{ name: "name", label: "Name", required: true }, { name: "relationship", label: "Relationship", required: true }, { name: "dateOfBirth", label: "Date of birth", type: "date" }, { name: "idNumber", label: "ID number" }]} /></div>}
            </section>
          )}
        </div>
        <div className="space-y-4">
          {row.verificationStatus === "UNVERIFIED" && can("people.verify") && <ActionForm action={verifyStaffAction} hidden={{ staffId: row.id }} title="Verify this profile" intro="You cannot verify a profile you added yourself." submit="Verify" />}
          {full && can("people.eligibility") && (
            <ActionForm action={entitlementAction} hidden={{ staffId: row.id }} title="Eligibility & entitlement" submit="Save eligibility" fields={[
              { name: "eligibilityCategory", label: "Eligibility category", defaultValue: row.eligibilityCategory ?? "" },
              { name: "roomTypes", label: "Entitled room types", type: "multiselect", defaultValue: ent.roomTypes ?? [], options: ["SINGLE", "DOUBLE", "TRIPLE", "DORMITORY", "SUITE", "FAMILY"].map((v) => ({ value: v, label: v.toLowerCase() })) },
              { name: "maxDays", label: "Maximum stay (days)", type: "number", defaultValue: ent.maxDays ?? "" },
              { name: "maxSharing", label: "Maximum sharing", type: "number", defaultValue: ent.maxSharing ?? "" },
            ]} />
          )}
          {full && can("people.joiner") && !row.archivedAt && <ActionForm action={joinerAction} hidden={{ staffId: row.id }} title="Raise joiner / transfer-in" submit="Raise joiner" fields={[{ name: "expectedArrival", label: "Expected arrival", type: "date", required: true }, { name: "endDate", label: "Planned end", type: "date" }, { name: "stayType", label: "Stay type", type: "select", options: [{ value: "PERMANENT", label: "Permanent" }, { value: "TEMPORARY", label: "Temporary" }] }, { name: "notes", label: "Notes", type: "textarea" }]} />}
          {full && can("people.exit") && !row.archivedAt && <ActionForm action={exitAction} hidden={{ staffId: row.id }} title="Trigger exit" intro="Checkout becomes due and clearance opens." tone="danger" submit="Trigger exit" fields={[{ name: "lastDay", label: "Last day", type: "date", required: true }, { name: "reason", label: "Reason" }]} />}
          {full && can("people.rehire") && (row.archivedAt || row.employmentStatus === "TERMINATED") && !row.mergedIntoId && <ActionForm action={rehireAction} hidden={{ staffId: row.id }} title="Rehire / reactivate" submit="Reactivate" />}
          {full && can("people.verify") && (
            <details className="card p-4">
              <summary className="cursor-pointer font-medium">Edit master data</summary>
              <div className="mt-3"><ActionForm compact action={updateStaffAction} hidden={{ staffId: row.id }} submit="Save" fields={staffFields.map((f) => ({ ...f, defaultValue: ((row as unknown as Record<string, unknown>)[f.name] instanceof Date ? isoDate((row as unknown as Record<string, Date>)[f.name]) : ((row as unknown as Record<string, string | null>)[f.name] ?? "")) }))} /></div>
            </details>
          )}
          {full && can("people.verify") && !row.archivedAt && <ActionForm action={archiveStaffAction} hidden={{ staffId: row.id }} title="Archive" intro="Soft delete; restorable for 30 days." tone="secondary" submit="Archive" fields={[{ name: "reason", label: "Reason", required: true }]} />}
        </div>
      </div>
    </>
  );
}

export default function PersonPage({ params }: PageProps<"/people/[id]">) {
  return <main><Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Detail params={params} /></Suspense></main>;
}
