-- AlterEnum
ALTER TYPE "ClaimOutcome" ADD VALUE 'WITHDRAWN';
-- AlterTable
ALTER TABLE "LostFoundClaim" ADD COLUMN     "claimantUserId" TEXT,
ADD COLUMN     "decidedById" TEXT,
ADD COLUMN     "decisionNote" TEXT,
ALTER COLUMN "evidence" SET NOT NULL;
-- AlterTable
ALTER TABLE "LostFoundItem" ADD COLUMN     "disposalAuthorisedById" TEXT,
ADD COLUMN     "disposalMethod" TEXT,
ADD COLUMN     "disposalNote" TEXT,
ADD COLUMN     "disposedAt" TIMESTAMP(3),
ADD COLUMN     "foundByName" TEXT,
ADD COLUMN     "handedOverById" TEXT,
ADD COLUMN     "handedOverToName" TEXT,
ADD COLUMN     "handoverNote" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "registeredById" TEXT NOT NULL,
ADD COLUMN     "resolvedClaimId" TEXT,
ADD COLUMN     "retainUntil" TIMESTAMP(3),
ADD COLUMN     "storageLocation" TEXT;
-- CreateTable
CREATE TABLE "LostFoundEvent" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" "LostFoundStatus",
    "toStatus" "LostFoundStatus",
    "actorId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LostFoundEvent_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "LostFoundEvent_itemId_createdAt_idx" ON "LostFoundEvent"("itemId", "createdAt");
-- CreateIndex
CREATE INDEX "LostFoundClaim_itemId_outcome_idx" ON "LostFoundClaim"("itemId", "outcome");
-- CreateIndex
CREATE INDEX "LostFoundClaim_claimantUserId_idx" ON "LostFoundClaim"("claimantUserId");
-- CreateIndex
CREATE UNIQUE INDEX "LostFoundItem_resolvedClaimId_key" ON "LostFoundItem"("resolvedClaimId");
-- CreateIndex
CREATE INDEX "LostFoundItem_siteId_status_idx" ON "LostFoundItem"("siteId", "status");
-- CreateIndex
CREATE INDEX "LostFoundItem_foundAt_idx" ON "LostFoundItem"("foundAt");
-- CreateIndex
CREATE INDEX "LostFoundItem_status_retainUntil_idx" ON "LostFoundItem"("status", "retainUntil");
-- AddForeignKey
ALTER TABLE "LostFoundItem" ADD CONSTRAINT "LostFoundItem_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "LostFoundItem" ADD CONSTRAINT "LostFoundItem_handedOverById_fkey" FOREIGN KEY ("handedOverById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "LostFoundItem" ADD CONSTRAINT "LostFoundItem_disposalAuthorisedById_fkey" FOREIGN KEY ("disposalAuthorisedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "LostFoundItem" ADD CONSTRAINT "LostFoundItem_resolvedClaimId_fkey" FOREIGN KEY ("resolvedClaimId") REFERENCES "LostFoundClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "LostFoundClaim" ADD CONSTRAINT "LostFoundClaim_claimantUserId_fkey" FOREIGN KEY ("claimantUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "LostFoundClaim" ADD CONSTRAINT "LostFoundClaim_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "LostFoundEvent" ADD CONSTRAINT "LostFoundEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LostFoundItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "LostFoundEvent" ADD CONSTRAINT "LostFoundEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- LF-02: unique references LF-000001, LF-000002, …
CREATE SEQUENCE "LostFoundItem_ref_seq" START 1;

-- LF-03: a person has at most one pending claim on an item.
CREATE UNIQUE INDEX "LostFoundClaim_one_pending_per_user"
  ON "LostFoundClaim" ("itemId", "claimantUserId")
  WHERE "outcome" = 'PENDING' AND "claimantUserId" IS NOT NULL;

-- LF-04: claims and the item timeline are permanent.
CREATE OR REPLACE FUNCTION lost_found_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Lost and found history rows cannot be deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "LostFoundClaim_no_delete" BEFORE DELETE ON "LostFoundClaim" FOR EACH ROW EXECUTE FUNCTION lost_found_no_delete();
CREATE TRIGGER "LostFoundEvent_no_delete" BEFORE DELETE ON "LostFoundEvent" FOR EACH ROW EXECUTE FUNCTION lost_found_no_delete();
