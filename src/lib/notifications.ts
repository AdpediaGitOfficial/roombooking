import type { NotificationChannel, Prisma } from "@prisma/client";

type EnqueueInput = {
  recipientId: string;
  event: string;
  idempotencyKey: string;
  payload: Prisma.InputJsonValue;
  template?: string;
  channel?: NotificationChannel;
  /** Which copies an in-app notification may fan out to (default: both, subject to the recipient's settings). */
  fanout?: { email?: boolean; whatsapp?: boolean };
};

/**
 * Writes a notification to the outbox inside the caller's transaction
 * (COM-01, COM-06). Delivery is a separate worker's job; the idempotency key
 * guarantees the same event never queues twice (COM-07).
 */
export async function enqueueNotification(tx: Prisma.TransactionClient, input: EnqueueInput) {
  const channel = input.channel ?? "IN_APP";
  await tx.notification.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: {
      recipientId: input.recipientId,
      channel,
      event: input.event,
      template: input.template ?? input.event,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
    },
  });
  // An in-app notification also goes out by email when the person has an
  // address and has not switched email off (COM-01). Same transaction, own key.
  if (channel !== "IN_APP") return;
  const recipient = await tx.user.findUnique({ where: { id: input.recipientId }, select: { email: true, emailNotifications: true, status: true, whatsappNumber: true, whatsappNotifications: true, whatsappConsentAt: true } });
  if (!recipient || recipient.status === "DEACTIVATED") return;
  const fan = { email: input.fanout?.email ?? true, whatsapp: input.fanout?.whatsapp ?? true };
  if (fan.email && process.env.EMAIL_FANOUT !== "false" && recipient.email && recipient.emailNotifications) {
    await tx.notification.upsert({
      where: { idempotencyKey: `${input.idempotencyKey}:email` },
      update: {},
      create: { recipientId: input.recipientId, channel: "EMAIL", event: input.event, template: input.template ?? input.event, payload: input.payload, idempotencyKey: `${input.idempotencyKey}:email` },
    });
  }
  // WhatsApp copy only with a number, the switch on and recorded consent (COM-02).
  if (fan.whatsapp && process.env.WHATSAPP_FANOUT !== "false" && recipient.whatsappNumber && recipient.whatsappNotifications && recipient.whatsappConsentAt) {
    await tx.notification.upsert({
      where: { idempotencyKey: `${input.idempotencyKey}:whatsapp` },
      update: {},
      create: { recipientId: input.recipientId, channel: "WHATSAPP", event: input.event, template: input.template ?? input.event, payload: input.payload, idempotencyKey: `${input.idempotencyKey}:whatsapp` },
    });
  }
}
