import { NextResponse } from "next/server";

// Scheduler entry point kept at its original address: relays to the API, which checks the secret.
const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

export async function POST(request: Request) {
  const limit = new URL(request.url).searchParams.get("limit");
  const upstream = await fetch(`${API_URL}/jobs/run${limit ? `?limit=${encodeURIComponent(limit)}` : ""}`, {
    method: "POST",
    headers: { authorization: request.headers.get("authorization") ?? "" },
    cache: "no-store",
  });
  return new NextResponse(await upstream.text(), { status: upstream.status, headers: { "Content-Type": "application/json" } });
}
