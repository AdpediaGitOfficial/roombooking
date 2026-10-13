import { Suspense } from "react";
import { notFound } from "next/navigation";
import { hasRole, requireRole } from "@/lib/auth/authorize";
import { ADMIN_VIEW_ROLES, ALL_ROLES, ROLE_DESCRIPTIONS, USER_ADMIN_ROLES } from "@/modules/admin/access";
import { getUser, listAudit, scopeLabel, scopeOptions, unlinkedStaff } from "@/modules/admin/users-service";
import { AddRoleForm, EditUserForm, RemoveRoleButton, SignOutEverywhereForm, StatusForm, TokenForm } from "@/modules/admin/components/forms";
import { UserStatusBadge } from "../page";
import { prisma } from "@/lib/db";

async function Content({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<{ invited?: string }> }) {
  const { userId } = await params;
  const { invited } = await searchParams;
  const actor = await requireRole(ADMIN_VIEW_ROLES, `/admin/users/${userId}`);
  const canManage = hasRole(actor, ...USER_ADMIN_ROLES);
  const user = await getUser(userId);
  if (!user || user.organizationId !== actor.organizationId) notFound();
  const [options, staff, audit] = await Promise.all([scopeOptions(), unlinkedStaff(actor.organizationId, user.id), listAudit({ entityId: user.id, entityType: "User" }, 30)]);
  const isVendor = user.roleAssignments.some((r) => r.role === "VENDOR");
  // The invite link is only recoverable right after creation (from the queued email payload).
  const pendingInvite = invited && user.status === "INVITED" ? await prisma.notification.findFirst({ where: { recipientId: user.id, event: "user.invited" }, orderBy: { createdAt: "desc" } }) : null;
  const initialLink = (pendingInvite?.payload as { invitePath?: string } | null)?.invitePath ?? null;

  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="page-title">{user.name}</h1>
        <UserStatusBadge status={user.status} />
      </div>
      <p className="mt-1 text-sm text-zinc-600">{user.email}{user.staffProfile ? ` · ${user.staffProfile.employeeId}${user.staffProfile.department ? ` · ${user.staffProfile.department}` : ""}` : ""}{user.vendor ? ` · ${user.vendor.name}` : ""}{user.lastLoginAt ? ` · last sign-in ${user.lastLoginAt.toISOString().replace("T", " ").slice(0, 16)}` : " · never signed in"}</p>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section className="space-y-4">
          <div className="card p-4">
            <h3 className="font-medium">Roles</h3>
            <ul className="mt-2 divide-y divide-zinc-200">
              {user.roleAssignments.map((a) => (
                <li key={a.id} data-role={a.role} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div><div className="font-medium">{a.role.toLowerCase().replace(/_/g, " ")} <span className="font-normal text-zinc-500">· {scopeLabel(a)}</span></div><div className="text-xs text-zinc-500">{ROLE_DESCRIPTIONS[a.role]}</div></div>
                  {canManage && <RemoveRoleButton userId={user.id} assignmentId={a.id} />}
                </li>
              ))}
              {user.roleAssignments.length === 0 && <li className="py-2 text-sm text-zinc-500">No roles: this account can sign in but reach nothing.</li>}
            </ul>
            {canManage && <AddRoleForm userId={user.id} options={options} roles={ALL_ROLES} />}
          </div>
          {canManage && <EditUserForm userId={user.id} name={user.name} email={user.email} staffProfileId={user.staffProfile?.id ?? ""} vendorId={user.vendor?.id ?? ""} accessExpiresAt={user.accessExpiresAt?.toISOString().slice(0, 10) ?? ""} options={options} staff={staff} isVendor={isVendor} />}
        </section>
        <section className="space-y-4">
          {canManage && user.id !== actor.id && <StatusForm userId={user.id} status={user.status} hasPassword={!!user.passwordHash} />}
          {canManage && user.id === actor.id && <p className="card p-4 text-sm text-zinc-500">This is your own account. Another administrator must change its status or administrator role.</p>}
          {canManage && user.status === "INVITED" && <TokenForm userId={user.id} purpose="INVITE" initialLink={initialLink} />}
          {canManage && user.status === "ACTIVE" && <TokenForm userId={user.id} purpose="RESET" />}
          {canManage && <SignOutEverywhereForm userId={user.id} sessions={user._count.sessions} />}
        </section>
      </div>

      <section className="mt-8">
        <h2 className="section-title">Account history</h2>
        <ol className="mt-2 divide-y divide-zinc-200 card text-sm">
          {audit.map((e) => (
            <li key={e.id} data-audit={e.action} className="flex flex-wrap justify-between gap-2 px-3 py-2">
              <span><span className="font-medium">{e.action.toLowerCase().replace(/_/g, " ")}</span>{e.actor ? <span className="text-zinc-500"> · by {e.actor.name}</span> : null}{e.after ? <span className="ml-2 text-xs text-zinc-500">{JSON.stringify(e.after).slice(0, 120)}</span> : null}</span>
              <span className="text-xs text-zinc-500 tabular-nums">{e.createdAt.toISOString().replace("T", " ").slice(0, 16)}</span>
            </li>
          ))}
          {audit.length === 0 && <li className="px-3 py-3 text-zinc-500">No history.</li>}
        </ol>
      </section>
    </>
  );
}

export default function UserPage({ params, searchParams }: PageProps<"/admin/users/[userId]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Content params={params} searchParams={searchParams as Promise<{ invited?: string }>} />
      </Suspense>
    </main>
  );
}
