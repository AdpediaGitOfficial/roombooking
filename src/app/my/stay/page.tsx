import { Suspense } from "react";
import { requireResident } from "@/modules/self-service/context";
import { getMyStay } from "@/modules/self-service/service";
import { StayCard } from "@/modules/self-service/components/stay-card";
import { isoDate } from "@/modules/accommodation/occupancy";
import { keysHeldBy } from "@/modules/keys/service";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

async function StayContent() {
  const { staff } = await requireResident("/my/stay");
  if (!staff) {
    return <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">Your account is not linked to a staff record yet. Contact the accommodation office.</p>;
  }
  const [stay, heldKeys] = await Promise.all([getMyStay(staff.id), keysHeldBy(staff.id)]);
  const site = stay.current?.bed.room.building.site ?? stay.upcoming?.bed.room.building.site ?? null;

  return (
    <>
      <StayCard allocation={stay.current} />

      {stay.current && (
        <dl className="mt-4 divide-y divide-zinc-200 rounded-lg border border-zinc-200 px-4 dark:divide-zinc-800 dark:border-zinc-800">
          <Row label="Status">{stay.current.status === "CHECKED_IN" ? "Checked in" : "Allocated, not yet checked in"}</Row>
          <Row label="Room type">{stay.current.bed.room.type?.toLowerCase() ?? "room"}</Row>
          {stay.roomSharing && (
            <Row label="Room sharing">{stay.roomSharing.capacity === 1 ? "Single occupancy" : `${stay.roomSharing.occupied} of ${stay.roomSharing.capacity} beds in use`}</Row>
          )}
          {stay.current.checkedInAt && <Row label="Checked in on">{stay.current.checkedInAt.toISOString().slice(0, 10)}</Row>}
          {site?.address && <Row label="Address">{site.address}</Row>}
        </dl>
      )}

      {stay.upcoming && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">{stay.current ? "Your next bed" : "Upcoming stay"}</h2>
          <div className="mt-2"><StayCard allocation={stay.upcoming} /></div>
        </section>
      )}

      {heldKeys.length > 0 && (
        <section className="mt-6" data-held-keys>
          <h2 className="text-lg font-semibold">Keys you hold</h2>
          <ul className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {heldKeys.map((t) => (
              <li key={t.id} className="flex justify-between gap-3 p-3 text-sm">
                <div>
                  <div className="font-medium">{t.key.code}{t.key.label ? ` · ${t.key.label}` : ""}</div>
                  <div className="text-xs text-zinc-500">{t.key.room ? `${t.key.room.building.name} room ${t.key.room.code}` : t.key.facility?.name ?? ""} · issued {t.createdAt.toISOString().slice(0, 10)}</div>
                </div>
                <div className="text-right text-xs text-zinc-500">{t.expectedReturnAt ? `return by ${t.expectedReturnAt.toISOString().slice(0, 10)}` : "return at check-out"}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Accommodation office</h2>
        {site ? (
          <dl className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 px-4 dark:divide-zinc-800 dark:border-zinc-800">
            <Row label="Site">{site.name}</Row>
            {site.contactPhone && <Row label="Phone"><a href={`tel:${site.contactPhone}`} className="underline">{site.contactPhone}</a></Row>}
            {site.contactEmail && <Row label="Email"><a href={`mailto:${site.contactEmail}`} className="underline">{site.contactEmail}</a></Row>}
            {site.helpNotes && <Row label="Help">{site.helpNotes}</Row>}
          </dl>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">Contact details will appear once you have an allocation.</p>
        )}
      </section>

      {stay.history.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">Previous stays</h2>
          <ul className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {stay.history.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 p-3 text-sm">
                <div>
                  <div>Bed {a.bed.code} · {a.bed.room.building.name}</div>
                  <div className="text-xs text-zinc-500 tabular-nums">{isoDate(a.startDate)} → {a.endDate ? isoDate(a.endDate) : "—"}</div>
                </div>
                <div className="text-xs text-zinc-500">{a.status.toLowerCase().replace("_", " ")}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export default function MyStayPage() {
  return (
    <main>
      <h1 className="text-2xl font-semibold">My stay</h1>
      <div className="mt-4">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <StayContent />
        </Suspense>
      </div>
    </main>
  );
}
