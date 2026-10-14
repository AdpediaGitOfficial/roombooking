import { Suspense } from "react";
import { requireRole } from "@/lib/auth/authorize";
import { ALL_ROLES, USER_ADMIN_ROLES } from "@sam/core/modules/admin/access";
import { api } from "@/lib/api";
import { CreateUserForm } from "@/modules/admin/components/forms";
import { PageHeader } from "@/components/shell/page-header";

async function Content() {
  await requireRole(USER_ADMIN_ROLES, "/admin/users/new");
  const { options, staff } = await api.users.options();
  return <CreateUserForm options={options} staff={staff} roles={ALL_ROLES} />;
}

export default function NewUserPage() {
  return (
    <main className="max-w-3xl">
      <PageHeader title="New user" subtitle="The account starts as invited. Share the one-time link so the person can set their password." />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
