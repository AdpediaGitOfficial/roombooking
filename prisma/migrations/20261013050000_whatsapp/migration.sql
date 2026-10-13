-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "deliveredAt" TIMESTAMP(3);
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "whatsappConsentAt" TIMESTAMP(3),
ADD COLUMN     "whatsappNotifications" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsappNumber" TEXT;
-- CreateIndex
CREATE INDEX "Notification_providerMessageId_idx" ON "Notification"("providerMessageId");
