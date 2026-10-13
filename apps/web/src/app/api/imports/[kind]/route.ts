import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { apiFailure, fileResponse } from "@/lib/file-response";
import { getCurrentUser } from "@/lib/auth/session";

/** `/api/imports/staff.csv` exports current data in the import layout; `?template=1` returns an example file instead. */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const kind = (await params).kind.replace(/\.csv$/, "");
  if (kind !== "staff" && kind !== "accommodation") return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    return fileResponse(await api.imports.export({ kind, template: new URL(request.url).searchParams.get("template") === "1" }));
  } catch (error) {
    return apiFailure(error);
  }
}
