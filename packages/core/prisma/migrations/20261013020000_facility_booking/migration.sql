-- Facility booking: description, decision/cancellation/check-in bookkeeping and status indexes (FAC-03, FAC-06).
-- AlterTable
ALTER TABLE "Facility" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "FacilityBooking" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "checkedInAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "decidedById" TEXT,
ADD COLUMN     "decisionNote" TEXT;

-- CreateIndex
CREATE INDEX "FacilityBooking_facilityId_status_startsAt_idx" ON "FacilityBooking"("facilityId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "FacilityBooking_userId_status_startsAt_idx" ON "FacilityBooking"("userId", "status", "startsAt");

