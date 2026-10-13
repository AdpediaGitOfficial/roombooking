import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDailySweeps } from "@sam/core/modules/jobs/daily";

/** Scheduler entry point for the lifecycle sweeps: POST with `Authorization: Bearer <JOBS_SECRET>`. */
export async function POST(request: Request) {
  const secret = process.env.JOBS_SECRET;
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const ok = !!secret && provided.length === secret.length && timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runDailySweeps());
}
