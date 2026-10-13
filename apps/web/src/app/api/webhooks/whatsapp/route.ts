import { NextResponse } from "next/server";

// The provider's webhook lands here when it is pointed at the web address. The API owns the
// logic (signature check, status updates); this only relays the raw request. In production
// the reverse proxy can route /api/webhooks/whatsapp straight to the API's /webhooks/whatsapp.
const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

async function relay(upstream: Response) {
  return new NextResponse(await upstream.text(), { status: upstream.status, headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" } });
}

export async function GET(request: Request) {
  return relay(await fetch(`${API_URL}/webhooks/whatsapp${new URL(request.url).search}`, { cache: "no-store" }));
}

export async function POST(request: Request) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const signature = request.headers.get("x-hub-signature-256");
  if (signature) headers["x-hub-signature-256"] = signature;
  return relay(await fetch(`${API_URL}/webhooks/whatsapp`, { method: "POST", headers, body: await request.text(), cache: "no-store" }));
}
