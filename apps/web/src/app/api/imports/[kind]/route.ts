import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { userCan } from "@/lib/auth/authorize";
import { csvDownload } from "@/lib/csv-download";
import { recordAudit } from "@sam/core/lib/audit";
import { exportAccommodationCsv, exportStaffCsv, templateCsv, type ImportKind } from "@sam/core/modules/imports/service";

/** `/api/imports/staff.csv` exports current data in the import layout; `?template=1` returns an example file instead. */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const kind = (await params).kind.replace(/\.csv$/, "") as ImportKind;
  if (kind !== "staff" && kind !== "accommodation") return NextResponse.json({ error: "not found" }, { status: 404 });
  // Staff data needs the HR set (people.export); the structure export needs structure rights.
  const allowed = kind === "staff" ? userCan(user, "people.export") || userCan(user, "people.import") : userCan(user, "setup.structure_bulk") || userCan(user, "setup.structure");
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const template = new URL(request.url).searchParams.get("template") === "1";
  const csv = template ? templateCsv(kind) : kind === "staff" ? await exportStaffCsv(user.organizationId) : await exportAccommodationCsv(user.organizationId);
  if (!template) await recordAudit({ actorId: user.id, action: "REPORT_EXPORTED", entityType: "Report", entityId: `import-${kind}`, after: { kind } });
  if (template) return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${kind}-template.csv"`, "Cache-Control": "no-store" } });
  return csvDownload(user, csv, `${kind}.csv`);
}
