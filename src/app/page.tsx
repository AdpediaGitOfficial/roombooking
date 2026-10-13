import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/authorize";
import { isResidentOnly } from "@/modules/self-service/context";
import { AppShell } from "@/components/shell/app-shell";
import { visibleGroups } from "@/components/shell/nav";

async function Modules() {
  const user = await requireUser("/");
  // Residents without operational roles get the mobile self-service portal.
  if (isResidentOnly(user)) redirect("/my");
  const groups = visibleGroups(user.roleAssignments.map((r) => r.role));
  const firstName = user.name.split(" ")[0];
  return (
    <>
      <h1 className="page-title">Hello, {firstName}</h1>
      <p className="mt-1 text-sm text-zinc-500">Everything you have access to, in one place.</p>
      {groups.map((g) => (
        <section key={g.label} className="mt-8">
          <h2 className="section-title">{g.label}</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((i) => (
              <li key={i.href}>
                <Link href={i.href} className="card block p-4 hover:bg-zinc-50">
                  <div className="flex items-center gap-3">
                    <span className="brand-mark" aria-hidden="true">{i.icon}</span>
                    <span className="font-semibold">{i.label}</span>
                  </div>
                  <div className="mt-2 text-sm text-zinc-500">{i.description}</div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export default function Home() {
  return (
    <AppShell returnTo="/">
      <Suspense fallback={<div className="h-16 animate-pulse rounded-lg bg-zinc-100" />}>
        <Modules />
      </Suspense>
    </AppShell>
  );
}
