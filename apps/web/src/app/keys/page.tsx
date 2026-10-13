import { Suspense } from "react";
import Link from "next/link";
import { requireRole, userCan } from "@/lib/auth/authorize";
import { sitesFor } from "@/lib/auth/scope";
import { KEY_VIEW_ROLES } from "@sam/core/modules/keys/access";
import { keyLocation, keySummary, listKeys, type KeyFilter } from "@sam/core/modules/keys/service";
import { registerOptions } from "@/modules/keys/context";
import { HolderCell, KeyStatusBadge } from "@/modules/keys/components/views";
import { RegisterKeyForm } from "@/modules/keys/components/forms";
import { KeyTabs } from "@/modules/keys/components/tabs";
import { PageHeader } from "@/components/shell/page-header";

const FILTERS: Array<[KeyFilter, string]> = [["all", "All"], ["available", "Available"], ["issued", "Issued"], ["overdue", "Overdue"], ["exceptions", "Lost / damaged / repair"], ["retired", "Retired"]];

async function Register({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireRole(KEY_VIEW_ROLES, "/keys");
  const canManage = userCan(user, "keys.register");
  const { filter: raw } = await searchParams;
  const filter = (FILTERS.some(([f]) => f === raw) ? raw : "all") as KeyFilter;
  const now = new Date();
  const scope = await sitesFor(user, ["keys.standard", "keys.register"]);
  const [rows, summary, options] = await Promise.all([listKeys(filter, scope, now), keySummary(scope, now), canManage ? registerOptions() : null]);
  return (
    <>
      <KeyTabs user={user} active="register" />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[["Keys", summary.total], ["Available", summary.available], ["Issued", summary.issued], ["Overdue", summary.overdue], ["Exceptions", summary.exceptions]].map(([label, value]) => (
          <div key={label} className="kpi"><dt className="kpi-label">{label}</dt><dd data-summary={label} className="kpi-value">{value}</dd></div>
        ))}
      </dl>
      <nav className="mt-4 flex flex-wrap gap-2 text-sm">
        {FILTERS.map(([f, label]) => <Link key={f} href={`/keys?filter=${f}`} className={`pill ${f === filter ? "pill-on" : ""}`}>{label}</Link>)}
      </nav>
      <div className="mt-4 overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr><th className="px-3 py-2">Key</th><th className="px-3 py-2">Opens</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Held by</th></tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {rows.map(({ key, issue }) => (
              <tr key={key.id} data-key={key.code}>
                <td className="px-3 py-3"><Link href={`/keys/${key.id}`} className="font-medium underline">{key.code}</Link>{key.label && <div className="text-xs text-zinc-500">{key.label}</div>}</td>
                <td className="px-3 py-3 text-xs">{keyLocation(key)}</td>
                <td className="px-3 py-3"><KeyStatusBadge status={key.status} /></td>
                <td className="px-3 py-3"><HolderCell issue={issue} now={now} /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-zinc-500">No keys match.</td></tr>}
          </tbody>
        </table>
      </div>
      {options && <div className="mt-6"><RegisterKeyForm sites={options.sites} rooms={options.rooms} facilities={options.facilities} /></div>}
    </>
  );
}

export default function KeysPage({ searchParams }: PageProps<"/keys">) {
  return (
    <main>
      <PageHeader title="Keys" subtitle="Register, issue and return, outstanding keys and exceptions." crumbs={[["Keys"]]} />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Register searchParams={searchParams as Promise<{ filter?: string }>} />
      </Suspense>
    </main>
  );
}
