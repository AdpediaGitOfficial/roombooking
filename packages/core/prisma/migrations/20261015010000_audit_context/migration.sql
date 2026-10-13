-- Audit entries also record the reason, device / IP and scope (site) of each change.
ALTER TABLE "AuditEvent" ADD COLUMN "reason" TEXT, ADD COLUMN "ip" TEXT, ADD COLUMN "userAgent" TEXT, ADD COLUMN "siteId" TEXT;
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");
