import type { NotificationChannel, Prisma } from "@prisma/client";

type EnqueueInput = {
  recipientId: string;
  event: string;
  idempotencyKey: string;
  payload: Prisma.InputJsonValue;
  template?: string;
  channel?: NotificationChannel;
};

/**
 * Writes a notification to the outbox inside the caller's transaction
 * (COM-01, COM-06). Delivery is a separate worker's job; the idempotency key
 * guarantees the same event never queues twice (COM-07).
 */
export async function enqueueNotification(tx: Prisma.TransactionClient, input: EnqueueInput) {
  await tx.notification.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: {
      recipientId: input.recipientId,
      channel: input.channel ?? "IN_APP",
      event: input.event,
      template: input.template ?? input.event,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
    },
  });
}
