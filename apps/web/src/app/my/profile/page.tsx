import { Suspense } from "react";
import { requireResident } from "@/modules/self-service/context";
import { ProfileForm, PasswordForm } from "@/modules/self-service/components/forms";
import { EmailPreferenceForm, WhatsAppPreferenceForm } from "@/modules/notifications/components/forms";
import { logout } from "@/app/login/actions";
import { extraAccessNotes } from "@sam/core/lib/permissions/engine";
import { principalOf } from "@/lib/auth/authorize";
import { ROLE_META } from "@sam/core/lib/permissions/roles";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

async function ProfileContent() {
  const { user, staff } = await requireResident("/my/profile");
  return (
    <>
      <section>
        <h2 className="section-title">Employment record</h2>
        <p className="mt-1 text-xs text-zinc-500">Managed by HR and the accommodation office. Contact them for corrections.</p>
        <dl className="mt-2 divide-y divide-zinc-200 card px-4">
          <Row label="Name">{staff ? `${staff.firstName} ${staff.lastName}` : user.name}</Row>
          <Row label="Username">{user.username}</Row>
          {user.email && <Row label="Email">{user.email}</Row>}
          {staff && <Row label="Employee ID">{staff.employeeId}</Row>}
          {staff?.department && <Row label="Department">{staff.department}</Row>}
          {staff?.company && <Row label="Company">{staff.company}</Row>}
          {staff && <Row label="Employment status">{staff.employmentStatus.toLowerCase().replace("_", " ")}</Row>}
        </dl>
      </section>

      {(() => {
        const extra = extraAccessNotes(principalOf(user));
        return (
          <section className="mt-8" data-access-note>
            <h2 className="section-title">Your access</h2>
            <p className="mt-1 text-xs text-zinc-500">{[...new Set(user.roleAssignments.map((r) => ROLE_META[r.role].label))].join(", ") || "No roles"}</p>
            {extra.length > 0 && (
              <ul className="card mt-2 divide-y divide-zinc-200 px-4 text-sm">
                {extra.map((x, i) => <li key={i} className="py-2">Extra access: <b>{x.label}</b>{x.expiresAt ? <span className="text-zinc-500"> · until {x.expiresAt.toISOString().slice(0, 10)}</span> : null}</li>)}
              </ul>
            )}
          </section>
        );
      })()}

      {staff && (
        <section className="mt-8">
          <h2 className="section-title">Contact details</h2>
          <div className="mt-2">
            <ProfileForm phone={staff.phone ?? ""} emergencyContactName={staff.emergencyContactName ?? ""} emergencyContactPhone={staff.emergencyContactPhone ?? ""} />
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="section-title">Notifications</h2>
        <div className="mt-2"><EmailPreferenceForm enabled={user.emailNotifications} /></div>
        <h3 className="mt-6 font-medium">WhatsApp</h3>
        <div className="mt-2"><WhatsAppPreferenceForm number={user.whatsappNumber ?? ""} enabled={user.whatsappNotifications} consentAt={user.whatsappConsentAt ? user.whatsappConsentAt.toISOString().slice(0, 10) : null} suggestedNumber={staff?.phone} /></div>
      </section>

      <section className="mt-8">
        <h2 className="section-title">Password</h2>
        <div className="mt-2"><PasswordForm /></div>
      </section>

      <section className="mt-8">
        <form action={logout}>
          <button type="submit" className="w-full rounded-md border border-zinc-300 px-4 py-3 text-base">Sign out</button>
        </form>
      </section>
    </>
  );
}

export default function MyProfilePage() {
  return (
    <main>
      <h1 className="page-title">Profile</h1>
      <div className="mt-4">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <ProfileContent />
        </Suspense>
      </div>
    </main>
  );
}
