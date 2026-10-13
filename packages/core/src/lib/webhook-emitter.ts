import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

/** Audit actions that are also published to subscribed webhooks, under a stable public event name. */
export const WEBHOOK_EVENTS: Record<string, string> = {
  ALLOCATION_CHECKED_IN: "stay.checked_in",
  ALLOCATION_CHECKED_OUT: "stay.checked_out",
  ALLOCATION_CREATED: "stay.allocated",
  EXIT_TRIGGERED: "exit.triggered",
  JOINER_RAISED: "joiner.raised",
  WORK_ORDER_CREATED: "work_order.created",
  WORK_ORDER_VERIFIED: "work_order.verified",
  VISITOR_CHECKED_IN: "visitor.checked_in",
  SOS_RAISED: "sos.raised",
  INCIDENT_REPORTED: "incident.reported",
  KEY_LOST: "key.lost",
  CHARGES_EXPORTED: "charges.exported",
};
export const PUBLIC_EVENTS = [...new Set(Object.values(WEBHOOK_EVENTS))];

/** Queues a delivery for every active webhook subscribed to the event. Called inside the audit write, so it commits (or not) with the change. */
export async function queueWebhookEvent(tx: Prisma.TransactionClient | typeof prisma, action: string, entityType: string, entityId: string, data: unknown) {
  const event = WEBHOOK_EVENTS[action];
  if (!event) return;
  const hooks = await tx.webhook.findMany({ where: { active: true, events: { has: event } }, select: { id: true } });
  for (const h of hooks) await tx.webhookDelivery.create({ data: { webhookId: h.id, event, payload: { event, occurredAt: new Date().toISOString(), entity: { type: entityType, id: entityId }, data: (data ?? null) as Prisma.InputJsonValue }, nextAttemptAt: new Date() } });
}
