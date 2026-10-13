-- CreateEnum
CREATE TYPE "DelegationStatus" AS ENUM ('ACTIVE', 'REVOKED');
-- AlterTable
ALTER TABLE "ApprovalDecision" ADD COLUMN     "delegationId" TEXT,
ADD COLUMN     "onBehalfOfId" TEXT;
-- CreateTable
CREATE TABLE "ApprovalDelegation" (
    "id" TEXT NOT NULL,
    "delegatorId" TEXT NOT NULL,
    "delegateId" TEXT NOT NULL,
    "roles" "Role"[],
    "startsAt" DATE NOT NULL,
    "endsAt" DATE NOT NULL,
    "reason" TEXT,
    "status" "DelegationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "revokedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApprovalDelegation_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "ApprovalDelegation_delegateId_status_startsAt_endsAt_idx" ON "ApprovalDelegation"("delegateId", "status", "startsAt", "endsAt");
-- CreateIndex
CREATE INDEX "ApprovalDelegation_delegatorId_status_idx" ON "ApprovalDelegation"("delegatorId", "status");
-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_onBehalfOfId_fkey" FOREIGN KEY ("onBehalfOfId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_delegationId_fkey" FOREIGN KEY ("delegationId") REFERENCES "ApprovalDelegation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_delegatorId_fkey" FOREIGN KEY ("delegatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_delegateId_fkey" FOREIGN KEY ("delegateId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- A delegation covers a date range and never ends before it starts.
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_range_check" CHECK ("endsAt" >= "startsAt");
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_not_self_check" CHECK ("delegatorId" <> "delegateId");
