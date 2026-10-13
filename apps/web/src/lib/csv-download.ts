import "server-only";
import { NextResponse } from "next/server";
import { watermarkCsv } from "@sam/core/modules/reports/service";
import type { CurrentUser } from "@/lib/auth/authorize";

/** A watermarked CSV download; the caller has already checked the export capability. */
export function csvDownload(user: CurrentUser, csv: string, filename: string) {
  return new NextResponse(watermarkCsv(csv, { name: user.name, username: user.username }), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}
