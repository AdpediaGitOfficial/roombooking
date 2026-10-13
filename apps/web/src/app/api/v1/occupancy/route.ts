import { NextResponse } from "next/server";
import { IntegrationError, verifyApiKey } from "@sam/core/modules/integrations/service";
import { computeKpis } from "@sam/core/modules/kpi/service";

/** Read-only occupancy figures for other systems: GET with a bearer API key holding the occupancy.read scope. */
export async function GET(request: Request) {
  try {
    const key = await verifyApiKey((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""), "occupancy.read");
    const { values, asOf } = await computeKpis(key.organizationId, { siteIds: null }, { keys: ["occupancy_pct", "beds_available", "arrivals", "departures", "overstays"] });
    return NextResponse.json({ asOf, kpis: Object.fromEntries(values.map((v) => [v.key, v.value])) });
  } catch (e) {
    if (e instanceof IntegrationError) return NextResponse.json({ error: e.message }, { status: e.code === "UNAUTHORIZED" ? 401 : 403 });
    throw e;
  }
}
