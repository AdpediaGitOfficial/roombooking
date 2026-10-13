import { NextResponse } from "next/server";
import { IntegrationError, syncHrms, verifyApiKey, type HrmsRecord } from "@sam/core/modules/integrations/service";

/** HRMS push: POST { records: [...] } with a bearer API key holding the hrms.sync scope. */
export async function POST(request: Request) {
  try {
    const key = await verifyApiKey((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""), "hrms.sync");
    const body = (await request.json().catch(() => null)) as { records?: HrmsRecord[] } | null;
    if (!body || !Array.isArray(body.records)) return NextResponse.json({ error: "Send { \"records\": [...] }" }, { status: 400 });
    const result = await syncHrms(key.organizationId, body.records, { actorId: key.createdById, trigger: "api" });
    return NextResponse.json({ runId: result.runId, created: result.created, updated: result.updated, rehired: result.rehired, joiners: result.joiners, exits: result.exits, failed: result.failed, errors: result.errors.slice(0, 20) });
  } catch (e) {
    if (e instanceof IntegrationError) return NextResponse.json({ error: e.message }, { status: e.code === "UNAUTHORIZED" ? 401 : e.code === "FORBIDDEN" ? 403 : 400 });
    throw e;
  }
}
