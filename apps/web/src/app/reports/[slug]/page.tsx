import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser, userAccess, userCan } from "@/lib/auth/authorize";
import { REPORT_BY_SLUG, auditReportView, runReport } from "@sam/core/modules/reports/layers";
import { parseRange, scopeFor } from "@sam/core/modules/reports/suite";
import { PageHeader } from "@/components/shell/page-header";

type Search = Promise<Record<string, string | undefined>>;

async function Content({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Search }) {
  const { slug } = await params;
  const def = REPORT_BY_SLUG.get(slug);
  if (!def) notFound();
  const user = await requireUser(`/reports/${slug}`);
  const cap = def.layer === "L3" ? "rep.l3" : "rep.l2";
  if (!userAccess(user, cap)) redirect("/forbidden");
  const sp = await searchParams;
  const range = parseRange(sp.from, sp.to);
  const scope = await scopeFor(user);
  const report = await runReport(slug, { siteIds: scope.siteIds, names: scope.canSeeNames }, { from: new Date(`${range.from}T00:00:00.000Z`), to: new Date(new Date(`${range.to}T00:00:00.000Z`).getTime() + 86400000) });
  if (!report) notFound();
  await auditReportView(user.id, slug, "VIEWED");
  const canExport = userCan(user, "rep.export");
  return (
    <>
      <form method="get" className="toolbar flex flex-wrap items-end gap-3">
        <label className="text-sm">From<input type="date" name="from" defaultValue={range.from} className="mt-1 block rounded-md border border-zinc-300 px-2 py-1.5 text-sm" /></label>
        <label className="text-sm">To<input type="date" name="to" defaultValue={range.to} className="mt-1 block rounded-md border border-zinc-300 px-2 py-1.5 text-sm" /></label>
        <button className="btn btn-small" type="submit">Apply</button>
        {canExport && <a className="btn btn-small ml-auto" href={`/api/reports/layer/${slug}?from=${range.from}&to=${range.to}`}>Export CSV</a>}
      </form>
      <p className="mt-2 text-xs text-zinc-500">As of {report.asOf.toISOString().slice(0, 16).replace("T", " ")} UTC · {report.live ? "live figures (the period filter does not apply)" : `period ${range.from} to ${range.to}`} · {scope.canSeeNames ? "names shown" : "counts only, names hidden"}</p>
      <div className="mt-3 overflow-x-auto card">
        <table className="table">
          <thead><tr>{report.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {report.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j} className={typeof c === "number" ? "tabular-nums" : ""}>{c ?? "—"}</td>)}</tr>)}
            {report.rows.length === 0 && <tr><td colSpan={report.columns.length} className="py-6 text-center text-sm text-zinc-500">Nothing to show for this period.</td></tr>}
          </tbody>
        </table>
      </div>
      {report.note && <p className="mt-2 text-xs text-zinc-500">{report.note}</p>}
    </>
  );
}

export default function LayerReportPage({ params, searchParams }: PageProps<"/reports/[slug]">) {
  return (
    <main>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Title params={params} />
        <Content params={params} searchParams={searchParams as Search} />
      </Suspense>
    </main>
  );
}

async function Title({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const def = REPORT_BY_SLUG.get(slug);
  if (!def) return null;
  return <PageHeader title={def.title} subtitle={`${def.layer} · ${def.module}. ${def.description}`} crumbs={[["Reports", "/reports"], [def.title]]} actions={<Link href="/reports" className="btn btn-small">All reports</Link>} />;
}
