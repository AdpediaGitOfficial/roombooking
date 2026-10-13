import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/authorize";
import { buildDataExport } from "@sam/core/modules/privacy/service";

/** A resident's own data as a JSON download (the right to see your data). */
export async function GET() {
  const user = await requireUser("/my/privacy");
  const data = await buildDataExport(user.id);
  return new NextResponse(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="my-data.json"`, "Cache-Control": "no-store" } });
}
