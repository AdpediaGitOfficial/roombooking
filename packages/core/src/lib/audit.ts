import { Prisma } from "@prisma/client";
import { prisma } from "./db";

type AuditInput = {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  source?: string;
};

/** Writes an append-only audit event. Pass `tx` to join an open transaction. */
export async function recordAudit(input: AuditInput, tx: Prisma.TransactionClient = prisma) {
  await tx.auditEvent.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before,
      after: input.after,
      source: input.source ?? "web",
    },
  });
}
