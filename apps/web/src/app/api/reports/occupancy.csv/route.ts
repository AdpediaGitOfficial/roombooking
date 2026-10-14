import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { apiFailure, fileResponse } from "@/lib/file-response";
import { getCurrentUser } from "@/lib/auth/session";

export async function GET(request: Request) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    return fileResponse(await api.reports.occupancyCsv({ siteId: new URL(request.url).searchParams.get("siteId") || undefined }));
  } catch (error) {
    return apiFailure(error);
  }
}
