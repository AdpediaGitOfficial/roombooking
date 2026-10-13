import { Suspense } from "react";
import { requireRole } from "@/lib/auth/authorize";
import { ALL_ROLES, USER_ADMIN_ROLES } from "@/modules/admin/access";
import { scopeOptions, unlinkedStaff } from "@/modules/admin/users-service";
import { CreateUserForm } from "@/modules/admin/components/forms";

async function Content() {
  const actor = await requireRole(USER_ADMIN_ROLES, "/admin/users/new");
  const [options, staff] = await Promise.all([scopeOptions(), unlinkedStaff(actor.organizationId)]);
  return <CreateUserForm options={options} staff={staff} roles={ALL_ROLES} />;
}

export default function NewUserPage() {
  return (
    <main className="max-w-3xl">
      <h1 className="text-2xl font-semibold">New user</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-600 dark:text-zinc-400">The account starts as invited. Share the one-time link so the person can set their password.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
