import { NextResponse } from "next/server";
import type { WorkOrderStatus } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { userCan } from "@/lib/auth/authorize";
import { csvDownload } from "@/lib/csv-download";
import { maintenanceCsv, parseRange, scopeFor } from "@sam/core/modules/reports/suite";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!userCan(user, "rep.export")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const p = new URL(request.url).searchParams;
  const scope = await scopeFor(user);
  const csv = await maintenanceCsv(scope, { siteId: p.get("siteId") || null, buildingId: p.get("buildingId") || null, category: p.get("category") || null, status: (p.get("status") as WorkOrderStatus | null) || null, range: parseRange(p.get("from"), p.get("to")) }, user.id);
  return csvDownload(user, csv, `maintenance-${new Date().toISOString().slice(0, 10)}.csv`);
}
