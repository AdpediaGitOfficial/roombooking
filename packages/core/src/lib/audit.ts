import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { queueWebhookEvent } from "./webhook-emitter";

type AuditInput = {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  source?: string;
  reason?: string | null;
  siteId?: string | null;
};

export type AuditContext = { ip?: string | null; userAgent?: string | null };
let provider: (() => Promise<AuditContext | null>) | null = null;

/** The web app registers a function that reads the current request's address and user agent, so every audit entry carries the device. */
export function setAuditContextProvider(fn: () => Promise<AuditContext | null>) { provider = fn; }

/** Writes an append-only audit event. Pass `tx` to join an open transaction. */
export async function recordAudit(input: AuditInput, tx: Prisma.TransactionClient = prisma) {
  let ctx: AuditContext | null = null;
  try { ctx = provider ? await provider() : null; } catch { ctx = null; } // outside a request (worker, tests)
  const after = input.after as { reason?: unknown } | null | undefined;
  const reason = input.reason ?? (after && typeof after === "object" && typeof after.reason === "string" ? after.reason : null);
  await tx.auditEvent.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before,
      after: input.after,
      source: input.source ?? "web",
      reason,
      siteId: input.siteId ?? null,
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent?.slice(0, 300) ?? null,
    },
  });
  await queueWebhookEvent(tx, input.action, input.entityType, input.entityId, input.after);
}
