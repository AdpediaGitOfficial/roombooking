import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { userCan } from "@/lib/auth/authorize";
import { csvDownload } from "@/lib/csv-download";
import { facilityCsv, parseRange, scopeFor } from "@sam/core/modules/reports/suite";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!userCan(user, "rep.export")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const p = new URL(request.url).searchParams;
  const scope = await scopeFor(user);
  const csv = await facilityCsv(scope, { siteId: p.get("siteId") || null, facilityId: p.get("facilityId") || null, range: parseRange(p.get("from"), p.get("to")) }, user.id);
  return csvDownload(user, csv, `facilities-${new Date().toISOString().slice(0, 10)}.csv`);
}
