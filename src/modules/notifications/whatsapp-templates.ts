// WhatsApp template mapping (COM-05). Each outbox event maps to a pre-approved
// template name and its body parameters. Parameters never carry sensitive
// details (no room or bed codes, no reasons, no links with tokens): the
// message says what happened and points the person to the portal.
import type { OutgoingWhatsApp } from "./whatsapp";

type Payload = Record<string, unknown>;
const str = (p: Payload, key: string, fallback = ""): string => { const v = p[key]; return v === null || v === undefined || v === "" ? fallback : String(v); };

/** Body text as approved with the provider, with {{n}} placeholders; used for the preview and the log transport. */
type WaTemplate = { name: string; body: string; params: (p: Payload, firstName: string) => string[] };

const T: Record<string, WaTemplate> = {
  "allocation.confirmed": { name: "allocation_confirmed", body: "Hello {{1}}, your accommodation allocation starting {{2}} is confirmed. Open the staff portal for your room details and check-in instructions.", params: (p, n) => [n, str(p, "startDate")] },
  "allocation.checked_out": { name: "allocation_checked_out", body: "Hello {{1}}, your check-out on {{2}} has been recorded. Thank you for staying with us.", params: (p, n) => [n, str(p, "endDate")] },
  "allocation.cancelled": { name: "allocation_cancelled", body: "Hello {{1}}, your accommodation allocation has been cancelled. Please contact the accommodation office or check the staff portal.", params: (_p, n) => [n] },
  "request.approved": { name: "request_decided", body: "Hello {{1}}, your {{2}} has been {{3}}. Open the staff portal for details.", params: (p, n) => [n, str(p, "type", "request").toLowerCase(), "approved"] },
  "request.rejected": { name: "request_decided", body: "Hello {{1}}, your {{2}} has been {{3}}. Open the staff portal for details.", params: (p, n) => [n, str(p, "type", "request").toLowerCase(), "declined"] },
  "request.changes_requested": { name: "request_decided", body: "Hello {{1}}, your {{2}} has been {{3}}. Open the staff portal for details.", params: (p, n) => [n, str(p, "type", "request").toLowerCase(), "returned for changes"] },
  "maintenance.received": { name: "maintenance_update", body: "Hello {{1}}, maintenance ticket {{2}} {{3}}. Track it in the staff portal.", params: (p, n) => [n, str(p, "ticketNumber"), "has been logged"] },
  "maintenance.assigned": { name: "maintenance_update", body: "Hello {{1}}, maintenance ticket {{2}} {{3}}. Track it in the staff portal.", params: (p, n) => [n, str(p, "ticketNumber"), "has been assigned to the team"] },
  "maintenance.assigned_to_you": { name: "maintenance_update", body: "Hello {{1}}, maintenance ticket {{2}} {{3}}. Track it in the staff portal.", params: (p, n) => [n, str(p, "ticketNumber"), "has been assigned to you"] },
  "maintenance.waiting_on_you": { name: "maintenance_update", body: "Hello {{1}}, maintenance ticket {{2}} {{3}}. Track it in the staff portal.", params: (p, n) => [n, str(p, "ticketNumber"), "needs a reply from you"] },
  "maintenance.resolved": { name: "maintenance_update", body: "Hello {{1}}, maintenance ticket {{2}} {{3}}. Track it in the staff portal.", params: (p, n) => [n, str(p, "ticketNumber"), "has been marked resolved; please confirm or reopen"] },
  "maintenance.closed": { name: "maintenance_update", body: "Hello {{1}}, maintenance ticket {{2}} {{3}}. Track it in the staff portal.", params: (p, n) => [n, str(p, "ticketNumber"), "is now closed"] },
  "maintenance.cancelled": { name: "maintenance_update", body: "Hello {{1}}, maintenance ticket {{2}} {{3}}. Track it in the staff portal.", params: (p, n) => [n, str(p, "ticketNumber"), "was cancelled"] },
  "key.issued": { name: "key_update", body: "Hello {{1}}, a room key has been {{2}}. See the details in the staff portal.", params: (_p, n) => [n, "issued to you"] },
  "key.returned": { name: "key_update", body: "Hello {{1}}, a room key has been {{2}}. See the details in the staff portal.", params: (_p, n) => [n, "recorded as returned"] },
  "booking.confirmed": { name: "booking_update", body: "Hello {{1}}, your booking of {{2}} on {{3}} at {{4}} is {{5}}.", params: (p, n) => [n, str(p, "facility"), str(p, "date"), str(p, "startTime"), "confirmed"] },
  "booking.pending": { name: "booking_update", body: "Hello {{1}}, your booking of {{2}} on {{3}} at {{4}} is {{5}}.", params: (p, n) => [n, str(p, "facility"), str(p, "date"), str(p, "startTime"), "awaiting approval"] },
  "booking.rejected": { name: "booking_update", body: "Hello {{1}}, your booking of {{2}} on {{3}} at {{4}} is {{5}}.", params: (p, n) => [n, str(p, "facility"), str(p, "date"), str(p, "startTime"), "declined"] },
  "booking.cancelled": { name: "booking_update", body: "Hello {{1}}, your booking of {{2}} on {{3}} at {{4}} is {{5}}.", params: (p, n) => [n, str(p, "facility"), str(p, "date"), str(p, "startTime"), "cancelled"] },
  "lostfound.claim_verified": { name: "lostfound_update", body: "Hello {{1}}, your lost and found claim {{2}} {{3}}. Open the staff portal for details.", params: (p, n) => [n, str(p, "reference"), "has been verified; collect the item from the accommodation office with your ID"] },
  "lostfound.claim_rejected": { name: "lostfound_update", body: "Hello {{1}}, your lost and found claim {{2}} {{3}}. Open the staff portal for details.", params: (p, n) => [n, str(p, "reference"), "could not be verified"] },
  "lostfound.returned": { name: "lostfound_update", body: "Hello {{1}}, your lost and found claim {{2}} {{3}}. Open the staff portal for details.", params: (p, n) => [n, str(p, "reference"), "is complete: the item has been handed over"] },
  "broadcast": { name: "announcement", body: "Hello {{1}}, there is a new announcement from the accommodation office: {{2}}. Open the staff portal to read it.", params: (p, n) => [n, str(p, "title", "announcement")] },
  "delegation.started": { name: "delegation_update", body: "Hello {{1}}, approval cover: {{2}}. Open the staff portal for details.", params: (p, n) => [n, `you are covering for ${str(p, "delegator")} from ${str(p, "startsAt")} to ${str(p, "endsAt")}`] },
  "delegation.arranged": { name: "delegation_update", body: "Hello {{1}}, approval cover: {{2}}. Open the staff portal for details.", params: (p, n) => [n, `${str(p, "delegate")} will cover your approvals from ${str(p, "startsAt")} to ${str(p, "endsAt")}`] },
  "delegation.ended": { name: "delegation_update", body: "Hello {{1}}, approval cover: {{2}}. Open the staff portal for details.", params: (p, n) => [n, `your cover for ${str(p, "delegator")} has ended`] },
  "test.whatsapp": { name: "test_message", body: "Hello {{1}}, this is a test message from Staff Accommodation Management. No action is needed.", params: (_p, n) => [n] },
};
const GENERIC: WaTemplate = { name: "notification", body: "Hello {{1}}, you have a new notification in the staff accommodation portal: {{2}}. Please open the portal for details.", params: (_p, n) => [n, "update"] };

