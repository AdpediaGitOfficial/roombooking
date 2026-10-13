import { NextResponse } from "next/server";
import { actorOf, requireCapability } from "@/lib/auth/authorize";
import { ChargeError, exportCharges } from "@sam/core/modules/charges/service";
import { csvDownload } from "@/lib/csv-download";

export async function POST(request: Request) {
  const user = await requireCapability("charges.approve", { returnTo: "/charges/export" });
  const form = await request.formData();
  try {
    const { batch, csv } = await exportCharges(actorOf(user), user.organizationId, String(form.get("period") ?? ""));
    return csvDownload(user, csv, `charges-${batch.period}.csv`);
  } catch (e) {
    if (e instanceof ChargeError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
