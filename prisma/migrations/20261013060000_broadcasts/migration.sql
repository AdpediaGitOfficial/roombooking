-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('DRAFT', 'SENT', 'CANCELLED');
-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "emailCopy" BOOLEAN NOT NULL DEFAULT true,
    "whatsappCopy" BOOLEAN NOT NULL DEFAULT false,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "Broadcast_organizationId_status_createdAt_idx" ON "Broadcast"("organizationId", "status", "createdAt");
-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
