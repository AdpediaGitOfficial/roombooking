import { Suspense } from "react";
import { requireResident } from "@/modules/self-service/context";
import { ProfileForm, PasswordForm } from "@/modules/self-service/components/forms";
import { EmailPreferenceForm } from "@/modules/notifications/components/forms";
import { logout } from "@/app/login/actions";

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
        <h2 className="text-lg font-semibold">Employment record</h2>
        <p className="mt-1 text-xs text-zinc-500">Managed by HR and the accommodation office. Contact them for corrections.</p>
        <dl className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 px-4 dark:divide-zinc-800 dark:border-zinc-800">
          <Row label="Name">{staff ? `${staff.firstName} ${staff.lastName}` : user.name}</Row>
          <Row label="Email">{user.email}</Row>
          {staff && <Row label="Employee ID">{staff.employeeId}</Row>}
          {staff?.department && <Row label="Department">{staff.department}</Row>}
          {staff?.company && <Row label="Company">{staff.company}</Row>}
          {staff && <Row label="Employment status">{staff.employmentStatus.toLowerCase().replace("_", " ")}</Row>}
        </dl>
      </section>

      {staff && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Contact details</h2>
          <div className="mt-2">
            <ProfileForm phone={staff.phone ?? ""} emergencyContactName={staff.emergencyContactName ?? ""} emergencyContactPhone={staff.emergencyContactPhone ?? ""} />
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Notifications</h2>
        <div className="mt-2"><EmailPreferenceForm enabled={user.emailNotifications} /></div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Password</h2>
        <div className="mt-2"><PasswordForm /></div>
      </section>

      <section className="mt-8">
        <form action={logout}>
          <button type="submit" className="w-full rounded-md border border-zinc-300 px-4 py-3 text-base dark:border-zinc-700">Sign out</button>
        </form>
      </section>
    </>
  );
}

export default function MyProfilePage() {
  return (
    <main>
      <h1 className="text-2xl font-semibold">Profile</h1>
      <div className="mt-4">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <ProfileContent />
        </Suspense>
      </div>
    </main>
  );
}
