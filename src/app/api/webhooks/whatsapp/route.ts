import { NextResponse } from "next/server";
import { parseStatusWebhook, verifyWebhookSignature } from "@/modules/notifications/whatsapp";
import { applyStatusUpdates } from "@/modules/notifications/worker";

/** Meta webhook verification handshake: echoes hub.challenge when the verify token matches. */
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (p.get("hub.mode") === "subscribe" && token && p.get("hub.verify_token") === token) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "verification failed" }, { status: 403 });
}

/** Delivery status receipts (COM-04). The body is authenticated with X-Hub-Signature-256 over the raw payload. */
export async function POST(request: Request) {
  const raw = await request.text();
  const secret = process.env.WHATSAPP_APP_SECRET ?? "";
  if (!verifyWebhookSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const result = await applyStatusUpdates(parseStatusWebhook(body));
  return NextResponse.json(result);
}
