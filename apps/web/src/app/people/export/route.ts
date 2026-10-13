import type { NextRequest } from "next/server";
import { actorOf, requireCapability } from "@/lib/auth/authorize";
import { listPeople } from "@sam/core/modules/people/service";
import { toCsv } from "@sam/core/modules/reports/service";
import { recordAudit } from "@sam/core/lib/audit";
import { csvDownload } from "@/lib/csv-download";

export async function GET(req: NextRequest) {
  const user = await requireCapability("people.export", { returnTo: "/people" });
  const q = req.nextUrl.searchParams.get("q") || undefined;
  const rows = await listPeople(actorOf(user), { q, take: 5000 });
  const csv = toCsv(["Employee ID", "Name", "Type", "Department", "Phone", "Email", "Verification"], rows.map(({ row, view }) => [row.employeeId, view?.name ?? "", row.profileType, view?.department ?? "", view?.phone ?? "", view?.email ?? "", row.verificationStatus]));
  await recordAudit({ actorId: user.id, action: "EXPORT_PEOPLE", entityType: "StaffProfile", entityId: "directory", after: { rows: rows.length, q: q ?? null } });
  return csvDownload(user, csv, "people.csv");
}
