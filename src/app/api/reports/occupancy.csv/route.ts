import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { hasRole } from "@/lib/auth/authorize";
import { REPORT_VIEW_ROLES } from "@/modules/reports/access";
import { occupancyCsv } from "@/modules/reports/service";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasRole(user, ...REPORT_VIEW_ROLES)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const siteId = new URL(request.url).searchParams.get("siteId");
  const csv = await occupancyCsv(siteId || null, user.id);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="occupancy-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
