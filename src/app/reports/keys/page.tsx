import { Suspense } from "react";
import Link from "next/link";
import type { KeyStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth/authorize";
import { REPORT_VIEW_ROLES } from "@/modules/reports/access";
import { DEFINITIONS, filterOptions, keyReport, parseRange, scopeFor } from "@/modules/reports/suite";
import { Definitions, ReportFilters, Stat, qs, table, tbody, td, th, thead, wrap } from "@/modules/reports/components/report-filters";

type Search = Promise<Record<string, string | undefined>>;
const STATUSES: KeyStatus[] = ["AVAILABLE", "ISSUED", "LOST", "DAMAGED", "UNDER_REPAIR", "RETIRED"];
const TX = ["ISSUE", "RETURN", "LOST", "DAMAGED", "REPAIR", "REPLACED", "RETIRE"];

async function Content({ searchParams }: { searchParams: Search }) {
  const user = await requireRole(REPORT_VIEW_ROLES, "/reports/keys");
  const scope = await scopeFor(user);
  const sp = await searchParams;
  const range = parseRange(sp.from, sp.to);
  const status = STATUSES.includes(sp.status as KeyStatus) ? (sp.status as KeyStatus) : null;
  const f = { siteId: sp.siteId || null, buildingId: sp.buildingId || null, status, range };
  const [r, options] = await Promise.all([keyReport(scope, f), filterOptions(scope)]);
  const query = qs({ from: range.from, to: range.to, siteId: f.siteId, buildingId: f.buildingId, status });
  const total = (k: keyof (typeof r.register)[number]) => r.register.reduce((s, x) => s + (typeof x[k] === "number" ? (x[k] as number) : 0), 0);
  return (
    <>
      <ReportFilters action="/reports/keys" range={range} sites={options.sites} values={f} csvHref={`/api/reports/keys.csv?${query}`} statuses={STATUSES.map((s) => [s, s.toLowerCase().replace("_", " ")])} />
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-6">
        <Stat label="Keys" value={total("total")} /><Stat label="Issued" value={total("issued")} /><Stat label="Overdue" value={total("overdue")} /><Stat label="Lost" value={total("lost")} /><Stat label="Damaged / repair" value={total("damaged") + total("underRepair")} /><Stat label="Issued in range" value={r.transactions.ISSUE ?? 0} note={`${r.transactions.RETURN ?? 0} returned`} />
      </dl>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section>
          <h2 className="font-medium">Register by site</h2>
          <div className={wrap}><table className={table}><thead className={thead}><tr><th className={th}>Site</th><th className={`${th} text-right`}>Total</th><th className={`${th} text-right`}>Available</th><th className={`${th} text-right`}>Issued</th><th className={`${th} text-right`}>Overdue</th><th className={`${th} text-right`}>Lost</th><th className={`${th} text-right`}>Damaged</th><th className={`${th} text-right`}>Repair</th><th className={`${th} text-right`}>Retired</th></tr></thead><tbody className={tbody}>
            {r.register.map((x) => <tr key={x.site} data-register={x.site}><td className={td}>{x.site}</td>{[x.total, x.available, x.issued, x.overdue, x.lost, x.damaged, x.underRepair, x.retired].map((v, i) => <td key={i} className={`${td} text-right tabular-nums`}>{v}</td>)}</tr>)}
            {r.register.length === 0 && <tr><td colSpan={9} className="px-3 py-4 text-center text-zinc-500">No keys.</td></tr>}
          </tbody></table></div>
        </section>
        <section>
          <h2 className="font-medium">Transactions in range</h2>
          <div className={wrap}><table className={table}><thead className={thead}><tr><th className={th}>Event</th><th className={`${th} text-right`}>Count</th></tr></thead><tbody className={tbody}>
            {TX.map((t) => <tr key={t}><td className={td}>{t.toLowerCase()}</td><td className={`${td} text-right tabular-nums`}>{r.transactions[t] ?? 0}</td></tr>)}
          </tbody></table></div>
        </section>
      </div>
      <section className="mt-4">
        <h2 className="font-medium">Outstanding keys</h2>
        <div className={wrap}>
          <table className={table}>
            <thead className={thead}><tr><th className={th}>Key</th><th className={th}>Opens</th><th className={th}>Holder</th><th className={th}>Issued</th><th className={th}>Expected return</th></tr></thead>
            <tbody className={tbody}>
              {r.outstanding.map((x) => (
                <tr key={x.keyId} data-outstanding={x.code} data-overdue={x.overdue}>
                  <td className={td}><Link href={`/keys/${x.keyId}`} className="underline">{x.code}</Link>{x.label && <div className="text-xs text-zinc-500">{x.label}</div>}</td>
                  <td className={td}>{x.site} · {x.location}</td><td className={td}>{x.holder}</td>
                  <td className={`${td} text-xs tabular-nums`}>{x.issuedAt.toISOString().slice(0, 10)}</td>
                  <td className={`${td} tabular-nums ${x.overdue ? "font-medium text-red-700" : ""}`}>{x.expectedReturnAt?.toISOString().slice(0, 10) ?? "at check-out"}{x.overdue ? " · overdue" : ""}</td>
                </tr>
              ))}
              {r.outstanding.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">No keys are out.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <Definitions lines={DEFINITIONS.keys} masked={!scope.canSeeNames} />
    </>
  );
}

export default function KeysReportPage({ searchParams }: PageProps<"/reports/keys">) {
  return (
    <main>
      <h1 className="page-title">Keys</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-600">Issued, outstanding, overdue, lost and damaged keys.</p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}><Content searchParams={searchParams as Search} /></Suspense>
    </main>
  );
}
