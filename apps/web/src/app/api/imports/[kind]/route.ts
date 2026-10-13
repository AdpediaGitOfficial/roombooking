import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { hasRole } from "@/lib/auth/authorize";
import { recordAudit } from "@sam/core/lib/audit";
import { IMPORT_ROLES, exportAccommodationCsv, exportStaffCsv, templateCsv, type ImportKind } from "@sam/core/modules/imports/service";

/** `/api/imports/staff.csv` exports current data in the import layout; `?template=1` returns an example file instead. */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!hasRole(user, ...IMPORT_ROLES)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const kind = (await params).kind.replace(/\.csv$/, "") as ImportKind;
  if (kind !== "staff" && kind !== "accommodation") return NextResponse.json({ error: "not found" }, { status: 404 });
  const template = new URL(request.url).searchParams.get("template") === "1";
  const csv = template ? templateCsv(kind) : kind === "staff" ? await exportStaffCsv(user.organizationId) : await exportAccommodationCsv(user.organizationId);
  if (!template) await recordAudit({ actorId: user.id, action: "REPORT_EXPORTED", entityType: "Report", entityId: `import-${kind}`, after: { kind } });
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${kind}${template ? "-template" : ""}.csv"`, "Cache-Control": "no-store" } });
}
