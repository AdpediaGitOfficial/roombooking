import { NextResponse, type NextRequest } from "next/server";
import { requireCapability } from "@/lib/auth/authorize";
import { REPORT_BY_SLUG, auditReportView, reportCsv, runReport } from "@sam/core/modules/reports/layers";
import { parseRange, scopeFor } from "@sam/core/modules/reports/suite";
import { csvDownload } from "@/lib/csv-download";

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const def = REPORT_BY_SLUG.get(slug);
  if (!def) return NextResponse.json({ error: "unknown report" }, { status: 404 });
  const user = await requireCapability([def.layer === "L3" ? "rep.l3" : "rep.l2"], { returnTo: `/reports/${slug}`, level: "access" });
  await requireCapability("rep.export", { returnTo: `/reports/${slug}` });
  const range = parseRange(req.nextUrl.searchParams.get("from"), req.nextUrl.searchParams.get("to"));
  const scope = await scopeFor(user);
  const report = await runReport(slug, { siteIds: scope.siteIds, names: scope.canSeeNames }, { from: new Date(`${range.from}T00:00:00.000Z`), to: new Date(new Date(`${range.to}T00:00:00.000Z`).getTime() + 86400000) });
  await auditReportView(user.id, slug, "EXPORTED");
  return csvDownload(user, reportCsv(report!), `${slug}.csv`);
}
