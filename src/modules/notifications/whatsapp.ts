// WhatsApp transport (COM-02, COM-04): Meta WhatsApp Business Platform (Cloud
// API) template messages, a log transport for development, or disabled.
// Only pre-approved templates can be sent, which is what the provider policy
// requires for business-initiated messages.
import { createHmac, timingSafeEqual } from "node:crypto";

export type OutgoingWhatsApp = { to: string; template: string; language: string; parameters: string[]; text: string };
export type SendResult = { messageId: string };

/** A send failure; `permanent` means retrying cannot help (bad number, unknown template, no consent). */
export class WhatsAppError extends Error {
  constructor(message: string, public readonly permanent: boolean, public readonly code?: number) {
    super(message);
    this.name = "WhatsAppError";
  }
}

export interface WhatsAppTransport {
  readonly name: string;
  readonly description: string;
  send(message: OutgoingWhatsApp): Promise<SendResult>;
}

export class LogWhatsAppTransport implements WhatsAppTransport {
  readonly name = "log";
  readonly description = "Log transport: WhatsApp messages are recorded as sent without leaving the server (development).";
  readonly sent: OutgoingWhatsApp[] = [];
  async send(message: OutgoingWhatsApp): Promise<SendResult> {
    this.sent.push(message);
    if (process.env.NODE_ENV !== "test") console.info(`[whatsapp:log] to=${message.to} template=${message.template} text="${message.text}"`);
    return { messageId: `wamid.log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` };
  }
}

export class DisabledWhatsAppTransport implements WhatsAppTransport {
  readonly name = "disabled";
  readonly description = "WhatsApp delivery is disabled: queued messages wait until a transport is configured.";
  async send(): Promise<SendResult> {
    throw new WhatsAppError("WhatsApp transport is disabled", false);
  }
}

/** Provider error codes that will not succeed on retry (see Meta Cloud API error reference). */
const PERMANENT_CODES = new Set([100, 131008, 131009, 131021, 131026, 131031, 131047, 131051, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 133010]);

export type MetaCloudConfig = { accessToken: string; phoneNumberId: string; apiVersion?: string; baseUrl?: string; fetchImpl?: typeof fetch };

export class MetaCloudTransport implements WhatsAppTransport {
  readonly name = "meta";
  readonly description: string;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly config: MetaCloudConfig) {
    this.description = `WhatsApp Business Platform (Cloud API ${config.apiVersion ?? "v21.0"}) from phone number id ${config.phoneNumberId}`;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }
  async send(message: OutgoingWhatsApp): Promise<SendResult> {
    const url = `${(this.config.baseUrl ?? "https://graph.facebook.com").replace(/\/$/, "")}/${this.config.apiVersion ?? "v21.0"}/${this.config.phoneNumberId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      to: message.to,
      type: "template",
      template: {
        name: message.template,
        language: { code: message.language },
        components: message.parameters.length ? [{ type: "body", parameters: message.parameters.map((text) => ({ type: "text", text })) }] : [],
      },
    };
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: "POST", headers: { Authorization: `Bearer ${this.config.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    } catch (e) {
      throw new WhatsAppError(`WhatsApp API unreachable: ${e instanceof Error ? e.message : String(e)}`, false);
    }
    const json = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } } };
    if (!res.ok || !json.messages?.[0]?.id) {
      const err = json.error;
      const code = err?.code;
      const detail = err?.error_data?.details ? ` (${err.error_data.details})` : "";
      const permanent = res.status === 400 || res.status === 401 || res.status === 403 || (code !== undefined && PERMANENT_CODES.has(code));
      throw new WhatsAppError(`WhatsApp API ${res.status}${code !== undefined ? ` code ${code}` : ""}: ${err?.message ?? "unexpected response"}${detail}`, permanent && res.status !== 429 && res.status < 500, code);
    }
    return { messageId: json.messages[0].id };
  }
}

/** WHATSAPP_TRANSPORT=meta|log|disabled; defaults to meta when WHATSAPP_ACCESS_TOKEN is set, else disabled. */
export function whatsappTransportFromEnv(env: NodeJS.ProcessEnv = process.env): WhatsAppTransport {
  const mode = env.WHATSAPP_TRANSPORT ?? (env.WHATSAPP_ACCESS_TOKEN ? "meta" : "disabled");
  if (mode === "log") return new LogWhatsAppTransport();
  if (mode === "meta") {
    if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) throw new Error("WHATSAPP_TRANSPORT=meta requires WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID");
    return new MetaCloudTransport({ accessToken: env.WHATSAPP_ACCESS_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, apiVersion: env.WHATSAPP_API_VERSION || undefined, baseUrl: env.WHATSAPP_API_BASE_URL || undefined });
  }
  return new DisabledWhatsAppTransport();
}

/** Normalises a phone number to E.164 ("+971501234567"); null when it cannot be a valid international number. */
export function normalisePhone(raw: string | null | undefined, defaultCountryCode = process.env.DEFAULT_COUNTRY_CODE ?? ""): string | null {
  if (!raw) return null;
  let s = raw.replace(/[\s().-]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (!s.startsWith("+")) {
    if (s.startsWith("0") && defaultCountryCode) s = `+${defaultCountryCode.replace(/^\+/, "")}${s.slice(1)}`;
    else if (defaultCountryCode && /^\d+$/.test(s)) s = `+${defaultCountryCode.replace(/^\+/, "")}${s}`;
    else return null;
  }
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

/** Cloud API wants digits only (no "+"). */
export function toWaId(e164: string): string {
  return e164.replace(/^\+/, "");
}

// ---------------------------------------------------------------------------
// Delivery status webhooks (COM-04)
// ---------------------------------------------------------------------------

/** Verifies Meta's X-Hub-Signature-256 header over the raw request body. */
export function verifyWebhookSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type StatusUpdate = { messageId: string; status: "sent" | "delivered" | "read" | "failed"; timestamp: Date; error?: string | null };

/** Pulls message status updates out of a Cloud API webhook payload; other notifications (inbound messages) are ignored. */
export function parseStatusWebhook(body: unknown): StatusUpdate[] {
  const out: StatusUpdate[] = [];
  const entries = (body as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes ?? [];
    for (const change of changes) {
      const statuses = (change as { value?: { statuses?: unknown[] } })?.value?.statuses ?? [];
      for (const s of statuses) {
        const st = s as { id?: string; status?: string; timestamp?: string; errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }> };
        if (!st.id || !["sent", "delivered", "read", "failed"].includes(st.status ?? "")) continue;
        const err = st.errors?.[0];
        out.push({ messageId: st.id, status: st.status as StatusUpdate["status"], timestamp: st.timestamp ? new Date(Number(st.timestamp) * 1000) : new Date(), error: err ? `${err.code !== undefined ? `code ${err.code}: ` : ""}${err.message ?? err.title ?? "delivery failed"}${err.error_data?.details ? ` (${err.error_data.details})` : ""}` : null });
      }
    }
  }
  return out;
}
