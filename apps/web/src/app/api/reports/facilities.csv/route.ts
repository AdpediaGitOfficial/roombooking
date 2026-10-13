import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { apiFailure, fileResponse } from "@/lib/file-response";
import { getCurrentUser } from "@/lib/auth/session";

export async function GET(request: Request) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const p = new URL(request.url).searchParams;
  try {
    return fileResponse(await api.reports.facilitiesCsv({ siteId: p.get("siteId") || undefined, facilityId: p.get("facilityId") || undefined, from: p.get("from") || undefined, to: p.get("to") || undefined }));
  } catch (error) {
    return apiFailure(error);
  }
}
