import { NextResponse } from "next/server";
import type { KeyStatus } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { hasRole } from "@/lib/auth/authorize";
import { REPORT_VIEW_ROLES } from "@/modules/reports/access";
import { keyCsv, parseRange, scopeFor } from "@/modules/reports/suite";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasRole(user, ...REPORT_VIEW_ROLES)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const p = new URL(request.url).searchParams;
  const scope = await scopeFor(user);
  const csv = await keyCsv(scope, { siteId: p.get("siteId") || null, buildingId: p.get("buildingId") || null, status: (p.get("status") as KeyStatus | null) || null, range: parseRange(p.get("from"), p.get("to")) }, user.id);
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="keys-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
