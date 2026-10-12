import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/authorize";
import { isResidentOnly } from "@/modules/self-service/context";
import { logout } from "./login/actions";

const modules: Array<[string, string, string?]> = [
  ["Accommodation", "Sites, buildings, rooms, beds, allocations, check-in/out", "/accommodation"],
  ["Staff self-service", "My stay, profile, requests", "/my"],
  ["Maintenance", "Work orders, assignment, contractor access"],
  ["Forms & approvals", "Room change, visitor, family, exit clearance"],
  ["Facility booking", "Shared facilities and calendars"],
  ["Keys", "Issue, return, lost and damaged keys"],
  ["Inventory", "Stock and serialised assets"],
  ["Lost & found", "Items, claims and handover"],
  ["Notifications", "In-app, email and WhatsApp"],
  ["Reports", "Occupancy, movements, maintenance, utilisation"],
  ["Administration", "Users, roles, audit, configuration"],
];

async function UserBar() {
  const user = await requireUser("/");
  // Residents without operational roles get the mobile self-service portal.
  if (isResidentOnly(user)) redirect("/my");
  const roles = user.roleAssignments.map((r) => r.role.replaceAll("_", " ").toLowerCase());
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div>
        <div className="font-medium">{user.name}</div>
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          {user.email}
          {roles.length > 0 && <> · {roles.join(", ")}</>}
        </div>
      </div>
      <form action={logout}>
        <button type="submit" className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
          Sign out
        </button>
      </form>
    </div>
  );
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Staff Accommodation Management</h1>
      <div className="mt-6">
        <Suspense fallback={<div className="h-16 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />}>
          <UserBar />
        </Suspense>
      </div>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {modules.map(([name, desc, href]) => (
          <li key={name} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="font-medium">{href ? <Link href={href} className="underline">{name}</Link> : name}</div>
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{desc}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}
