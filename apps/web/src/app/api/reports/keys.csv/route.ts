import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { apiFailure, fileResponse } from "@/lib/file-response";
import { getCurrentUser } from "@/lib/auth/session";

type Status = NonNullable<NonNullable<Parameters<typeof api.reports.keysCsv>[0]>["status"]>;

export async function GET(request: Request) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const p = new URL(request.url).searchParams;
  try {
    return fileResponse(await api.reports.keysCsv({ siteId: p.get("siteId") || undefined, buildingId: p.get("buildingId") || undefined, status: (p.get("status") as Status | null) || undefined, from: p.get("from") || undefined, to: p.get("to") || undefined }));
  } catch (error) {
    return apiFailure(error);
  }
}
