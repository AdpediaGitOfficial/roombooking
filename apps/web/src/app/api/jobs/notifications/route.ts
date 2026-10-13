import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processOutbox } from "@sam/core/modules/notifications/worker";
import { sweepBookings } from "@sam/core/modules/facilities/service";
import { sweepRequests } from "@sam/core/modules/requests/service";

/** Scheduler entry point: POST with `Authorization: Bearer <JOBS_SECRET>`. */
export async function POST(request: Request) {
  const secret = process.env.JOBS_SECRET;
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const ok = !!secret && provided.length === secret.length && timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await processOutbox({ limit: Number(new URL(request.url).searchParams.get("limit") ?? 50) });
  const bookings = await sweepBookings();
  const requests = await sweepRequests();
  return NextResponse.json({ ...result, bookings, requests });
}