/** Reads template-name overrides from WHATSAPP_TEMPLATE_MAP (JSON {event: templateName}). */
function overrides(env: NodeJS.ProcessEnv): Record<string, string> {
  try { return env.WHATSAPP_TEMPLATE_MAP ? (JSON.parse(env.WHATSAPP_TEMPLATE_MAP) as Record<string, string>) : {}; } catch { return {}; }
}

export function renderWhatsApp(event: string, payload: unknown, recipientName: string, to: string, env: NodeJS.ProcessEnv = process.env): OutgoingWhatsApp {
  const p = (payload ?? {}) as Payload;
  const t = T[event] ?? GENERIC;
  const firstName = recipientName.split(" ")[0] || "there";
  const parameters = (t === GENERIC ? [firstName, event.replace(/[._]/g, " ")] : t.params(p, firstName)).map((v) => v.replace(/\s+/g, " ").trim().slice(0, 200));
  const prefix = env.WHATSAPP_TEMPLATE_PREFIX ?? "sam_";
  const template = overrides(env)[event] ?? `${prefix}${t.name}`;
  const text = t.body.replace(/\{\{(\d+)\}\}/g, (_, i) => parameters[Number(i) - 1] ?? "");
  return { to, template, language: env.WHATSAPP_LANGUAGE ?? "en", parameters, text };
}

/** Distinct provider template names the deployment must have approved (for the admin page and docs). */
export function requiredTemplates(env: NodeJS.ProcessEnv = process.env): Array<{ name: string; body: string; events: string[] }> {
  const prefix = env.WHATSAPP_TEMPLATE_PREFIX ?? "sam_";
  const map = new Map<string, { name: string; body: string; events: string[] }>();
  for (const [event, t] of [...Object.entries(T), ["*", GENERIC] as const]) {
    const name = overrides(env)[event] ?? `${prefix}${t.name}`;
    const row = map.get(name) ?? { name, body: t.body, events: [] };
    row.events.push(event);
    map.set(name, row);
  }
  return [...map.values()];
}

export const WHATSAPP_EVENTS = Object.keys(T);
