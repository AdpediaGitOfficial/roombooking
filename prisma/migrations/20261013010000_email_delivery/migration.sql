-- Email delivery bookkeeping on the notification outbox and a resident email preference (COM-01, COM-04).
-- DropIndex
DROP INDEX "Notification_status_channel_idx";

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "deliveredTo" TEXT,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "providerMessageId" TEXT,
ADD COLUMN     "subject" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailNotifications" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Notification_status_channel_nextAttemptAt_idx" ON "Notification"("status", "channel", "nextAttemptAt");

