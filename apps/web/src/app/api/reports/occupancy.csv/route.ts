import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { userCan } from "@/lib/auth/authorize";
import { sitesFor } from "@/lib/auth/scope";
import { csvDownload } from "@/lib/csv-download";
import { occupancyCsv } from "@sam/core/modules/reports/service";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!userCan(user, "rep.export")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const siteId = new URL(request.url).searchParams.get("siteId");
  const csv = await occupancyCsv(await sitesFor(user, ["rep.l1", "rep.l2", "rep.l3", "rep.l4"], siteId || null), user.id);
  return csvDownload(user, csv, `occupancy-${new Date().toISOString().slice(0, 10)}.csv`);
}
