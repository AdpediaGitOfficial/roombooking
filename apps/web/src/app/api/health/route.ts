import { NextResponse } from "next/server";
import { apiUrl } from "@/lib/api-url";

/** The web app is up when it answers; it is healthy when the API behind it is ready. */
const API_URL = apiUrl();

export async function GET() {
  try {
    const res = await fetch(`${API_URL}/ready`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    const body = (await res.json().catch(() => ({}))) as { database?: string };
    if (res.ok) return NextResponse.json({ status: "ok", api: "up", database: body.database ?? "up" });
    return NextResponse.json({ status: "degraded", api: "unavailable", database: body.database ?? "unknown" }, { status: 503 });
  } catch (error) {
    return NextResponse.json({ status: "degraded", api: "down", error: error instanceof Error ? error.message : "unknown error" }, { status: 503 });
  }
}
